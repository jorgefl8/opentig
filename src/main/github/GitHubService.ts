import { createHash } from 'node:crypto';
import { ReadSingleFlight } from '../git/ReadSingleFlight';
import type { CliCandidate } from '../ai/CliResolver';
import { parsePullRequestStack, parseStackMemberships, stackMembershipQuery } from './PullRequestStackParser';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CreatePullRequestInput, CreatePullRequestResult, DiffResult, GhCliStatus, GitHubRepositoryInfo, PullRequestDetails, PullRequestStack, PullRequestState, PullRequestSummary } from '../../shared/contracts';
import { AiOperationError, GhOperationError } from '../../shared/errors';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import { parseGitHubRemote, parseSshRemote } from './GitHubRemoteParser';
import { GH_ENV, redactCommandToken, type GitHubCommandAuth } from './GitHubAccountAuth';
import { parseBranchPullRequestList, parseCreatedPullRequestUrl, parsePullRequestDetails, parsePullRequestList, PR_DETAIL_FIELDS, PR_SUMMARY_FIELDS, selectPullRequestsNewestFirst, sortPullRequestsNewestFirst } from './PullRequestParser';

import { GitHubAccountsService } from './GitHubAccountsService';
import { PullRequestLocalGit, type PullRequestRange } from './PullRequestLocalGit';
import type { GitHubAccountSelection } from '../../shared/github-accounts';
const NETWORK_TIMEOUT_MS = 60_000;

interface GhRunOptions {
  cwd: string;
  operation: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string;
  auth: GitHubCommandAuth;
  executable: CliCandidate;
}

export class GitHubService {
  private readonly reads = new ReadSingleFlight();
  private readonly localGit: PullRequestLocalGit;
  gitAccess?: import('../git/RepositoryGitAccess').RepositoryGitAccess;
  readonly accounts: GitHubAccountsService;

  constructor(
    resolver: CliResolver,
    private readonly runner: CliProcessRunner,
    private readonly git: GitProcess,
    private readonly repositories: RepositoryService,
    accounts?: GitHubAccountsService,
  ) {
    this.accounts = accounts ?? new GitHubAccountsService(resolver, runner, git);
    this.localGit = new PullRequestLocalGit(git);
    this.git.onInvalidate(scope => this.reads.invalidate(scope));
  }

  invalidate(repositoryId?: string): void {
    if (repositoryId) this.reads.invalidate(this.git.readScope(this.repositories.get(repositoryId).path));
    else this.reads.clear();
  }

