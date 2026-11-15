import { ACTION_JOB_LOG_LIMITS, type ActionJobLog, type ActionRunDetails, type ActionRunPage, type WorkflowTriggers } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';
import { GITHUB_LIVE_READ_TIMEOUT_MS, GITHUB_NETWORK_TIMEOUT_MS } from '../../shared/operation-timeouts';
import type { GitHubAccess, GitHubTarget } from './GitHubAccess';
import { parseActionJobLog } from './ActionJobLogParser';
import { parseActionRun, parseActionRunJob, parseActionRunJobs, parseActionRunPage, parseBranchNames, parseContentsFile } from './ActionRunParser';
import { parseWorkflowTriggers } from './WorkflowDispatch';
import { buildRunGraph, parseWorkflowJobs, type WorkflowJobDefinition } from './WorkflowGraph';

/** Twenty runs fill the list several times over, and GitHub answers them in about half the time fifty take. Every poll reads a page again. */
export const RUN_PAGE_SIZE = 20;
const JOBS_PER_PAGE = 100;
const WORKFLOW_FILE_CACHE_SIZE = 50;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/i;

/** Reads GitHub Actions runs. Nothing here changes a run. */
export class GitHubActions {
  /** Workflow files by commit and path: a commit's file never changes, so polling a run reads it once. */
  private readonly workflowFiles = new Map<string, WorkflowJobDefinition[] | null>();

  constructor(private readonly github: GitHubAccess) {}

  private options(target: GitHubTarget, operation: string) {
    return { auth: target.auth, executable: target.executable, cwd: target.repository.path, operation, timeoutMs: GITHUB_LIVE_READ_TIMEOUT_MS, maxOutputBytes: 8 * 1024 * 1024 };
  }

  private async read(target: GitHubTarget, args: string[], operation: string): Promise<string> {
    try {
      return (await this.github.runRead(args, this.options(target, operation))).stdout;
    } catch (error) {
      if (error instanceof GhOperationError && /unknown json field/i.test(error.message)) {
        throw new GhOperationError({ code: 'GH_CLI_INCOMPATIBLE', operation, message: 'Reading workflow runs needs a newer GitHub CLI. Update gh and try again.' });
      }
      throw error;
    }
  }

  /** A page of runs, newest first, of the repository or of one workflow. */
  async listRuns(repositoryId: string, workflowId: number | null, page: number): Promise<ActionRunPage> {
    const operation = 'gh-action-run-list';
    const target = await this.github.requireGitHub(repositoryId, operation);
    const scope = workflowId === null ? 'actions/runs' : `actions/workflows/${workflowId}/runs`;
    return parseActionRunPage(await this.read(target, ['api', `repos/${target.nameWithOwner}/${scope}?per_page=${RUN_PAGE_SIZE}&page=${page}`], operation), page, RUN_PAGE_SIZE);
  }

  /** The repository's branches on GitHub, up to 100, by name. */
  async listBranches(repositoryId: string): Promise<string[]> {
    const operation = 'gh-workflow-runnable';
    const target = await this.github.requireGitHub(repositoryId, operation);
    return parseBranchNames(await this.read(target, ['api', `repos/${target.nameWithOwner}/branches?per_page=100`], operation));
  }

  /** What starts a workflow at a branch, from its file there. Null when it isn't a workflow file OpenTig can read. */
  async workflowTriggers(repositoryId: string, path: string, ref: string): Promise<WorkflowTriggers | null> {
    const operation = 'gh-workflow-triggers';
    // GitHub's own workflows, such as Dependabot's, have no file and can't be started by hand.
    if (!WORKFLOW_FILE.test(path)) return { events: ['dynamic'], inputs: null };
    const target = await this.github.requireGitHub(repositoryId, operation);
    const text = await this.readFile(target, path, ref, operation);
    return text === null ? null : parseWorkflowTriggers(text);
  }

