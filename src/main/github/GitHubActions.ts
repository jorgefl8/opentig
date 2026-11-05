import type { ActionRunDetails, ActionRunSummary } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';
import { GITHUB_LIVE_READ_TIMEOUT_MS } from '../../shared/operation-timeouts';
import type { GitHubAccess, GitHubTarget } from './GitHubAccess';
import { ACTION_RUN_FIELDS, parseActionRun, parseActionRunJobs, parseActionRunList, parseContentsFile } from './ActionRunParser';
import { buildRunGraph, parseWorkflowJobs, type WorkflowJobDefinition } from './WorkflowGraph';

const RUN_LIST_LIMIT = 50;
const JOBS_PER_PAGE = 100;
const WORKFLOW_FILE_CACHE_SIZE = 50;

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

  async listRuns(repositoryId: string, workflowId: number | null): Promise<ActionRunSummary[]> {
    const operation = 'gh-action-run-list';
    const target = await this.github.requireGitHub(repositoryId, operation);
    const filter = workflowId === null ? [] : ['--workflow', String(workflowId)];
    return parseActionRunList(await this.read(target, ['run', 'list', '-R', target.nameWithOwner, '--limit', String(RUN_LIST_LIMIT), ...filter, '--json', ACTION_RUN_FIELDS], operation));
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

  /** The jobs of the workflow file at the run's commit. Without it the graph still shows every job, unconnected. */
  private async workflowJobs(target: GitHubTarget, sha: string, path: string | null, operation: string): Promise<WorkflowJobDefinition[] | null> {
    if (!path || !/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) || !/^[0-9a-f]{40}$/i.test(sha)) return null;
    const key = `${target.nameWithOwner}@${sha}:${path}`;
    if (this.workflowFiles.has(key)) return this.workflowFiles.get(key)!;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const result = await this.github.run(target.executable, ['api', `repos/${target.nameWithOwner}/contents/${encodedPath}?ref=${sha}`], this.options(target, operation)).catch(() => null);
    const text = result?.exitCode === 0 ? parseContentsFileSafely(result.stdout) : null;
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