  private async shareRead<T>(repositoryId: string, resource: unknown[], read: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const repository = this.repositories.get(repositoryId);
      const revision = this.accounts.authRevision;
      const key = JSON.stringify([repository.path, repository.commonDir, revision, this.accounts.revisionFor(repository), ...resource]);
      try {
        const value = await this.reads.run(this.git.readScope(repository.path), key, read);
        if (revision === this.accounts.authRevision) return structuredClone(value);
      } catch (error) {
        if (revision !== this.accounts.authRevision) continue;
        // A repository following the default account switches to an account that can access it, then reads again.
        if (attempt === 0 && error instanceof GhOperationError && error.detail.code === 'GH_ACCESS_DENIED' && await this.adoptAccountWithAccess(repositoryId)) continue;
        throw error;
      }
    }
    throw new Error('The GitHub account changed repeatedly during the read. Try refreshing again.');
  }

  private async adoptAccountWithAccess(repositoryId: string): Promise<boolean> {
    try {
      const { info } = await this.routing(repositoryId);
      return Boolean(info.nameWithOwner && await this.accounts.adoptAccountWithAccess(this.repositories.get(repositoryId), info.nameWithOwner, 'gh-detect-account'));
    } catch { return false; }
  }

  async status(forceRefresh = false): Promise<GhCliStatus> {
    if (forceRefresh) { this.invalidate(); this.accounts.refreshAuthentication(); }
    const detected = await this.accounts.detect(forceRefresh);
    return { installed: !!detected.candidate, availability: detected.state === 'available' ? 'ready' : 'error',
      authStatus: 'unknown', ...(detected.version ? { version: detected.version } : {}), checkedAt: new Date().toISOString() };
  }

  async repositoryAccount(repositoryId: string, forceRefresh = false) {
    if (forceRefresh) this.invalidate(repositoryId);
    const repository = this.repositories.get(repositoryId);
    const info = await this.repositoryInfo(repositoryId);
    const remote = await this.remote(repositoryId);
    if (forceRefresh && info.nameWithOwner && !this.gitAccess) {
      this.accounts.refreshAuthentication();
      try { await this.accounts.authenticate(repository, remote, info.nameWithOwner, 'gh-repository-account'); }
      catch { /* The context carries the safe, actionable diagnostic. */ }
    }
    const access = await this.gitAccess?.status(repositoryId, forceRefresh, { remote, nameWithOwner: info.nameWithOwner });
    return { ...this.accounts.context(repository, remote, info.nameWithOwner), ...(access ? { access } : {}) };
  }

  async setRepositoryAccount(repositoryId: string, selection: GitHubAccountSelection, expectedRevision?: number) {
    if (expectedRevision !== undefined && expectedRevision !== this.accounts.revisionFor(this.repositories.get(repositoryId))) throw new Error('The repository account changed in another session. Reopen the account setup and review it.');
    await this.accounts.setSelection(this.repositories.get(repositoryId), selection);
    return this.repositoryAccount(repositoryId);
  }

  private async remote(repositoryId: string): Promise<string> {
    const repository = this.repositories.get(repositoryId);
    try {
      const output = await this.git.run(repository.path, ['remote', 'get-url', '--', 'origin'], { operation: 'github-remote-url', readOnly: true, maxOutputBytes: 64 * 1024 });
      return output.stdout.toString('utf8').trim();
    } catch { return ''; }
  }

  repositoryInfo(repositoryId: string): Promise<GitHubRepositoryInfo> {
    return this.shareRead(repositoryId, [], () => this.readRepositoryInfo(repositoryId));
  }

  private async readRepositoryInfo(repositoryId: string): Promise<GitHubRepositoryInfo> {
    return (await this.routing(repositoryId)).info;
  }

  private routing(repositoryId: string) {
    return this.shareRead(repositoryId, ['routing'], async () => {
      const remote = await this.remote(repositoryId);
      return { remote, info: await this.infoForRemote(remote) };
    });
  }

  private async infoForRemote(url: string): Promise<GitHubRepositoryInfo> {
    try {
      let parsed = parseGitHubRemote(url);
      if (!parsed) {
        const ssh = parseSshRemote(url);
        if (ssh) {
          // -G evaluates the user's SSH configuration without connecting to the remote.
          const config = await this.runner.run('ssh', ['-G', ...(ssh.port ? ['-p', ssh.port] : []), '--', ssh.destination], {
            cwd: os.homedir(), timeoutMs: 5_000, maxOutputBytes: 64 * 1024,
          });
          const hostname = config.stdout.split(/\r?\n/).find((line) => /^hostname\s/i.test(line))?.trim().split(/\s+/)[1];
          if (config.exitCode === 0 && hostname?.toLowerCase() === 'github.com') parsed = { nameWithOwner: ssh.nameWithOwner };
        }
      }
      return parsed ? { isGitHub: true, nameWithOwner: parsed.nameWithOwner } : { isGitHub: false, nameWithOwner: null };
    } catch {
      // Missing origin, unavailable SSH, and invalid SSH configuration are not GitHub matches.
      return { isGitHub: false, nameWithOwner: null };
    }
  }

  listPullRequests(repositoryId: string, states: PullRequestState[]): Promise<PullRequestSummary[]> {
    return this.shareRead(repositoryId, ['list', [...states].sort()], () => this.readListPullRequests(repositoryId, states));
  }

  private async readListPullRequests(repositoryId: string, states: PullRequestState[]): Promise<PullRequestSummary[]> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-list');
    const results = await Promise.all(states.map((state) => this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--state', state.toLowerCase(), '--json', PR_SUMMARY_FIELDS, '--limit', '50'],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-list', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    )));
    return this.withStackMembership(repository.path, nameWithOwner, auth, executable, selectPullRequestsNewestFirst(results.flatMap((result) => parsePullRequestList(result.stdout)), states));
  }

  findPullRequestForBranch(repositoryId: string, branchName: string): Promise<PullRequestSummary | null> {
    return this.shareRead(repositoryId, ['branch', branchName], () => this.readFindPullRequestForBranch(repositoryId, branchName));
  }

  private async readFindPullRequestForBranch(repositoryId: string, branchName: string): Promise<PullRequestSummary | null> {
    const operation = 'gh-pr-for-branch';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const branch = validateRef(branchName, operation);
    // An older open PR must not be hidden by newer closed PRs for a reused branch.
    const openResult = await this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'open', '--json', `${PR_SUMMARY_FIELDS},headRepository`, '--limit', '10'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    const openPull = sortPullRequestsNewestFirst(parseBranchPullRequestList(openResult.stdout, nameWithOwner, branch)).find((pull) => pull.state === 'OPEN');
    if (openPull) return (await this.withStackMembership(repository.path, nameWithOwner, auth, executable, [openPull]))[0]!;
    const result = await this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'all', '--json', `${PR_SUMMARY_FIELDS},headRepository`, '--limit', '10'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    const pull = sortPullRequestsNewestFirst(parseBranchPullRequestList(result.stdout, nameWithOwner, branch))[0];
    return pull ? (await this.withStackMembership(repository.path, nameWithOwner, auth, executable, [pull]))[0]! : null;
  }

  getPullRequest(repositoryId: string, prNumber: number): Promise<PullRequestDetails> {
    return this.shareRead(repositoryId, ['details', prNumber], () => this.readGetPullRequest(repositoryId, prNumber));
  }

  private async readGetPullRequest(repositoryId: string, prNumber: number): Promise<PullRequestDetails> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-view');
    const result = await this.runGhRead(
      ['pr', 'view', String(prNumber), '-R', nameWithOwner, '--json', PR_DETAIL_FIELDS],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-view', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    );
    const details = parsePullRequestDetails(result.stdout);
    return (await this.withStackMembership(repository.path, nameWithOwner, auth, executable, [details]))[0]!;
  }

  private async withStackMembership<T extends PullRequestSummary>(cwd: string, nameWithOwner: string, auth: GitHubCommandAuth, executable: CliCandidate, pulls: T[]): Promise<T[]> {
    const [owner, name] = nameWithOwner.split('/');
    const enriched: T[] = [];
    // Bound query size and avoid one request per PR. Metadata is optional: normal PRs
    // remain readable on older hosts, rate limits, or unavailable stack previews.
    for (let start = 0; start < pulls.length; start += 25) {
      const batch = pulls.slice(start, start + 25);
      try {
        const numbers = batch.map((pr) => pr.number);
        const result = await this.runGhRead(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${stackMembershipQuery(numbers)}`], {
          auth, executable, cwd, operation: 'gh-pr-stack-membership', timeoutMs: 10_000, maxOutputBytes: 1024 * 1024,
        });
        const memberships = parseStackMemberships(result.stdout, numbers);
        enriched.push(...batch.map((pr) => {
          const stack = memberships.get(pr.number);
          return stack ? { ...pr, stack } : pr;
        }));
      } catch { enriched.push(...batch); }
    }
    return enriched;
  }

  getPullRequestStack(repositoryId: string, prNumber: number): Promise<PullRequestStack | null> {
    return this.shareRead(repositoryId, ['stack', prNumber], () => this.readGetPullRequestStack(repositoryId, prNumber));
  }

  private async readGetPullRequestStack(repositoryId: string, prNumber: number): Promise<PullRequestStack | null> {
    const operation = 'gh-pr-stack';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const options = { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 };
    const read = async (endpoint: string) => this.runGhRead(['api', endpoint], options);
    let listing: CliRunResult;
    try { listing = await read(`repos/${nameWithOwner}/stacks?pull_request=${prNumber}`); }
    catch (error) {
      // Only an explicit unsupported/not-found response is absence. Transient and
      // authentication failures must preserve the renderer's last successful data.
      if (error instanceof GhOperationError && error.detail.code === 'GH_PROCESS_FAILED' && /HTTP 404/.test(error.message)) return null;
      throw error;
    }
    const stack = parsePullRequestStack(listing.stdout, prNumber, true);
    if (!stack) return null;
    const details = await read(`repos/${nameWithOwner}/stacks/${stack.number}`);
    const complete = parsePullRequestStack(details.stdout, prNumber);
    if (complete?.number !== stack.number) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'The stack changed while loading. Refresh to try again.' });
    return complete;
  }

  getPullRequestDiff(repositoryId: string, prNumber: number): Promise<DiffResult> {
    return this.shareRead(repositoryId, ['diff', prNumber], () => this.readGetPullRequestDiff(repositoryId, prNumber));
  }

  private async readGetPullRequestDiff(repositoryId: string, prNumber: number): Promise<DiffResult> {
    const range = await this.localRange(repositoryId, prNumber);
    if (range) return this.localGit.rangeDiff(range.cwd, range);
    // Without the commits locally (offline remote, shallow history, an unusual
    // remote layout) GitHub's own diff still covers PRs within its limits.
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-diff');
    const result = await this.runGhRead(
      ['pr', 'diff', String(prNumber), '-R', nameWithOwner],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-diff', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 32 * 1024 * 1024 },
    );
    const patch = result.stdout;
    const binary = /Binary files .* differ|GIT binary patch/.test(patch);
    return { patch, path: `pull/${prNumber}`, binary, truncated: false, lineCount: patch ? patch.split('\n').length : 0 };
  }

  /** The PR's base and head commits, downloaded into the local clone when needed. Null when Git cannot provide them. */
  private async localRange(repositoryId: string, prNumber: number): Promise<(PullRequestRange & { cwd: string }) | null> {
    const details = await this.getPullRequest(repositoryId, prNumber);
    const repository = this.repositories.get(repositoryId);
    const range = { number: prNumber, baseOid: details.baseRefOid, headOid: details.headRefOid };
    try {
      return await this.localGit.ensureRange(repository.path, 'origin', range) ? { ...range, cwd: repository.path } : null;
    } catch { return null; }
  }

  getPullRequestCommitDiff(repositoryId: string, oid: string): Promise<DiffResult> {
    return this.shareRead(repositoryId, ['commit-diff', oid], () => this.readGetPullRequestCommitDiff(repositoryId, oid));
  }

  private async readGetPullRequestCommitDiff(repositoryId: string, oid: string): Promise<DiffResult> {
    const operation = 'gh-pr-commit-diff';
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) {
      throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The commit is not valid.' });
    }
    // Opening the PR's code downloads its commits, so this is normally local.
    const local = await this.localGit.commitDiff(this.repositories.get(repositoryId).path, oid).catch(() => null);
    if (local) return local;
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const result = await this.runGhRead(
      ['api', `repos/${nameWithOwner}/commits/${oid}`, '--header', 'Accept: application/vnd.github.diff'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 32 * 1024 * 1024 },
    );
    const patch = result.stdout;
    const binary = /Binary files .* differ|GIT binary patch/.test(patch);
    return { patch, path: `commit/${oid}`, binary, truncated: false, lineCount: patch ? patch.split('\n').length : 0 };
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    const operation = 'gh-pr-create';
    const { repository, nameWithOwner, auth, executable, context } = await this.requireGitHub(input.repositoryId, operation);
    const verifyAccount = () => {
      if (input.expectedAccount && (input.expectedAccount.revision !== this.accounts.revisionFor(repository) || input.expectedAccount.revision !== context.revision || input.expectedAccount.login.toLowerCase() !== context.login?.toLowerCase())) {
        throw new GhOperationError({ code: 'GH_ACCOUNT_UNRESOLVED', operation, message: 'The GitHub account changed. Review the current identity before creating the pull request.' });
      }
    };
    verifyAccount();
    const status = await this.repositories.status(input.repositoryId, false);
    if (status.detached || status.unborn || !status.branch) {
      throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Check out a branch before creating a pull request.' });
    }
    if (!status.upstream) throw new GhOperationError({ code: 'GH_NO_UPSTREAM', operation, message: 'Publish the branch before creating a pull request.' });
    if (status.ahead > 0) {
      throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The branch has unpushed commits. Push them before creating the pull request.' });
    }
    // The UI selects the base as a remote-tracking ref (e.g. "origin/main");
    // gh expects the plain branch name on the base repository.
    const base = validateRef(input.base.replace(/^origin\//, ''), operation);
    const head = validateRef(status.branch, operation);
    if (base === head) throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The base branch must be different from the current branch.' });

    // The body travels through a private temporary file: it avoids argument
    // length limits and any shell/flag interpretation of its content.
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'opentig-gh-'));
    const bodyPath = path.join(temporary, 'body.md');
    try {
      await writeFile(bodyPath, input.body, { encoding: 'utf8', mode: 0o600 });
      const args = ['pr', 'create', '-R', nameWithOwner, '--title', input.title, '--body-file', bodyPath, '--base', base, '--head', head];
      if (input.draft) args.push('--draft');
      verifyAccount();
      this.invalidate(input.repositoryId);
      let result: CliRunResult;
      try {
        result = await this.runGh(args, { auth, executable, cwd: repository.path, operation, timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
      } finally { this.invalidate(input.repositoryId); }
      const created = parseCreatedPullRequestUrl(result.stdout);
      if (!created) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI did not return the URL of the new pull request.' });
      return created;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async requireGitHub(repositoryId: string, operation: string) {
    const repository = this.repositories.get(repositoryId);
    const { remote, info } = await this.routing(repositoryId);
    if (!info.isGitHub || !info.nameWithOwner) throw new GhOperationError({ code: 'GH_NOT_GITHUB_REPO', operation, message: 'The origin remote does not point to a GitHub repository.' });
    const authenticated = await this.accounts.authenticate(repository, remote, info.nameWithOwner, operation);
    return { repository, nameWithOwner: info.nameWithOwner, ...authenticated };
  }

  private runGhRead(args: string[], options: GhRunOptions): Promise<CliRunResult> {
    // Include executable routing and a one-way credential fingerprint. Never retain tokens as keys.
    const key = createHash('sha256').update(JSON.stringify([args, options])).digest('hex');
    // The complete read owns retries so it re-resolves remote and credentials;
    // replaying this command would reuse the old routing/account snapshot.
    return this.reads.run(this.git.readScope(options.cwd), `command:${key}`, () => this.runGh(args, options), false);
  }

  private async runGh(args: string[], options: GhRunOptions): Promise<CliRunResult> {
    const result = await this.run(options.executable, args, options);
    if (result.exitCode !== 0) throw classifyFailure({ ...result, stdout: redactCommandToken(result.stdout, options.auth), stderr: redactCommandToken(result.stderr, options.auth) }, options.operation);
    return result;
  }

  private async run(executable: CliCandidate, args: string[], options: GhRunOptions): Promise<CliRunResult> {
    try {
      return await this.runner.run(executable.executable, args, {
        cwd: options.cwd,
        env: { ...executable.env, ...GH_ENV, ...options.auth?.env },
        ...(options.auth?.removeEnv ? { removeEnv: options.auth.removeEnv } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
        ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      });
    } catch (error) {
      const mapped = mapRunnerError(error, options.operation);
      throw new GhOperationError({ ...mapped.detail, message: redactCommandToken(mapped.message, options.auth ?? {}) });
    }
  }
}

function validateRef(value: string, operation: string): string {
  const ref = value.trim();
  // A leading dash could be read as a flag; control characters and spaces are
  // never valid in Git branch names.
  const hasControl = [...ref].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (!ref || ref.startsWith('-') || hasControl || /[\s~^:?*[\\]/.test(ref) || ref.includes('..')) {
    throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The branch name is not valid.' });
  }
  return ref;
}

function classifyFailure(result: CliRunResult, operation: string): GhOperationError {
  const raw = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (/not logged in|gh auth login|authentication|credential|bad credentials|401/.test(raw)) {
    return new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation, message: 'Sign in with gh auth login to continue.', exitCode: result.exitCode });
  }
  if (/http 406|exceeded the maximum number of (files|lines)|diff is taking too long|too_large/.test(raw)) {
    return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'GitHub cannot produce a diff this large, and Git could not download the pull request commits. Check the connection to the remote and try again.', exitCode: result.exitCode });
  }
  if (/rate limit|api rate|secondary rate/.test(raw)) {
    return new GhOperationError({ code: 'GH_RATE_LIMITED', operation, message: 'GitHub rejected the request because of a rate limit. Try again later.', exitCode: result.exitCode, retryable: true });
  }
  // "Could not resolve to a Repository" means no access, not a network failure.
  if (/could not resolve to a repository/.test(raw) && operation !== 'gh-pr-stack') return new GhOperationError({ code: 'GH_ACCESS_DENIED', operation, message: 'The repository was not found or is not accessible with this GitHub account.', exitCode: result.exitCode });
  if (/could not resolve|no such host|connection refused|connection reset|network|dial tcp|tls handshake/.test(raw)) {
    return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Could not connect to GitHub. Check your network and try again.', exitCode: result.exitCode, retryable: true });
  }
  if (/403|resource not accessible|insufficient.*scope|saml|sso/.test(raw)) return new GhOperationError({ code: 'GH_ACCESS_DENIED', operation, message: 'This GitHub account cannot perform the operation. Check repository permissions, token permissions and organisation SSO policies.', exitCode: result.exitCode });
  if (/404|could not resolve to a repository/.test(raw) && operation !== 'gh-pr-stack') return new GhOperationError({ code: 'GH_ACCESS_DENIED', operation, message: 'The repository was not found or is not accessible with this GitHub account.', exitCode: result.exitCode });
  const detail = firstLine(result.stderr) || firstLine(result.stdout);
  return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: detail || 'GitHub CLI could not complete the operation.', exitCode: result.exitCode });
}

function mapRunnerError(error: unknown, operation: string): GhOperationError {
  if (error instanceof GhOperationError) return error;
  if (error instanceof AiOperationError) {
    if (error.detail.code === 'AI_TIMEOUT') return new GhOperationError({ code: 'GH_TIMEOUT', operation, message: 'GitHub CLI took too long to respond.', retryable: true });
    if (error.detail.code === 'AI_CONTEXT_TOO_LARGE') return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The GitHub CLI response is too large to display.' });
    return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Could not run GitHub CLI.' });
  }
  return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: error instanceof Error ? error.message : 'Could not run GitHub CLI.' });
}

function firstLine(value: string): string {
  return (value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '').slice(0, 300);
}
