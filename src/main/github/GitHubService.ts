import { createHash } from 'node:crypto';
import { ReadSingleFlight } from '../git/ReadSingleFlight';
import type { CliCandidate } from '../ai/CliResolver';
import type { CliDetection } from '../ai/cli-selection';
import { parsePullRequestStack, parseStackMemberships, stackMembershipQuery } from './PullRequestStackParser';
import os from 'node:os';
import { GITHUB_PR_COMMIT_PAGE } from '../../shared/contracts';
import type { ActionRunDetails, ActionRunSummary, RepositoryInfo, CreatePullRequestInput, CreatePullRequestResult, CommentOnPullRequestInput, CreateReleaseInput, DeleteDraftReleaseInput, DeletePullRequestEntryInput, EditPullRequestEntryInput, PublishReleaseInput, ReleaseDetails, ReleaseTagCheck, ReleaseSummary, RepositoryWorkflowList, RunWorkflowInput, UpdateReleaseInput, WorkflowRunSummary, DiffResult, ReviewPullRequestInput, UpdatePullRequestInput, PullRequestActionInput, PullRequestActionResult, PullRequestConversation, PullRequestCommitList, GhCliStatus, GitHubRepositoryInfo, PullRequestDetails, PullRequestLiveState, PullRequestStack, PullRequestStackMembership, PullRequestState, PullRequestSummary } from '../../shared/contracts';
import { AiOperationError, GhOperationError } from '../../shared/errors';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import { parseGitHubRemote, parseSshRemote } from './GitHubRemoteParser';
import { GH_ENV, redactCommandToken, type GitHubCommandAuth } from './GitHubAccountAuth';
import { parsePullRequestLiveState, PR_LIVE_STATE_QUERY } from './PullRequestLiveStateParser';
import { PR_CONVERSATION_QUERY, parsePullRequestConversation } from './PullRequestConversationParser';
import { PullRequestActionRunner } from './PullRequestActionRunner';
import { GitHubReleases } from './GitHubReleases';
import { GitHubActions } from './GitHubActions';
import { withPrivateTextFile, type GhRunOptions } from './GitHubAccess';
import { parseBranchPullRequestList, parseCreatedPullRequestUrl, parsePullRequestDetails, parsePullRequestList, PR_DETAIL_FIELDS, PR_SUMMARY_FIELDS, selectPullRequestsNewestFirst, sortPullRequestsNewestFirst } from './PullRequestParser';

import { GitHubAccountsService } from './GitHubAccountsService';
import { PullRequestLocalGit, diffResult, type PullRequestRange } from './PullRequestLocalGit';
import type { GitHubAccountSelection } from '../../shared/github-accounts';
import { GITHUB_LIVE_READ_TIMEOUT_MS, GITHUB_NETWORK_TIMEOUT_MS as NETWORK_TIMEOUT_MS } from '../../shared/operation-timeouts';
import { classifyFailure } from './GitHubFailure';

const ACCOUNT_USED = 'Account used:';
/** How long a PR's details and conversation are reused. Its live state, read every time, drops them sooner when GitHub reports a change. */
const OPEN_PULL_REQUEST_MS = 60_000;
/** A merged or closed PR rarely changes. */
const FINISHED_PULL_REQUEST_MS = 10 * 60_000;
/** Lists are reused briefly, so reloading the app doesn't wait for GitHub; a change made through OpenTig drops them at once. */
const LIST_MS = 30_000;
const RELEASES_MS = 60_000;

