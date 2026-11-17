import { createHash } from 'node:crypto';
import { ReadSingleFlight } from '../git/ReadSingleFlight';
import type { CliCandidate } from '../ai/CliResolver';
import type { CliDetection } from '../ai/cli-selection';
import { parsePullRequestStack, parseStackMemberships, stackMembershipQuery } from './PullRequestStackParser';
import os from 'node:os';
import { GITHUB_PR_COMMIT_PAGE } from '../../shared/contracts';
import type { ActionJobLog, ActionRunDetails, ActionRunPage, RunnableWorkflowList, WorkflowTriggers, RepositoryInfo, CreatePullRequestInput, CreatePullRequestResult, CommentOnPullRequestInput, CreateReleaseInput, DeleteDraftReleaseInput, DeletePullRequestEntryInput, EditPullRequestEntryInput, PublishReleaseInput, ReleaseDetails, ReleaseTagCheck, ReleaseSummary, RepositoryWorkflowList, RunWorkflowInput, UpdateReleaseInput, DiffResult, PullRequestFileList, PullRequestFilesScope, ReviewPullRequestInput, UpdatePullRequestInput, PullRequestActionInput, PullRequestActionResult, PullRequestConversation, PullRequestCommitList, GhCliStatus, GitHubRepositoryInfo, PullRequestDetails, PullRequestLineCounts, PullRequestLiveState, PullRequestStack, PullRequestStackMembership, PullRequestState, PullRequestSummary } from '../../shared/contracts';
import { AiOperationError, GhOperationError, serializeError } from '../../shared/errors';
import type { KeptAnswerSink, KeptRefreshOutcome } from '../../shared/kept-reads';
import { GitHubReadCache, remoteFingerprint, type GitHubReadScope } from './GitHubReadCache';
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
import { withPrivateTextFile, type GhRunOptions, type GitHubChange } from './GitHubAccess';
import { parseBranchPullRequestList, parseCreatedPullRequestUrl, parsePullRequestDetails, parsePullRequestLineCounts, parsePullRequestList, PR_DETAIL_FIELDS, PR_FINISHED_LIST_FIELDS, PR_LINE_COUNT_FIELDS, PR_SUMMARY_FIELDS, selectPullRequestsNewestFirst, sortPullRequestsNewestFirst } from './PullRequestParser';

import { GitHubAccountsService } from './GitHubAccountsService';
import { PullRequestLocalGit, diffResult, type PullRequestRange } from './PullRequestLocalGit';
import { githubRepositoryKey, type GitHubAccountSelection } from '../../shared/github-accounts';
import { GITHUB_LIVE_READ_TIMEOUT_MS, GITHUB_NETWORK_TIMEOUT_MS as NETWORK_TIMEOUT_MS } from '../../shared/operation-timeouts';
import { classifyFailure } from './GitHubFailure';
import { notePerformance, performanceLabel, performanceLogging } from '../performance/PerformanceLog';

const ACCOUNT_USED = 'Account used:';
/** How long a PR's details and conversation are served as current. Its live state drops them sooner when GitHub reports a change. */
const OPEN_PULL_REQUEST_MS = 60_000;
/** A merged or closed PR rarely changes. */
const FINISHED_PULL_REQUEST_MS = 10 * 60_000;
/** Lists are reused briefly, so reloading the app doesn't wait for GitHub; a change made through OpenTig drops them at once. */
const LIST_MS = 30_000;
const LIST_LIMIT = 50;
const RELEASES_MS = 60_000;
/** How long the live state waits for stack membership once GitHub has answered everything else. */
const STACK_GRACE_MS = 500;
/** How long stack membership that arrived too late is offered to the next live state. */
const LATE_STACK_MS = 60_000;

type StackStatus = { status: PullRequestLiveState['stack']; membership?: PullRequestStackMembership };
const WORKFLOW_TRIGGERS_MS = 30_000;
/**
 * What changes moment to moment (a PR's live state, its stack, the branch's PR,
 * the Actions list, a run in progress) is never served as current: it is read
 * every time, as before it was kept. A client that can show it marked as old gets
 * the kept answer while it is read again.
 */
const LIVE_MS = 0;
/**
 * After the read behind a kept answer, how long a request for it is answered with the new
 * answer instead of reading again: the client that was told asks as soon as it is.
 */
const REFRESHED_GRACE_MS = 5_000;
/** Invalidations remembered to decide whether a read that was under way may be kept. */
const MAX_INVALIDATIONS = 100;

