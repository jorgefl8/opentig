import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CreatePullRequestInput, CreatePullRequestResult, DiffResult, GhCliStatus, GitHubRepositoryInfo, PullRequestDetails, PullRequestState, PullRequestSummary } from '../../shared/contracts';
import { AiOperationError, GhOperationError } from '../../shared/errors';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import { parseGitHubRemote } from './GitHubRemoteParser';
import { parseCreatedPullRequestUrl, parsePullRequestDetails, parsePullRequestList, PR_DETAIL_FIELDS, PR_SUMMARY_FIELDS, selectPullRequestsNewestFirst, sortPullRequestsNewestFirst } from './PullRequestParser';

// gh must never block waiting for input, page output, or emit ANSI noise.
const GH_ENV = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PAGER: 'cat', NO_COLOR: '1' } as const;
const NETWORK_TIMEOUT_MS = 60_000;

interface GhRunOptions {
  cwd: string;
  operation: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string;
}

export class GitHubService {
  private statusCache: { at: number; value: GhCliStatus } | null = null;

  constructor(
    private readonly resolver: CliResolver,
    private readonly runner: CliProcessRunner,
    private readonly git: GitProcess,
    private readonly repositories: RepositoryService,
  ) {}

  async status(forceRefresh = false): Promise<GhCliStatus> {
    if (!forceRefresh && this.statusCache && Date.now() - this.statusCache.at < 30_000) return this.statusCache.value;
    const value = await this.checkStatus(forceRefresh);
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  async repositoryInfo(repositoryId: string): Promise<GitHubRepositoryInfo> {
    const repository = this.repositories.get(repositoryId);
    try {
      const output = await this.git.run(repository.path, ['config', '--get', 'remote.origin.url'], { operation: 'github-remote-url', readOnly: true, maxOutputBytes: 64 * 1024 });
      const parsed = parseGitHubRemote(output.stdout.toString('utf8'));
      return parsed ? { isGitHub: true, nameWithOwner: parsed.nameWithOwner } : { isGitHub: false, nameWithOwner: null };
    } catch {
      // `git config --get` exits with 1 when origin has no URL configured.
      return { isGitHub: false, nameWithOwner: null };
    }
  }

  async listPullRequests(repositoryId: string, states: PullRequestState[]): Promise<PullRequestSummary[]> {
    const { repository, nameWithOwner } = await this.requireGitHub(repositoryId, 'gh-pr-list');
    const results = await Promise.all(states.map((state) => this.runGh(
      ['pr', 'list', '-R', nameWithOwner, '--state', state.toLowerCase(), '--json', PR_SUMMARY_FIELDS, '--limit', '50'],
      { cwd: repository.path, operation: 'gh-pr-list', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    )));
    return selectPullRequestsNewestFirst(results.flatMap((result) => parsePullRequestList(result.stdout)), states);
  }

  async findPullRequestForBranch(repositoryId: string, branchName: string): Promise<PullRequestSummary | null> {
    const operation = 'gh-pr-for-branch';
    const { repository, nameWithOwner } = await this.requireGitHub(repositoryId, operation);
    const branch = validateRef(branchName, operation);
    const result = await this.runGh(
      ['pr', 'list', '-R', nameWithOwner, '--head', branch, '--state', 'all', '--json', PR_SUMMARY_FIELDS, '--limit', '10'],
      { cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 },
    );
    return sortPullRequestsNewestFirst(parsePullRequestList(result.stdout))[0] ?? null;
  }

  async getPullRequest(repositoryId: string, prNumber: number): Promise<PullRequestDetails> {
    const { repository, nameWithOwner } = await this.requireGitHub(repositoryId, 'gh-pr-view');
    const result = await this.runGh(
      ['pr', 'view', String(prNumber), '-R', nameWithOwner, '--json', PR_DETAIL_FIELDS],
      { cwd: repository.path, operation: 'gh-pr-view', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 },
    );
    return parsePullRequestDetails(result.stdout);
  }

  async getPullRequestDiff(repositoryId: string, prNumber: number): Promise<DiffResult> {
    const { repository, nameWithOwner } = await this.requireGitHub(repositoryId, 'gh-pr-diff');
    const result = await this.runGh(
      ['pr', 'diff', String(prNumber), '-R', nameWithOwner],
      { cwd: repository.path, operation: 'gh-pr-diff', timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 32 * 1024 * 1024 },
    );
    const patch = result.stdout;
    const binary = /Binary files .* differ|GIT binary patch/.test(patch);
    return { patch, path: `pull/${prNumber}`, binary, truncated: false, lineCount: patch ? patch.split('\n').length : 0 };
  }

  async getPullRequestCommitDiff(repositoryId: string, oid: string): Promise<DiffResult> {
    const operation = 'gh-pr-commit-diff';
    const { repository, nameWithOwner } = await this.requireGitHub(repositoryId, operation);
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) {
      throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'The commit is not valid.' });
    }
    const result = await this.runGh(
      ['api', `repos/${nameWithOwner}/commits/${oid}`, '--header', 'Accept: application/vnd.github.diff'],
      { cwd: repository.path, operation, timeoutMs: NETWORK_TIMEOUT_MS, maxOutputBytes: 32 * 1024 * 1024 },
    );
    const patch = result.stdout;
    const binary = /Binary files .* differ|GIT binary patch/.test(patch);
    return { patch, path: `commit/${oid}`, binary, truncated: false, lineCount: patch ? patch.split('\n').length : 0 };
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    const operation = 'gh-pr-create';
    const { repository, nameWithOwner } = await this.requireGitHub(input.repositoryId, operation);
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
      const result = await this.runGh(args, { cwd: repository.path, operation, timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
      const created = parseCreatedPullRequestUrl(result.stdout);
      if (!created) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI did not return the URL of the new pull request.' });
      return created;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async checkStatus(forceRefresh: boolean): Promise<GhCliStatus> {
    const checkedAt = new Date().toISOString();
    const executable = await this.resolver.resolve('gh', forceRefresh);
    if (!executable) {
      return { installed: false, availability: 'error', authStatus: 'unknown', message: 'Install GitHub CLI (cli.github.com) to work with pull requests.', checkedAt };
    }
    const version = await this.run(executable, ['--version'], { cwd: os.tmpdir(), operation: 'gh-version' });
    const versionLabel = (version.stdout.split(/\r?\n/, 1)[0] ?? '').trim() || version.stderr.trim();
    const auth = await this.run(executable, ['auth', 'status', '--hostname', 'github.com', '--active'], { cwd: os.tmpdir(), operation: 'gh-auth-status' });
    if (auth.exitCode !== 0) {
      return { installed: true, availability: 'error', authStatus: 'unauthenticated', version: versionLabel, message: 'Run gh auth login.', checkedAt };
    }
    return { installed: true, availability: 'ready', authStatus: 'authenticated', version: versionLabel, checkedAt };
  }

  private async requireGitHub(repositoryId: string, operation: string) {
    const repository = this.repositories.get(repositoryId);
    const info = await this.repositoryInfo(repositoryId);
    if (!info.isGitHub || !info.nameWithOwner) {
      throw new GhOperationError({ code: 'GH_NOT_GITHUB_REPO', operation, message: 'The origin remote does not point to a GitHub repository.' });
    }
    const status = await this.status();
    if (!status.installed) throw new GhOperationError({ code: 'GH_CLI_NOT_FOUND', operation, message: 'GitHub CLI is not installed.' });
    if (status.authStatus === 'unauthenticated') throw new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation, message: 'Sign in with gh auth login to continue.' });
    return { repository, nameWithOwner: info.nameWithOwner };
  }

  private async runGh(args: string[], options: GhRunOptions): Promise<CliRunResult> {
    const executable = await this.resolver.resolve('gh');
    if (!executable) throw new GhOperationError({ code: 'GH_CLI_NOT_FOUND', operation: options.operation, message: 'GitHub CLI is not installed.' });
    const result = await this.run(executable, args, options);
    if (result.exitCode !== 0) throw classifyFailure(result, options.operation);
    return result;
  }

  private async run(executable: string, args: string[], options: GhRunOptions): Promise<CliRunResult> {
    try {
      return await this.runner.run(executable, args, {
        cwd: options.cwd,
        env: { ...GH_ENV },
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
        ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      });
    } catch (error) {
      throw mapRunnerError(error, options.operation);
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