export class GitHubService {
  private readonly reads = new ReadSingleFlight();
  private readonly downloads = new Map<string, Promise<{ available: boolean; failure: string }>>();
  /** Finished reads of a PR's details and conversation, per repository path, so reopening a PR doesn't wait for GitHub. */
  private readonly settled = new Map<string, Map<string, { expires: number; value: unknown }>>();
  /** Bumped by every explicit invalidation, so a read that started before one isn't kept. */
  private settledEpoch = 0;
  private readonly localGit: PullRequestLocalGit;
  private readonly actions: PullRequestActionRunner;
  private readonly releases: GitHubReleases;
  private readonly actionRuns: GitHubActions;
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
    // A fetch only downloads objects and moves remote-tracking refs, which no GitHub
    // read depends on. Restarting them made the GitHub section, which fetches as it
    // opens, wait for its pull requests twice.
    this.git.onInvalidate((scope, command) => { if (command !== 'fetch') this.reads.invalidate(scope); });
    const access = {
      requireGitHub: (repositoryId: string, operation: string) => this.requireGitHub(repositoryId, operation),
      run: (executable: CliCandidate, args: string[], options: GhRunOptions) => this.run(executable, args, options),
      runRead: (args: string[], options: GhRunOptions) => this.runGh(args, options),
      invalidate: (repositoryId: string) => this.invalidate(repositoryId),
      readLiveState: (repositoryId: string, number: number) => this.readGetPullRequestLiveState(repositoryId, number),
      revisionFor: (repository: RepositoryInfo) => this.accounts.revisionFor(repository),
    };
    this.actions = new PullRequestActionRunner(access);
    this.releases = new GitHubReleases(access);
    this.actionRuns = new GitHubActions(access);
  }

  /** After a change made through OpenTig: nothing read before it is reused. */
  invalidate(repositoryId?: string): void {
    this.settledEpoch++;
    if (repositoryId) this.settled.delete(this.repositories.get(repositoryId).path);
    else this.settled.clear();
    this.invalidatePending(repositoryId);
  }

  /** Reads still running start again; finished ones stay, since they are keyed by account. */
  private invalidatePending(repositoryId?: string): void {
    if (repositoryId) this.reads.invalidate(this.git.readScope(this.repositories.get(repositoryId).path));
    else this.reads.clear();
  }

  private readKey(repository: ReturnType<RepositoryService['get']>, resource: unknown[]): string {
    return JSON.stringify([repository.path, repository.commonDir, this.accounts.authRevision, this.accounts.revisionFor(repository), ...resource]);
  }

  /**
   * A shared read whose result is also kept for `ttl(value)` milliseconds: a PR's
   * details and conversation, which the live state drops sooner when outdated
   * (see `forgetOutdated`), and the PR and release lists, briefly.
   */
  private async settledRead<T>(repositoryId: string, resource: unknown[], ttl: (value: T) => number, read: () => Promise<T>, fresh = false): Promise<T> {
    const repository = this.repositories.get(repositoryId);
    // Kept per GitHub repository too, so pointing the remote elsewhere doesn't show the old one's PR.
    const { remote } = await this.routing(repositoryId);
    const settledResource = [remote.url, ...resource];
    const key = this.readKey(repository, settledResource);
    const hit = fresh ? undefined : this.settled.get(repository.path)?.get(key);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.value as T);
    const epoch = this.settledEpoch;
    const value = await this.shareRead(repositoryId, resource, read);
    // An account change gives the read a new key; a change made meanwhile means it may predate it.
    if (epoch === this.settledEpoch && key === this.readKey(this.repositories.get(repositoryId), settledResource)) {
      let entries = this.settled.get(repository.path);
      if (!entries) this.settled.set(repository.path, entries = new Map());
      entries.set(key, { expires: Date.now() + ttl(value), value: structuredClone(value) });
    }
    return value;
  }

  /** A newer live state than the kept details means GitHub has changed the PR: its details and conversation are read again. */
  private async forgetOutdated(repositoryId: string, state: PullRequestLiveState): Promise<void> {
    const repository = this.repositories.get(repositoryId);
    const entries = this.settled.get(repository.path);
    if (!entries) return;
    const { remote } = await this.routing(repositoryId);
    const detailsKey = this.readKey(repository, [remote.url, 'details', state.number]);
    const details = entries.get(detailsKey)?.value as PullRequestDetails | undefined;
    if (!details) return;
    if (details.updatedAt === state.updatedAt && details.headRefOid === state.headRefOid && details.state === state.state && details.isDraft === state.isDraft) return;
    entries.delete(detailsKey);
    entries.delete(this.readKey(repository, [remote.url, 'conversation', state.number]));
  }

  private async shareRead<T>(repositoryId: string, resource: unknown[], read: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const repository = this.repositories.get(repositoryId);
      const revision = this.accounts.authRevision;
      const key = this.readKey(repository, resource);
      try {
        const value = await this.reads.run(this.git.readScope(repository.path), key, read);
        if (revision === this.accounts.authRevision) return structuredClone(value);
      } catch (error) {
        if (revision !== this.accounts.authRevision) continue;
        // A repository following the default account switches to an account that can access it, then reads again.
        if (attempt === 0 && error instanceof GhOperationError && error.detail.code === 'GH_ACCESS_DENIED' && await this.adoptAccountWithAccess(repositoryId)) continue;
        throw this.namingAccount(error, repository);
      }
    }
    throw new Error('The GitHub account changed repeatedly during the read. Try refreshing again.');
  }

  /** Several accounts can be connected, so a denial is only useful if it says whose it was. */
  private namingAccount(error: unknown, repository: ReturnType<RepositoryService['get']>): unknown {
    // Reads nest, so an inner one may already have named it.
    if (!(error instanceof GhOperationError) || error.detail.code !== 'GH_ACCESS_DENIED' || error.message.includes(ACCOUNT_USED)) return error;
    const login = this.accounts.verifiedLogin(repository);
    return login ? new GhOperationError({ ...error.detail, message: `${error.message} ${ACCOUNT_USED} @${login}.` }) : error;
  }

  private async adoptAccountWithAccess(repositoryId: string): Promise<boolean> {
    try {
      const { info } = await this.routing(repositoryId);
      return Boolean(info.nameWithOwner && await this.accounts.adoptAccountWithAccess(this.repositories.get(repositoryId), info.nameWithOwner, 'gh-detect-account'));
    } catch { return false; }
  }

  async status(forceRefresh = false): Promise<GhCliStatus> {
    const previous = forceRefresh ? await this.accounts.lastDetection?.catch(() => null) ?? null : null;
    const detected = await this.accounts.detect(forceRefresh);
    // Every app load checks the CLI again. Only a different CLI makes what was read with
    // the old one doubtful; dropping it every time made each load start GitHub from scratch.
    if (forceRefresh && !sameCli(previous, detected)) { this.invalidate(); this.accounts.refreshAuthentication(); }
    return { installed: !!detected.candidate, availability: detected.state === 'available' ? 'ready' : 'error',
      authStatus: 'unknown', ...(detected.version ? { version: detected.version } : {}), checkedAt: new Date().toISOString() };
  }

  async repositoryAccount(repositoryId: string, forceRefresh = false) {
    if (forceRefresh) this.invalidatePending(repositoryId);
    const repository = this.repositories.get(repositoryId);
    const { remote: { url: remote }, info } = await this.routing(repositoryId);
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

  /**
   * The remote whose GitHub repository holds the pull requests: the one chosen
   * with `gh repo set-default` (saved by GitHub CLI as
   * `remote.<name>.gh-resolved = base`), otherwise `origin`. In a fork whose
   * `origin` is the fork, that lets PRs come from the upstream repository.
   */
  private async remote(repositoryId: string): Promise<{ name: string; url: string }> {
    const repository = this.repositories.get(repositoryId);
    const read = { operation: 'github-remote-url', readOnly: true, maxOutputBytes: 64 * 1024 };
    const url = async (name: string) => {
      try { return (await this.git.run(repository.path, ['remote', 'get-url', '--', name], read)).stdout.toString('utf8').trim(); }
      catch { return ''; }
    };
    let resolved: string | undefined;
    try {
      const output = (await this.git.run(repository.path, ['config', '--get-regexp', '^remote\\..+\\.gh-resolved$'], read)).stdout.toString('utf8');
      resolved = output.split(/\r?\n/).map(line => /^remote\.(.+)\.gh-resolved\s+base$/.exec(line.trim())?.[1]).find(Boolean);
    } catch { /* No default chosen with GitHub CLI. */ }
    const chosen = resolved ? await url(resolved) : '';
    return chosen ? { name: resolved!, url: chosen } : { name: 'origin', url: await url('origin') };
  }

  /** The GitHub repository of `origin`, when it differs from the PR repository (a fork). */
  private async originRepository(repositoryId: string, nameWithOwner: string): Promise<string | null> {
    const { remote } = await this.routing(repositoryId);
    if (remote.name === 'origin') return null;
    try {
      const url = (await this.git.run(this.repositories.get(repositoryId).path, ['remote', 'get-url', '--', 'origin'], { operation: 'github-remote-url', readOnly: true, maxOutputBytes: 64 * 1024 })).stdout.toString('utf8').trim();
      const origin = (await this.infoForRemote(url)).nameWithOwner;
      return origin && origin.toLowerCase() !== nameWithOwner.toLowerCase() ? origin : null;
    } catch { return null; }
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
      return { remote, info: await this.infoForRemote(remote.url) };
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

  listPullRequests(repositoryId: string, states: PullRequestState[], fresh = false): Promise<PullRequestSummary[]> {
    return this.settledRead(repositoryId, ['list', [...states].sort()], () => LIST_MS, () => this.readListPullRequests(repositoryId, states), fresh);
  }

  private async readListPullRequests(repositoryId: string, states: PullRequestState[]): Promise<PullRequestSummary[]> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-list');
    const results = await Promise.all(states.map((state) => this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--state', state.toLowerCase(), '--json', PR_SUMMARY_FIELDS, '--limit', '50'],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-list', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    )));
    return selectPullRequestsNewestFirst(results.flatMap((result) => parsePullRequestList(result.stdout)), states);
  }

  listPullRequestStacks(repositoryId: string, numbers: number[]): Promise<Array<{ number: number; stack: PullRequestStackMembership }>> {
    return this.shareRead(repositoryId, ['list-stacks', [...numbers].sort((a, b) => a - b)], async () => {
      if (!numbers.length) return [];
      const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-stack-membership');
      const memberships = await this.stackMemberships(repository.path, nameWithOwner, auth, executable, numbers);
      return numbers.flatMap((number) => { const stack = memberships.get(number); return stack ? [{ number, stack }] : []; });
    });
  }

  findPullRequestForBranch(repositoryId: string, branchName: string): Promise<PullRequestSummary | null> {
    return this.shareRead(repositoryId, ['branch', branchName], () => this.readFindPullRequestForBranch(repositoryId, branchName));
  }

  private async readFindPullRequestForBranch(repositoryId: string, branchName: string): Promise<PullRequestSummary | null> {
    const operation = 'gh-pr-for-branch';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const branch = validateRef(branchName, operation);
    // Branches pushed to a fork's origin open PRs whose head is the fork.
    const heads = [nameWithOwner, ...[await this.originRepository(repositoryId, nameWithOwner)].filter((value): value is string => Boolean(value))];
    // An older open PR must not be hidden by newer closed PRs for a reused branch.
    const openResult = await this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'open', '--json', `${PR_SUMMARY_FIELDS},headRepository`, '--limit', '10'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    const openPull = sortPullRequestsNewestFirst(parseBranchPullRequestList(openResult.stdout, heads, branch)).find((pull) => pull.state === 'OPEN');
    if (openPull) return (await this.withStackMembership(repository.path, nameWithOwner, auth, executable, [openPull]))[0]!;
    const result = await this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'all', '--json', `${PR_SUMMARY_FIELDS},headRepository`, '--limit', '10'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    const pull = sortPullRequestsNewestFirst(parseBranchPullRequestList(result.stdout, heads, branch))[0];
    return pull ? (await this.withStackMembership(repository.path, nameWithOwner, auth, executable, [pull]))[0]! : null;
  }

  getPullRequest(repositoryId: string, prNumber: number): Promise<PullRequestDetails> {
    return this.settledRead(repositoryId, ['details', prNumber], details => details.state === 'OPEN' ? OPEN_PULL_REQUEST_MS : FINISHED_PULL_REQUEST_MS,
      () => this.readGetPullRequest(repositoryId, prNumber));
  }

  private async readGetPullRequest(repositoryId: string, prNumber: number): Promise<PullRequestDetails> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-view');
    const result = await this.runGhRead(
      ['pr', 'view', String(prNumber), '-R', nameWithOwner, '--json', PR_DETAIL_FIELDS],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-view', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    );
    // Stack membership comes with the live state, read alongside, so it doesn't hold the details back.
    return parsePullRequestDetails(result.stdout);
  }

  getPullRequestLiveState(repositoryId: string, prNumber: number): Promise<PullRequestLiveState> {
    return this.shareRead(repositoryId, ['live-state', prNumber], () => this.readGetPullRequestLiveState(repositoryId, prNumber))
      .then(async state => { await this.forgetOutdated(repositoryId, state).catch(() => undefined); return state; });
  }

  runPullRequestAction(input: PullRequestActionInput): Promise<PullRequestActionResult> {
    return this.actions.run(input);
  }

  updatePullRequest(input: UpdatePullRequestInput): Promise<void> {
    return this.actions.update(input);
  }

  commentOnPullRequest(input: CommentOnPullRequestInput): Promise<void> {
    return this.actions.comment(input);
  }

  reviewPullRequest(input: ReviewPullRequestInput): Promise<void> {
    return this.actions.review(input);
  }

  editPullRequestEntry(input: EditPullRequestEntryInput): Promise<void> {
    return this.actions.editEntry(input);
  }

  deletePullRequestEntry(input: DeletePullRequestEntryInput): Promise<void> {
    return this.actions.deleteEntry(input);
  }

  private async readGetPullRequestLiveState(repositoryId: string, prNumber: number): Promise<PullRequestLiveState> {
    const operation = 'gh-pr-live-state';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const [owner, name] = nameWithOwner.split('/');
    const [result, stack] = await Promise.all([
      this.run(executable, ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${prNumber}`, '-f', `headRef=refs/pull/${prNumber}/head`, '-f', `query=${PR_LIVE_STATE_QUERY}`], {
        auth, executable, cwd: repository.path, operation, timeoutMs: GITHUB_LIVE_READ_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024,
      }),
      this.stackStatus(repository.path, nameWithOwner, auth, executable, prNumber),
    ]);
    const read = parsePullRequestLiveState(result.stdout, stack.status);
    if (read.status === 'ok') return stack.membership ? { ...read.state, stackMembership: stack.membership } : read.state;
    if (read.status === 'missing') throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: `Pull request #${prNumber} was not found in this repository.`, exitCode: result.exitCode });
    // stdout holds GitHub data here, where check names and URLs could look like another failure.
    if (result.exitCode !== 0) throw classifyFailure({ ...result, stdout: '', stderr: redactCommandToken(result.stderr, auth) }, operation);
    throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
  }

  getPullRequestConversation(repositoryId: string, prNumber: number): Promise<PullRequestConversation> {
    return this.settledRead(repositoryId, ['conversation', prNumber], () => OPEN_PULL_REQUEST_MS, () => this.readGetPullRequestConversation(repositoryId, prNumber));
  }

  private async readGetPullRequestConversation(repositoryId: string, prNumber: number): Promise<PullRequestConversation> {
    const operation = 'gh-pr-conversation';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const [owner, name] = nameWithOwner.split('/');
    const result = await this.run(executable, ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${prNumber}`, '-f', `query=${PR_CONVERSATION_QUERY}`], {
      auth, executable, cwd: repository.path, operation, timeoutMs: GITHUB_LIVE_READ_TIMEOUT_MS, maxOutputBytes: 16 * 1024 * 1024,
    });
    const conversation = parsePullRequestConversation(result.stdout);
    if (conversation) return conversation;
    if (result.exitCode !== 0) throw classifyFailure({ ...result, stdout: '', stderr: redactCommandToken(result.stderr, auth) }, operation);
    throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
  }

  /** Membership is optional metadata: a failed read stays `unknown` instead of failing the live state. */
  private async stackStatus(cwd: string, nameWithOwner: string, auth: GitHubCommandAuth, executable: CliCandidate, prNumber: number): Promise<{ status: PullRequestLiveState['stack']; membership?: PullRequestStackMembership }> {
    const [owner, name] = nameWithOwner.split('/');
    try {
      const result = await this.runGhRead(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${stackMembershipQuery([prNumber])}`], {
        auth, executable, cwd, operation: 'gh-pr-stack-membership', timeoutMs: 10_000, maxOutputBytes: 1024 * 1024,
      });
      const membership = parseStackMemberships(result.stdout, [prNumber]).get(prNumber);
      return membership ? { status: 'member', membership } : { status: 'none' };
    } catch { return { status: 'unknown' }; }
  }

  listReleases(repositoryId: string, fresh = false): Promise<ReleaseSummary[]> {
    return this.settledRead(repositoryId, ['releases'], () => RELEASES_MS, () => this.releases.list(repositoryId), fresh);
  }

  getRelease(repositoryId: string, tagName: string): Promise<ReleaseDetails> {
    return this.shareRead(repositoryId, ['release', tagName], () => this.releases.view(repositoryId, tagName));
  }

  checkReleaseTag(repositoryId: string, tagName: string): Promise<ReleaseTagCheck> {
    return this.shareRead(repositoryId, ['release-tag', tagName], () => this.releases.checkTag(repositoryId, tagName));
  }

  createRelease(input: CreateReleaseInput): Promise<void> {
    return this.releases.create(input);
  }

  updateRelease(input: UpdateReleaseInput): Promise<void> {
    return this.releases.update(input);
  }

  deleteDraftRelease(input: DeleteDraftReleaseInput): Promise<void> {
    return this.releases.deleteDraft(input);
  }

  publishRelease(input: PublishReleaseInput): Promise<void> {
    return this.releases.publish(input);
  }

  listWorkflows(repositoryId: string): Promise<RepositoryWorkflowList> {
    return this.shareRead(repositoryId, ['workflows'], () => this.releases.listWorkflows(repositoryId));
  }

  listWorkflowRuns(repositoryId: string, path: string): Promise<WorkflowRunSummary[]> {
    return this.shareRead(repositoryId, ['workflow-runs', path], () => this.releases.listWorkflowRuns(repositoryId, path));
  }

  listActionRuns(repositoryId: string, workflowId: number | null): Promise<ActionRunSummary[]> {
    return this.shareRead(repositoryId, ['action-runs', workflowId], () => this.actionRuns.listRuns(repositoryId, workflowId));
  }

  getActionRun(repositoryId: string, runId: number): Promise<ActionRunDetails> {
    return this.shareRead(repositoryId, ['action-run', runId], () => this.actionRuns.viewRun(repositoryId, runId));
  }

  runWorkflow(input: RunWorkflowInput): Promise<void> {
    return this.releases.runWorkflow(input);
  }

  private async withStackMembership<T extends PullRequestSummary>(cwd: string, nameWithOwner: string, auth: GitHubCommandAuth, executable: CliCandidate, pulls: T[]): Promise<T[]> {
    const memberships = await this.stackMemberships(cwd, nameWithOwner, auth, executable, pulls.map((pr) => pr.number));
    return pulls.map((pr) => { const stack = memberships.get(pr.number); return stack ? { ...pr, stack } : pr; });
  }

  private async stackMemberships(cwd: string, nameWithOwner: string, auth: GitHubCommandAuth, executable: CliCandidate, numbers: number[]): Promise<Map<number, PullRequestStackMembership>> {
    const [owner, name] = nameWithOwner.split('/');
    // Bound query size and avoid one request per PR. Metadata is optional: normal PRs
    // remain readable on older hosts, rate limits, or unavailable stack previews.
    const batches = Array.from({ length: Math.ceil(numbers.length / 25) }, (_, index) => numbers.slice(index * 25, index * 25 + 25));
    const results = await Promise.all(batches.map(async (batch) => {
      try {
        const result = await this.runGhRead(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${stackMembershipQuery(batch)}`], {
          auth, executable, cwd, operation: 'gh-pr-stack-membership', timeoutMs: 10_000, maxOutputBytes: 1024 * 1024,
        });
        return [...parseStackMemberships(result.stdout, batch)];
      } catch { return []; }
    }));
    return new Map(results.flat());
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

  /**
   * `known` is the base and head the viewer already has from the PR's details, so
   * showing the code doesn't ask GitHub for them a second time.
   */
  async getPullRequestDiff(repositoryId: string, prNumber: number, known?: { baseOid: string; headOid: string }): Promise<DiffResult> {
    const range = known
      ? { number: prNumber, ...known }
      : await this.getPullRequest(repositoryId, prNumber).then(details => ({ number: prNumber, baseOid: details.baseRefOid, headOid: details.headRefOid }));
    // Downloading the commits writes to the clone, which restarts any shared read
    // still waiting on it, so it happens before the diff is read rather than inside it.
    let fetchFailure = '';
    const local = await this.localRange(repositoryId, range, (message) => { fetchFailure = message; });
    return this.shareRead(repositoryId, ['diff', range], () => local
      ? this.localGit.rangeDiff(local.cwd, local)
      : this.readGitHubDiff(repositoryId, prNumber, fetchFailure));
  }

  /** Without the commits locally (offline remote, shallow history, an unusual remote layout) GitHub's own diff still covers PRs within its limits. */
  private async readGitHubDiff(repositoryId: string, prNumber: number, fetchFailure: string): Promise<DiffResult> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-diff');
    const result = await this.runGhRead(
      ['pr', 'diff', String(prNumber), '-R', nameWithOwner],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-diff', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 32 * 1024 * 1024 },
    ).catch((error: unknown) => {
      // GitHub's refusal is only half the story: Git's failure is what can be fixed.
      throw fetchFailure && error instanceof GhOperationError
        ? new GhOperationError({ ...error.detail, message: `${error.message} Git reported: ${fetchFailure}` })
        : error;
    });
    return diffResult(`pull/${prNumber}`, result.stdout, false);
  }

  /** The PR's base and head commits, downloaded into the local clone when needed. Null when Git cannot provide them. */
  private async localRange(repositoryId: string, range: PullRequestRange, onFetchFailure?: (message: string) => void): Promise<(PullRequestRange & { cwd: string }) | null> {
    const repository = this.repositories.get(repositoryId);
    try {
      const { remote } = await this.routing(repositoryId);
      // Readers of the same PR share one download.
      const key = JSON.stringify([repository.path, remote.name, range]);
      let pending = this.downloads.get(key);
      if (!pending) {
        const failures: string[] = [];
        pending = this.localGit.ensureRange(repository.path, remote.name, range, (message) => failures.push(message))
          .then(available => ({ available, failure: failures[0] ?? '' }))
          .finally(() => this.downloads.delete(key));
        this.downloads.set(key, pending);
      }
      const { available, failure } = await pending;
      if (failure) onFetchFailure?.(failure);
      return available ? { ...range, cwd: repository.path } : null;
    } catch { return null; }
  }

  /** GitHub CLI stops at its first page of commits; the local clone lists the rest. */
  getPullRequestCommits(repositoryId: string, prNumber: number): Promise<PullRequestCommitList> {
    return this.shareRead(repositoryId, ['commits', prNumber], async () => {
      const details = await this.getPullRequest(repositoryId, prNumber);
      if (details.commits.length < GITHUB_PR_COMMIT_PAGE) return { commits: details.commits, complete: true };
      const range = await this.localRange(repositoryId, { number: prNumber, baseOid: details.baseRefOid, headOid: details.headRefOid });
      const local = range ? await this.localGit.commits(range.cwd, range).catch(() => null) : null;
      if (!local?.length) return { commits: details.commits, complete: false };
      // Keep GitHub's account names and avatars where it provided them.
      const known = new Map(details.commits.map(commit => [commit.oid, commit]));
      return { commits: local.map(commit => known.get(commit.oid) ?? commit), complete: true };
    });
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
    return diffResult(`commit/${oid}`, result.stdout, false);
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
    const { remote } = await this.routing(input.repositoryId);
    const base = validateRef([`${remote.name}/`, 'origin/'].reduce((value, prefix) => value.startsWith(prefix) ? value.slice(prefix.length) : value, input.base), operation);
    const head = await this.pullRequestHead(repository.path, status.branch, nameWithOwner, operation);
    if (base === head) throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The base branch must be different from the current branch.' });

    return withPrivateTextFile(input.body, async (bodyPath) => {
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
    });
  }

  /**
   * The head as gh expects it: the branch's name on the remote it tracks, and
   * `owner:branch` when that remote is another repository, such as your fork
   * while pull requests target upstream.
   */
  private async pullRequestHead(cwd: string, branch: string, nameWithOwner: string, operation: string): Promise<string> {
    const local = validateRef(branch, operation);
    const read = async (args: string[]) => {
      try { return (await this.git.run(cwd, args, { operation: 'github-pr-head', readOnly: true, maxOutputBytes: 64 * 1024 })).stdout.toString('utf8').trim(); }
      catch { return ''; }
    };
    const [remoteName, merge] = await Promise.all([read(['config', '--get', `branch.${local}.remote`]), read(['config', '--get', `branch.${local}.merge`])]);
    const name = merge.startsWith('refs/heads/') ? validateRef(merge.slice('refs/heads/'.length), operation) : local;
    if (!remoteName || remoteName === '.') return name;
    const headRepository = (await this.infoForRemote(await read(['remote', 'get-url', '--', remoteName]))).nameWithOwner;
    return headRepository && headRepository.toLowerCase() !== nameWithOwner.toLowerCase() ? `${headRepository.split('/')[0]}:${name}` : name;
  }

  private async requireGitHub(repositoryId: string, operation: string) {
    const repository = this.repositories.get(repositoryId);
    const { remote: { url: remote }, info } = await this.routing(repositoryId);
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

function sameCli(previous: CliDetection | null, next: CliDetection): boolean {
  return previous !== null && previous.state === next.state && previous.version === next.version
    && previous.candidate?.executable === next.candidate?.executable;
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

function mapRunnerError(error: unknown, operation: string): GhOperationError {
  if (error instanceof GhOperationError) return error;
  if (error instanceof AiOperationError) {
    if (error.detail.code === 'AI_TIMEOUT') return new GhOperationError({ code: 'GH_TIMEOUT', operation, message: 'GitHub CLI took too long to respond.', retryable: true });
    if (error.detail.code === 'AI_CONTEXT_TOO_LARGE') return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The GitHub CLI response is too large to display.' });
    return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Could not run GitHub CLI.' });
  }
  return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: error instanceof Error ? error.message : 'Could not run GitHub CLI.' });
}