/**
 * How long an answer is served as current, after which a client that can show it
 * marked as old gets it at once while it is read again, and any other client waits
 * for the new one. `noExpiry` keeps it past the age limit, as a finished run is.
 */
interface ReadPolicy<T> {
  freshMs: (value: T) => number;
  noExpiry?: (value: T) => boolean;
}

const PULL_REQUEST_LISTS = new Set(['list', 'list-line-counts', 'list-stacks', 'branch', 'stack']);

function outdatedBy(change: GitHubChange, resource: readonly unknown[]): boolean {
  const kind = String(resource[0]);
  if (change === 'releases') return kind === 'releases';
  if (change === 'workflow-runs') return kind === 'action-runs';
  if (change === 'pull-requests') return PULL_REQUEST_LISTS.has(kind);
  return PULL_REQUEST_LISTS.has(kind) || (['details', 'live-state', 'conversation'].includes(kind) && resource[1] === change.pullRequest);
}

function finishedRun(run: { status: string }): boolean {
  return run.status === 'completed';
}

/** The cache key: the scope, then what was asked. */
function cacheKey(scope: GitHubReadScope, resource: readonly unknown[]): string {
  return JSON.stringify([scope.host, scope.nameWithOwner, scope.login, scope.path, scope.remote, ...resource]);
}

function resourceOf(key: string): unknown[] {
  try { return (JSON.parse(key) as unknown[]).slice(5); } catch { return []; }
}

