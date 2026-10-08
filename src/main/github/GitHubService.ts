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
import { parseCreatedPullRequestUrl, parsePullRequestDetails, parsePullRequestList, PR_DETAIL_FIELDS, PR_SUMMARY_FIELDS, selectPullRequestsNewestFirst, sortPullRequestsNewestFirst } from './PullRequestParser';

import { GitHubAccountsService } from './GitHubAccountsService';
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
  gitAccess?: import('../git/RepositoryGitAccess').RepositoryGitAccess;
  readonly accounts: GitHubAccountsService;

  constructor(
    resolver: CliResolver,
    private readonly runner: CliProcessRunner,
    private readonly git: GitProcess,
    private readonly repositories: RepositoryService,
    accounts?: GitHubAccountsService,
  ) { this.accounts = accounts ?? new GitHubAccountsService(resolver, runner, git); }

  async status(forceRefresh = false): Promise<GhCliStatus> {
    if (forceRefresh) this.accounts.refreshAuthentication();
    const detected = await this.accounts.detect(forceRefresh);
    return { installed: !!detected.candidate, availability: detected.state === 'available' ? 'ready' : 'error',
      authStatus: 'unknown', ...(detected.version ? { version: detected.version } : {}), checkedAt: new Date().toISOString() };
  }

  async repositoryAccount(repositoryId: string, forceRefresh = false) {
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

  async setRepositoryAccount(repositoryId: string, selection: GitHubAccountSelection) {
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

  async repositoryInfo(repositoryId: string): Promise<GitHubRepositoryInfo> {
    try {
      const url = await this.remote(repositoryId);
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

  async listPullRequests(repositoryId: string, states: PullRequestState[]): Promise<PullRequestSummary[]> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-list');
    const results = await Promise.all(states.map((state) => this.runGh(
      ['pr', 'list', '-R', nameWithOwner, '--state', state.toLowerCase(), '--json', PR_SUMMARY_FIELDS, '--limit', '50'],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-list', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    )));
    return this.withStackMembership(repository.path, nameWithOwner, auth, executable, selectPullRequestsNewestFirst(results.flatMap((result) => parsePullRequestList(result.stdout)), states));
  }

  async findPullRequestForBranch(repositoryId: string, branchName: string): Promise<PullRequestSummary | null> {
    const operation = 'gh-pr-for-branch';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const branch = validateRef(branchName, operation);
    // An older open PR must not be hidden by newer closed PRs for a reused branch.
    const openResult = await this.runGh(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'open', '--json', PR_SUMMARY_FIELDS, '--limit', '10'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    const openPull = sortPullRequestsNewestFirst(parsePullRequestList(openResult.stdout)).find((pull) => pull.state === 'OPEN');
    if (openPull) return openPull;
    const result = await this.runGh(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'all', '--json', PR_SUMMARY_FIELDS, '--limit', '10'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    return sortPullRequestsNewestFirst(parsePullRequestList(result.stdout))[0] ?? null;
  }

  async getPullRequest(repositoryId: string, prNumber: number): Promise<PullRequestDetails> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-view');
    const result = await this.runGh(
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
        const result = await this.runGh(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${stackMembershipQuery(numbers)}`], {
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

  async getPullRequestStack(repositoryId: string, prNumber: number): Promise<PullRequestStack | null> {
    const operation = 'gh-pr-stack';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const options = { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 };
    const read = async (endpoint: string) => this.runGh(['api', endpoint], options);
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

  async getPullRequestDiff(repositoryId: string, prNumber: number): Promise<DiffResult> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-diff');
    const result = await this.runGh(
      ['pr', 'diff', String(prNumber), '-R', nameWithOwner],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-diff', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 32 * 1024 * 1024 },
    );
    const patch = result.stdout;
    const binary = /Binary files .* differ|GIT binary patch/.test(patch);
    return { patch, path: `pull/${prNumber}`, binary, truncated: false, lineCount: patch ? patch.split('\n').length : 0 };
  }

  async getPullRequestCommitDiff(repositoryId: string, oid: string): Promise<DiffResult> {
    const operation = 'gh-pr-commit-diff';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) {
      throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The commit is not valid.' });
    }
    const result = await this.runGh(
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
      const result = await this.runGh(args, { auth, executable, cwd: repository.path, operation, timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
      const created = parseCreatedPullRequestUrl(result.stdout);
      if (!created) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI did not return the URL of the new pull request.' });
      return created;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async requireGitHub(repositoryId: string, operation: string) {
    const repository = this.repositories.get(repositoryId);
    const info = await this.repositoryInfo(repositoryId);
    if (!info.isGitHub || !info.nameWithOwner) throw new GhOperationError({ code: 'GH_NOT_GITHUB_REPO', operation, message: 'The origin remote does not point to a GitHub repository.' });
    const remote = await this.remote(repositoryId);
    const authenticated = await this.accounts.authenticate(repository, remote, info.nameWithOwner, operation);
    return { repository, nameWithOwner: info.nameWithOwner, ...authenticated };
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
  if (/rate limit|api rate|secondary rate/.test(raw)) {
    return new GhOperationError({ code: 'GH_RATE_LIMITED', operation, message: 'GitHub rejected the request because of a rate limit. Try again later.', exitCode: result.exitCode, retryable: true });
  }
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