  private async readFile(target: GitHubTarget, path: string, ref: string, operation: string): Promise<string | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const result = await this.github.run(target.executable, ['api', `repos/${target.nameWithOwner}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`], this.options(target, operation)).catch(() => null);
    return result?.exitCode === 0 ? parseContentsFileSafely(result.stdout) : null;
  }

  async viewRun(repositoryId: string, runId: number): Promise<ActionRunDetails> {
    const operation = 'gh-action-run-view';
    const target = await this.github.requireGitHub(repositoryId, operation);
    const base = `repos/${target.nameWithOwner}/actions/runs/${runId}`;
    const run = parseActionRun(await this.read(target, ['api', base], operation));
    const [{ jobs, total }, definition] = await Promise.all([
      this.read(target, ['api', `${base}/attempts/${run.attempt}/jobs?per_page=${JOBS_PER_PAGE}`], operation).then(parseActionRunJobs),
      this.workflowJobs(target, run.headSha, run.path, operation),
    ]);
    const { graph, source } = buildRunGraph(definition, jobs);
    return { ...run, jobs, jobsTruncated: total > jobs.length, graph, graphSource: source };
  }

  /**
   * A job's log, by step. Nothing is kept: a log can hold what a workflow printed, and is read
   * again when asked for. A job that hasn't finished isn't read, since GitHub serves its log only
   * then; GitHub's 404 or 410 for a finished job means the log is gone.
   */
  async jobLog(repositoryId: string, jobId: number, signal?: AbortSignal): Promise<ActionJobLog> {
    const operation = 'gh-action-job-log';
    const target = await this.github.requireGitHub(repositoryId, operation);
    const cancel = signal ? { signal } : {};
    const job = parseActionRunJob((await this.github.runRead(['api', `repos/${target.nameWithOwner}/actions/jobs/${jobId}`], { ...this.options(target, operation), ...cancel })).stdout, operation);
    if (job.status !== 'completed') return { state: 'pending', jobId };
    if (job.conclusion === 'skipped' || !job.startedAt) return { state: 'unavailable', jobId, reason: 'not-run' };
    const options = { ...this.options(target, operation), ...cancel, timeoutMs: GITHUB_NETWORK_TIMEOUT_MS, maxOutputBytes: ACTION_JOB_LOG_LIMITS.readBytes, allowTruncatedOutput: true };
    const endpoint = `repos/${target.nameWithOwner}/actions/jobs/${jobId}/logs`;
    // Newer GitHub CLIs refuse to print a response with terminal escape codes unless told to, and a log has
    // colors; older ones don't know the flag. The text is never printed to a terminal: it is parsed below.
    let result = await this.github.run(target.executable, ['api', '--allow-escape-sequences', endpoint], options);
    if (result.exitCode !== 0 && /unknown flag:? .*allow-escape-sequences/i.test(result.stderr)) result = await this.github.run(target.executable, ['api', endpoint], options);
    if (result.exitCode !== 0 && /HTTP (?:404|410)\b/i.test(result.stderr)) return { state: 'unavailable', jobId, reason: 'expired' };
    if (result.exitCode !== 0) throw this.github.failure(result, options);
    return parseActionJobLog(result.stdout, job, result.truncated === true);
  }

  /** The jobs of the workflow file at the run's commit. Without it the graph still shows every job, unconnected. */
  private async workflowJobs(target: GitHubTarget, sha: string, path: string | null, operation: string): Promise<WorkflowJobDefinition[] | null> {
    if (!path || !WORKFLOW_FILE.test(path) || !/^[0-9a-f]{40}$/i.test(sha)) return null;
    const key = `${target.nameWithOwner}@${sha}:${path}`;
    if (this.workflowFiles.has(key)) return this.workflowFiles.get(key)!;
    const text = await this.readFile(target, path, sha, operation);
    const definition = text === null ? null : parseWorkflowJobs(text);
    // A failed read is tried again next time; a file that isn't a workflow is remembered as such.
    if (text !== null) {
      this.workflowFiles.set(key, definition);
      if (this.workflowFiles.size > WORKFLOW_FILE_CACHE_SIZE) this.workflowFiles.delete(this.workflowFiles.keys().next().value!);
    }
    return definition;
  }
}

function parseContentsFileSafely(raw: string): string | null {
  try { return parseContentsFile(raw); } catch { return null; }
}