export class GitHubService {
  private readonly reads = new ReadSingleFlight();
  private readonly downloads = new Map<string, Promise<{ available: boolean; failure: string }>>();
  /** What GitHub answered, per repository, GitHub repository and account; see `GitHubReadCache`. */
  readonly cache: GitHubReadCache;
  /** Reads started behind a kept answer, one per answer, so every client shown it waits for the same one. */
  private readonly refreshing = new Map<string, Promise<KeptRefreshOutcome>>();
  /** When the read behind a kept answer stored its new answer, for `REFRESHED_GRACE_MS`. */
  private readonly refreshedAt = new Map<string, number>();
  /** The GitHub repository each checkout last read, so a change made through it reaches every copy kept of it. */
  private readonly nameWithOwnerByPath = new Map<string, string>();
  /** Bumped by every explicit invalidation, so a read that started before one isn't kept. */
  private settledEpoch = 0;
  /**
   * The latest invalidations and what each covered, so a read finishing after one is not kept only
   * when that change concerns it. A read older than the oldest one here is not kept at all.
   */
  private readonly invalidations: Array<{ epoch: number; commonDir: string | null; nameWithOwner: string | null; change: GitHubChange | null }> = [];
  /** Repositories whose PR list was just read again on request, so their line counts are too instead of being reused. */
  private readonly staleLineCounts = new Set<string>();
  /** The last stack membership read per PR, for a live state that couldn't wait for its own. */
  private readonly stackStatuses = new Map<string, { at: number; value: StackStatus }>();
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
    cache?: GitHubReadCache,
    private readonly now: () => number = Date.now,
  ) {
    this.accounts = accounts ?? new GitHubAccountsService(resolver, runner, git);
    this.cache = cache ?? new GitHubReadCache(null, now);
    // Another account, or another choice of account, never sees what the previous one read.
    this.accounts.onChange((repository) => {
      if (repository) this.cache.dropWhere((entry) => githubRepositoryKey(entry.scope.commonDir) === githubRepositoryKey(repository.commonDir));
      else this.cache.clear();
    });
    this.localGit = new PullRequestLocalGit(git);
    // A fetch only downloads objects and moves remote-tracking refs, which no GitHub
    // read depends on. Restarting them made the GitHub section, which fetches as it
    // opens, wait for its pull requests twice.
    this.git.onInvalidate((scope, command) => { if (command !== 'fetch') this.reads.invalidate(scope); });
    const access = {
      requireGitHub: (repositoryId: string, operation: string, fresh?: boolean) => this.requireGitHub(repositoryId, operation, fresh),
      run: (executable: CliCandidate, args: string[], options: GhRunOptions) => this.run(executable, args, options),
      runRead: (args: string[], options: GhRunOptions) => this.runGh(args, options),
      failure: (result: CliRunResult, options: GhRunOptions) => this.failure({ ...result, stdout: redactCommandToken(result.stdout, options.auth) }, options.auth, options.operation),
      invalidate: (repositoryId: string, change?: GitHubChange) => this.invalidate(repositoryId, change),
      // What decides an action waits for the whole state, however long the stack takes.
      readLiveState: (repositoryId: string, number: number) => this.readGetPullRequestLiveState(repositoryId, number, true),
      revisionFor: (repository: RepositoryInfo) => this.accounts.revisionFor(repository),
    };
    this.actions = new PullRequestActionRunner(access);
    this.releases = new GitHubReleases(access);
    this.actionRuns = new GitHubActions(access);
  }

  /**
   * After a change made through OpenTig: what it makes outdated is not served
   * again, in this checkout or any other copy of the same GitHub repository, and
   * nothing read while it was under way is kept. Without a repository, nothing is.
   */
  invalidate(repositoryId?: string, change?: GitHubChange): void {
    this.settledEpoch++;
    this.stackStatuses.clear();
    const repository = repositoryId ? this.repositories.get(repositoryId) : null;
    // Without the GitHub repository's name, which this checkout learns on its first read, another
    // clone of it cannot be told apart: the change then concerns reads of every repository.
    const nameWithOwner = repository ? this.nameWithOwnerByPath.get(repository.path) ?? null : null;
    this.invalidations.push({ epoch: this.settledEpoch, commonDir: repository && nameWithOwner ? githubRepositoryKey(repository.commonDir) : null,
      nameWithOwner, change: change ?? null });
    if (this.invalidations.length > MAX_INVALIDATIONS) this.invalidations.shift();
    if (repository) {
      const nameWithOwner = this.nameWithOwnerByPath.get(repository.path);
      this.cache.dropWhere((entry) => (githubRepositoryKey(entry.scope.commonDir) === githubRepositoryKey(repository.commonDir) || entry.scope.nameWithOwner === nameWithOwner)
        && (!change || outdatedBy(change, resourceOf(entry.key))));
    } else this.cache.clear();
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
   * The account a read for this repository would use, known without running
   * anything: the one last verified for it, or the one its settings name. A read
   * by any other account fails, so an answer kept under this one can be served.
   * Null for GitHub CLI's own account before it is checked in this run.
   */
  private knownLogin(repository: ReturnType<RepositoryService['get']>, remoteUrl: string, nameWithOwner: string): string | null {
    const context = this.accounts.context(repository, remoteUrl, nameWithOwner);
    return context.state !== 'error' && context.login ? context.login : null;
  }

  private cacheScope(repository: ReturnType<RepositoryService['get']>, remoteUrl: string, nameWithOwner: string | null): GitHubReadScope | null {
    if (!nameWithOwner) return null;
    const login = this.knownLogin(repository, remoteUrl, nameWithOwner);
    if (!login) return null;
    this.nameWithOwnerByPath.set(repository.path, nameWithOwner.toLowerCase());
    return { host: 'github.com', nameWithOwner: nameWithOwner.toLowerCase(), login: login.toLowerCase(), path: repository.path, commonDir: repository.commonDir, remote: remoteFingerprint(remoteUrl) };
  }

  /**
   * A shared read whose answer is kept (see `GitHubReadCache`). Within
   * `policy.freshMs` it is served as current. Past that, `kept` is handed it at
   * once with the read started behind it, and without `kept` the read is awaited.
   * `fresh` always reads.
   */
  private async keptRead<T>(repositoryId: string, resource: unknown[], policy: ReadPolicy<T>, read: () => Promise<T>, options: { fresh?: boolean; kept?: KeptAnswerSink | undefined } = {}): Promise<T> {
    const repository = this.repositories.get(repositoryId);
    const { remote, info } = await this.routing(repositoryId);
    const scope = this.cacheScope(repository, remote.url, info.nameWithOwner);
    const key = scope ? cacheKey(scope, resource) : null;
    // What this checkout read from a remote it no longer uses is not kept.
    if (scope) this.cache.dropWhere((entry) => entry.scope.path === repository.path && entry.scope.remote !== scope.remote);
    const hit = key && !options.fresh ? await this.cache.get(key) : undefined;
    const age = hit ? this.now() - hit.readAt : Infinity;
    // The client told of a refresh asks for it at once, without accepting a kept answer: it gets the
    // answer that refresh stored, as current, rather than a second read from GitHub.
    const refreshed = hit !== undefined && this.refreshedAt.get(key!) === hit.readAt && age < REFRESHED_GRACE_MS;
    const current = hit !== undefined && (age < policy.freshMs(hit.value as T) || refreshed);
    const kept = hit !== undefined && !current && options.kept !== undefined;
    if (performanceLogging()) notePerformance({ kind: 'cache', cache: 'github-read', resource: performanceLabel(String(resource[0]), 'unknown'), outcome: current ? 'hit' : kept ? 'kept' : 'miss' });
    if (hit && current) return structuredClone(hit.value as T);
    if (hit && kept && key && scope) {
      options.kept!({ readAt: new Date(hit.readAt).toISOString(), refresh: this.refreshBehind(repositoryId, resource, policy, read, key, scope, remote.url) });
      return structuredClone(hit.value as T);
    }
    return this.readAndKeep(repositoryId, resource, policy, read, remote.url);
  }

  private async readAndKeep<T>(repositoryId: string, resource: unknown[], policy: ReadPolicy<T>, read: () => Promise<T>, remoteUrl: string, onKept?: (key: string, readAt: number) => void): Promise<T> {
    const repository = this.repositories.get(repositoryId);
    const epoch = this.settledEpoch;
    const before = this.readKey(repository, []);
    const value = await this.shareRead(repositoryId, resource, read);
    // An account change gives the read a new key, and so does another remote.
    if (before !== this.readKey(this.repositories.get(repositoryId), [])) return value;
    const { remote, info } = await this.routing(repositoryId);
    if (remote.url !== remoteUrl) return value;
    const scope = this.cacheScope(this.repositories.get(repositoryId), remote.url, info.nameWithOwner);
    if (!scope) return value;
    const key = cacheKey(scope, resource);
    // A change made meanwhile that concerns this answer means the read may predate it.
    if (this.changedSince(epoch, scope, resource)) return value;
    const readAt = this.now();
    if (this.cache.set(key, scope, value, { readAt, noExpiry: policy.noExpiry?.(value) ?? false })) onKept?.(key, readAt);
    // Too large to keep: what was kept is older than what GitHub just said, and is not served again.
    else this.cache.delete(key);
    return value;
  }

  private changedSince(epoch: number, scope: GitHubReadScope, resource: readonly unknown[]): boolean {
    if (epoch === this.settledEpoch) return false;
    const oldest = this.invalidations[0];
    if (!oldest || oldest.epoch > epoch + 1) return true;
    return this.invalidations.some((invalidation) => invalidation.epoch > epoch
      && (invalidation.commonDir === null || invalidation.commonDir === githubRepositoryKey(scope.commonDir) || invalidation.nameWithOwner === scope.nameWithOwner)
      && (invalidation.change === null || outdatedBy(invalidation.change, resource)));
  }

  /** Reads a kept answer again. It never fails: a failure is the outcome, and credentials or access GitHub refused drop what was kept with them. */
  private refreshBehind<T>(repositoryId: string, resource: unknown[], policy: ReadPolicy<T>, read: () => Promise<T>, key: string, scope: GitHubReadScope, remoteUrl: string): Promise<KeptRefreshOutcome> {
    const pending = this.refreshing.get(key);
    if (pending) return pending;
    const refresh = this.readAndKeep(repositoryId, resource, policy, read, remoteUrl, (storedKey, readAt) => {
      const now = this.now();
      for (const [other, at] of this.refreshedAt) if (now - at >= REFRESHED_GRACE_MS) this.refreshedAt.delete(other);
      this.refreshedAt.set(storedKey, readAt);
    })
      .then(() => ({ outcome: 'updated' as const }), (error: unknown): KeptRefreshOutcome => {
        const detail = serializeError(error, 'github-read');
        if (detail.code === 'GH_AUTH_REQUIRED') this.cache.dropWhere((entry) => entry.scope.login === scope.login);
        else if (detail.code === 'GH_ACCESS_DENIED' || detail.code === 'GH_NOT_GITHUB_REPO' || detail.code === 'GH_ACCOUNT_UNRESOLVED') {
          this.cache.dropWhere((entry) => entry.scope.path === scope.path || (entry.scope.login === scope.login && entry.scope.nameWithOwner === scope.nameWithOwner));
        }
        return { outcome: 'failed', error: detail };
      })
      .finally(() => { if (this.refreshing.get(key) === refresh) this.refreshing.delete(key); });
    this.refreshing.set(key, refresh);
    return refresh;
  }

  /** A newer live state than the kept details means GitHub has changed the PR: its details and conversation are read again. */
  private async forgetOutdated(repositoryId: string, state: PullRequestLiveState): Promise<void> {
    const repository = this.repositories.get(repositoryId);
    const { remote, info } = await this.routing(repositoryId);
    const scope = this.cacheScope(repository, remote.url, info.nameWithOwner);
    if (!scope) return;
    const detailsKey = cacheKey(scope, ['details', state.number]);
    const details = this.cache.peek(detailsKey)?.value as PullRequestDetails | undefined;
    if (!details) return;
    if (details.updatedAt === state.updatedAt && details.headRefOid === state.headRefOid && details.state === state.state && details.isDraft === state.isDraft) return;
    this.cache.delete(detailsKey);
    this.cache.delete(cacheKey(scope, ['conversation', state.number]));
  }

  /** A run listed differently from how it was kept has been started again: it is read again when opened. */
  private async forgetRerunRuns(repositoryId: string, runs: readonly { id: number; status: string; conclusion: string | null; attempt: number; updatedAt: string }[]): Promise<void> {
    const repository = this.repositories.get(repositoryId);
    const { remote, info } = await this.routing(repositoryId);
    const scope = this.cacheScope(repository, remote.url, info.nameWithOwner);
    if (!scope) return;
    for (const run of runs) {
      const key = cacheKey(scope, ['action-run', run.id]);
      const kept = this.cache.peek(key)?.value as ActionRunDetails | undefined;
      if (kept && (kept.status !== run.status || kept.conclusion !== run.conclusion || kept.attempt !== run.attempt || kept.updatedAt !== run.updatedAt)) this.cache.delete(key);
    }
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

  listPullRequests(repositoryId: string, states: PullRequestState[], fresh = false, kept?: KeptAnswerSink): Promise<PullRequestSummary[]> {
    // A list read again on request may hold a PR merged a moment ago, which the kept line counts don't know.
    if (fresh) this.staleLineCounts.add(repositoryId);
    return this.keptRead(repositoryId, ['list', [...states].sort()], { freshMs: () => LIST_MS }, () => this.readListPullRequests(repositoryId, states), { fresh, kept });
  }

  private async readListPullRequests(repositoryId: string, states: PullRequestState[]): Promise<PullRequestSummary[]> {
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-list');
    const results = await Promise.all(states.map((state) => this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--state', state.toLowerCase(), '--json', state === 'OPEN' ? PR_SUMMARY_FIELDS : PR_FINISHED_LIST_FIELDS, '--limit', String(LIST_LIMIT)],
      { auth, executable, cwd: repository.path, operation: 'gh-pr-list', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    )));
    return selectPullRequestsNewestFirst(results.flatMap((result) => parsePullRequestList(result.stdout)), states);
  }

  /** The line counts the list leaves out of its closed and merged PRs, read after the rows are on screen. */
  listPullRequestLineCounts(repositoryId: string, states: PullRequestState[], kept?: KeptAnswerSink): Promise<PullRequestLineCounts[]> {
    const finished = states.filter((state) => state !== 'OPEN').sort();
    if (!finished.length) return Promise.resolve([]);
    const fresh = this.staleLineCounts.delete(repositoryId);
    return this.keptRead(repositoryId, ['list-line-counts', finished], { freshMs: () => FINISHED_PULL_REQUEST_MS }, async () => {
      const operation = 'gh-pr-list-line-counts';
      const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
      const results = await Promise.all(finished.map((state) => this.runGhRead(
        ['pr', 'list', '-R', nameWithOwner, '--state', state.toLowerCase(), '--json', PR_LINE_COUNT_FIELDS, '--limit', String(LIST_LIMIT)],
        { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
      )));
      const counts = new Map(results.flatMap((result) => parsePullRequestLineCounts(result.stdout)).map((count) => [count.number, count]));
      return [...counts.values()];
    }, { fresh, kept });
  }

  listPullRequestStacks(repositoryId: string, numbers: number[], kept?: KeptAnswerSink): Promise<Array<{ number: number; stack: PullRequestStackMembership }>> {
    return this.keptRead(repositoryId, ['list-stacks', [...numbers].sort((a, b) => a - b)], { freshMs: () => LIVE_MS }, async () => {
      if (!numbers.length) return [];
      const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, 'gh-pr-stack-membership');
      const memberships = await this.stackMemberships(repository.path, nameWithOwner, auth, executable, numbers);
      return numbers.flatMap((number) => { const stack = memberships.get(number); return stack ? [{ number, stack }] : []; });
    }, { kept });
  }

  findPullRequestForBranch(repositoryId: string, branchName: string, kept?: KeptAnswerSink): Promise<PullRequestSummary | null> {
    return this.keptRead(repositoryId, ['branch', branchName], { freshMs: () => LIVE_MS }, () => this.readFindPullRequestForBranch(repositoryId, branchName), { kept });
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
    // Stack membership is read apart, as for the list: it used to hold the PR back for as long as GitHub took over it.
    if (openPull) return openPull;
    const result = await this.runGhRead(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'all', '--json', `${PR_SUMMARY_FIELDS},headRepository`, '--limit', '10'],
      { auth, executable, cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    return sortPullRequestsNewestFirst(parseBranchPullRequestList(result.stdout, heads, branch))[0] ?? null;
  }

  getPullRequest(repositoryId: string, prNumber: number, kept?: KeptAnswerSink): Promise<PullRequestDetails> {
    return this.keptRead(repositoryId, ['details', prNumber], { freshMs: details => details.state === 'OPEN' ? OPEN_PULL_REQUEST_MS : FINISHED_PULL_REQUEST_MS },
      () => this.readGetPullRequest(repositoryId, prNumber), { kept });
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

  /** Served as current only briefly; whatever decides an action reads it again itself (`readLiveState`). */
  getPullRequestLiveState(repositoryId: string, prNumber: number, kept?: KeptAnswerSink): Promise<PullRequestLiveState> {
    return this.keptRead(repositoryId, ['live-state', prNumber], { freshMs: () => LIVE_MS }, () => this.readGetPullRequestLiveState(repositoryId, prNumber)
      .then(async state => { await this.forgetOutdated(repositoryId, state).catch(() => undefined); return state; }), { kept });
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

  /**
   * The state comes first: unless `waitForStack`, it waits for stack membership
   * only a moment longer than GitHub took over everything else. Membership that
   * is not in by then is `unknown`, which holds merging back until the next read,
   * and that read takes what arrived meanwhile.
   */
  private async readGetPullRequestLiveState(repositoryId: string, prNumber: number, waitForStack = false): Promise<PullRequestLiveState> {
    const operation = 'gh-pr-live-state';
    const { repository, nameWithOwner, auth, executable } = await this.requireGitHub(repositoryId, operation);
    const [owner, name] = nameWithOwner.split('/');
    const stackKey = this.readKey(repository, [nameWithOwner, 'stack-status', prNumber]);
    const epoch = this.settledEpoch;
    const stackRead = this.stackStatus(repository.path, nameWithOwner, auth, executable, prNumber).then((value) => {
      if (value.status !== 'unknown' && epoch === this.settledEpoch) this.stackStatuses.set(stackKey, { at: Date.now(), value });
      return value;
    });
    const result = await this.run(executable, ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${prNumber}`, '-f', `headRef=refs/pull/${prNumber}/head`, '-f', `query=${PR_LIVE_STATE_QUERY}`], {
      auth, executable, cwd: repository.path, operation, timeoutMs: GITHUB_LIVE_READ_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024,
    });
    const stack = waitForStack ? await stackRead : await withinGrace<StackStatus>(stackRead, STACK_GRACE_MS, () => {
      const late = this.stackStatuses.get(stackKey);
      return late && Date.now() - late.at < LATE_STACK_MS ? late.value : { status: 'unknown' };
    });
    const read = parsePullRequestLiveState(result.stdout, stack.status);
    if (read.status === 'ok') return stack.membership ? { ...read.state, stackMembership: stack.membership } : read.state;
    if (read.status === 'missing') throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: `Pull request #${prNumber} was not found in this repository.`, exitCode: result.exitCode });
    // stdout holds GitHub data here, where check names and URLs could look like another failure.
    if (result.exitCode !== 0) throw this.failure({ ...result, stdout: '' }, auth, operation);
    throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
  }

  getPullRequestConversation(repositoryId: string, prNumber: number, kept?: KeptAnswerSink): Promise<PullRequestConversation> {
    return this.keptRead(repositoryId, ['conversation', prNumber], { freshMs: () => OPEN_PULL_REQUEST_MS }, () => this.readGetPullRequestConversation(repositoryId, prNumber), { kept });
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
    if (result.exitCode !== 0) throw this.failure({ ...result, stdout: '' }, auth, operation);
    throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
  }

  /** Membership is optional metadata: a failed read stays `unknown` instead of failing the live state. */
  private async stackStatus(cwd: string, nameWithOwner: string, auth: GitHubCommandAuth, executable: CliCandidate, prNumber: number): Promise<StackStatus> {
    const [owner, name] = nameWithOwner.split('/');
    try {
      const result = await this.runGhRead(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${stackMembershipQuery([prNumber])}`], {
        auth, executable, cwd, operation: 'gh-pr-stack-membership', timeoutMs: 10_000, maxOutputBytes: 1024 * 1024,
      });
      const membership = parseStackMemberships(result.stdout, [prNumber]).get(prNumber);
      return membership ? { status: 'member', membership } : { status: 'none' };
    } catch { return { status: 'unknown' }; }
  }

  listReleases(repositoryId: string, fresh = false, kept?: KeptAnswerSink): Promise<ReleaseSummary[]> {
    return this.keptRead(repositoryId, ['releases'], { freshMs: () => RELEASES_MS }, () => this.releases.list(repositoryId), { fresh, kept });
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

  /** Each workflow with its triggers on the default branch, so the dialog knows which can run and what they ask for. */
  async listRunnableWorkflows(repositoryId: string): Promise<RunnableWorkflowList> {
    const [list, branches] = await Promise.all([
      this.listWorkflows(repositoryId),
      this.keptRead(repositoryId, ['branches'], { freshMs: () => WORKFLOW_TRIGGERS_MS }, () => this.actionRuns.listBranches(repositoryId)),
    ]);
    const branch = list.defaultBranch;
    const triggers = await Promise.all(list.workflows.map((workflow) => branch ? this.getWorkflowTriggers(repositoryId, workflow.path, branch).catch(() => null) : null));
    return {
      ...list,
      workflows: list.workflows.map((workflow, index) => ({ ...workflow, triggers: triggers[index] ?? null })),
      branches: branch ? [branch, ...branches.filter((name) => name !== branch)] : branches,
    };
  }

  /** A branch's file can change at any time, so it's only kept briefly. */
  getWorkflowTriggers(repositoryId: string, path: string, ref: string): Promise<WorkflowTriggers | null> {
    return this.keptRead(repositoryId, ['workflow-triggers', path, ref], { freshMs: () => WORKFLOW_TRIGGERS_MS }, () => this.actionRuns.workflowTriggers(repositoryId, path, ref));
  }

  listActionRuns(repositoryId: string, workflowId: number | null, page = 1, kept?: KeptAnswerSink): Promise<ActionRunPage> {
    return this.keptRead(repositoryId, ['action-runs', workflowId, page], { freshMs: () => LIVE_MS }, () => this.actionRuns.listRuns(repositoryId, workflowId, page)
      .then(async (list) => { await this.forgetRerunRuns(repositoryId, list.runs).catch(() => undefined); return list; }), { kept });
  }

  /**
   * Never served as current: a finished run can be started again on GitHub, which nothing here
   * hears of. A finished one is kept past the age limit, and shown at once, marked, while it is read again.
   */
  getActionRun(repositoryId: string, runId: number, kept?: KeptAnswerSink): Promise<ActionRunDetails> {
    return this.keptRead(repositoryId, ['action-run', runId], { freshMs: () => LIVE_MS, noExpiry: finishedRun },
      () => this.actionRuns.viewRun(repositoryId, runId), { kept });
  }

  /**
   * A finished job's log. Not kept here, nor written with the other answers: a log can hold what a
   * workflow printed, which GitHub masks only where it knew a secret. Each request reads it, and the
   * request's signal stops the read.
   */
  async getActionJobLog(repositoryId: string, jobId: number, signal?: AbortSignal): Promise<ActionJobLog> {
    const repository = this.repositories.get(repositoryId);
    try {
      return await this.actionRuns.jobLog(repositoryId, jobId, signal);
    } catch (error) {
      throw this.namingAccount(error, repository);
    }
  }

  runWorkflow(input: RunWorkflowInput): Promise<void> {
    return this.releases.runWorkflow(input);
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

  getPullRequestStack(repositoryId: string, prNumber: number, kept?: KeptAnswerSink): Promise<PullRequestStack | null> {
    return this.keptRead(repositoryId, ['stack', prNumber], { freshMs: () => LIVE_MS }, () => this.readGetPullRequestStack(repositoryId, prNumber), { kept });
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

  /**
   * The files a pull request, or one of its commits, changes, read from Git in the clone after
   * downloading the PR's commits if needed. Without them, GitHub's whole diff, as `getPullRequestDiff`
   * gives it, which is all GitHub can offer.
   */
  async getPullRequestFiles(repositoryId: string, prNumber: number, scope: PullRequestFilesScope): Promise<PullRequestFileList> {
    const range = { number: prNumber, baseOid: scope.baseOid, headOid: scope.headOid };
    let fetchFailure = '';
    const local = await this.localRange(repositoryId, range, (message) => { fetchFailure = message; });
    return this.shareRead(repositoryId, ['files', scope], async (): Promise<PullRequestFileList> => {
      if (local) {
        try { return { source: 'git', ...await this.localGit.files(local.cwd, scope) }; }
        catch (error) {
          // A commit missing from the downloaded history can still come from GitHub; the range itself cannot.
          if (!scope.commitOid) throw error;
        }
      }
      return { source: 'github', diff: scope.commitOid ? await this.getPullRequestCommitDiff(repositoryId, scope.commitOid) : await this.readGitHubDiff(repositoryId, prNumber, fetchFailure) };
    });
  }

  /** One file's diff in a pull request or one of its commits, from Git in the clone. */
  async getPullRequestFileDiff(repositoryId: string, prNumber: number, scope: PullRequestFilesScope, file: { path: string; oldPath: string | null }): Promise<DiffResult> {
    // Paths from the client must name something inside the worktree, as every path Git is given.
    const [path] = this.repositories.validatePaths(repositoryId, [file.path]);
    const [oldPath] = file.oldPath ? this.repositories.validatePaths(repositoryId, [file.oldPath]) : [null];
    const local = await this.localRange(repositoryId, { number: prNumber, baseOid: scope.baseOid, headOid: scope.headOid });
    if (!local) throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation: 'gh-pr-file-diff', message: 'Git could not read this pull request’s commits. Refresh to try again.', retryable: true });
    return this.shareRead(repositoryId, ['file-diff', scope, path, oldPath], () => this.localGit.fileDiff(local.cwd, scope, path!, oldPath ?? null));
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
    const { repository, nameWithOwner, auth, executable, context } = await this.requireGitHub(input.repositoryId, operation, true);
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
      this.invalidate(input.repositoryId, 'pull-requests');
      let result: CliRunResult;
      try {
        result = await this.runGh(args, { auth, executable, cwd: repository.path, operation, timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
      } finally { this.invalidate(input.repositoryId, 'pull-requests'); }
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

  private async requireGitHub(repositoryId: string, operation: string, fresh = false) {
    const repository = this.repositories.get(repositoryId);
    const { remote: { url: remote }, info } = await this.routing(repositoryId);
    if (!info.isGitHub || !info.nameWithOwner) throw new GhOperationError({ code: 'GH_NOT_GITHUB_REPO', operation, message: 'The origin remote does not point to a GitHub repository.' });
    const authenticated = await this.accounts.authenticate(repository, remote, info.nameWithOwner, operation, fresh);
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
    if (result.exitCode !== 0) throw this.failure({ ...result, stdout: redactCommandToken(result.stdout, options.auth) }, options.auth, options.operation);
    return result;
  }

  /** Why a command failed. Credentials GitHub rejected are not reused for the next one. */
  private failure(result: CliRunResult, auth: GitHubCommandAuth, operation: string): GhOperationError {
    const error = classifyFailure({ ...result, stderr: redactCommandToken(result.stderr, auth) }, operation);
    if (error.detail.code === 'GH_AUTH_REQUIRED') this.accounts.refreshAuthentication();
    return error;
  }

  private async run(executable: CliCandidate, args: string[], options: GhRunOptions): Promise<CliRunResult> {
    try {
      return await this.runner.run(executable.executable, args, {
        cwd: options.cwd,
        operation: options.operation,
        env: { ...executable.env, ...GH_ENV, ...options.auth?.env },
        ...(options.auth?.removeEnv ? { removeEnv: options.auth.removeEnv } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
        ...(options.allowTruncatedOutput ? { allowTruncatedOutput: true } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      });
    } catch (error) {
      const mapped = mapRunnerError(error, options.operation);
      throw new GhOperationError({ ...mapped.detail, message: redactCommandToken(mapped.message, options.auth ?? {}) });
    }
  }
}

/** `read` if it settles within `graceMs`, otherwise `fallback()`; `read` goes on either way. */
function withinGrace<T>(read: Promise<T>, graceMs: number, fallback: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback()), graceMs);
    read.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
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

