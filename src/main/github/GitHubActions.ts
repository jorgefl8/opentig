import type { ActionRunDetails, ActionRunPage, WorkflowTriggers } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';
import { GITHUB_LIVE_READ_TIMEOUT_MS } from '../../shared/operation-timeouts';
import type { GitHubAccess, GitHubTarget } from './GitHubAccess';
import { parseActionRun, parseActionRunJobs, parseActionRunPage, parseBranchNames, parseContentsFile } from './ActionRunParser';
import { parseWorkflowTriggers } from './WorkflowDispatch';
import { buildRunGraph, parseWorkflowJobs, type WorkflowJobDefinition } from './WorkflowGraph';

export const RUN_PAGE_SIZE = 50;
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
