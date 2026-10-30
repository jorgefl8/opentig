import { GhOperationError } from '../../shared/errors';
import { z } from 'zod';
import type { CommentOnPullRequestInput, PullRequestActionInput, PullRequestActionResult, PullRequestLiveState, ReviewPullRequestInput, UpdatePullRequestInput } from '../../shared/contracts';
import { pullRequestActionBlocked } from '../../shared/pull-request-actions';
import { redactCommandToken } from './GitHubAccountAuth';
import { classifyActionFailure } from './GitHubActionErrors';
import { beginGitHubMutation, withPrivateTextFile, type GitHubAccess, type GitHubTarget } from './GitHubAccess';
import { parseCreatedPullRequestUrl } from './PullRequestParser';

const OPERATION = 'gh-pr-action';
// With the reads around it, this stays inside the command's 180 s window.
const ACTION_PROCESS_TIMEOUT_MS = 45_000;
const ZERO_OID = '0'.repeat(40);

const MERGE = 'mutation($id:ID!,$method:PullRequestMergeMethod!,$head:GitObjectID!){mergePullRequest(input:{pullRequestId:$id,mergeMethod:$method,expectedHeadOid:$head}){clientMutationId}}';
const ENABLE_AUTO_MERGE = 'mutation($id:ID!,$method:PullRequestMergeMethod!,$head:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method,expectedHeadOid:$head}){clientMutationId}}';
const DISABLE_AUTO_MERGE = 'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}';
const UPDATE_BRANCH = 'mutation($id:ID!,$head:GitObjectID!,$method:PullRequestBranchUpdateMethod!){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$head,updateMethod:$method}){clientMutationId}}';
const DELETE_BRANCH = 'mutation($repository:ID!,$ref:GitRefname!,$before:GitObjectID!,$after:GitObjectID!){updateRefs(input:{repositoryId:$repository,refUpdates:[{name:$ref,beforeOid:$before,afterOid:$after}]}){clientMutationId}}';

const OPEN_HEADS = `query($owner:String!,$name:String!,$head:String!){repository(owner:$owner,name:$name){pullRequests(headRefName:$head,states:[OPEN],first:100){pageInfo{hasNextPage} nodes{number headRefOid isCrossRepository headRepositoryOwner{login}}}}}`;
const openHeadsSchema = z.object({ data: z.object({ repository: z.object({ pullRequests: z.object({
  pageInfo: z.object({ hasNextPage: z.boolean() }),
  nodes: z.array(z.object({ number: z.number(), headRefOid: z.string(), isCrossRepository: z.boolean(), headRepositoryOwner: z.object({ login: z.string() }).nullable() })),
}) }) }) });
const waitingRunsSchema = z.object({ workflow_runs: z.array(z.object({ id: z.number().int().positive(), status: z.string().nullish(), conclusion: z.string().nullish(), head_branch: z.string().nullish() })) });
const RUNS_PER_PAGE = 100;
// Approving asks GitHub again for every run, so stop before the command's window closes.
const APPROVAL_WINDOW_MS = 120_000;

export class PullRequestActionRunner {
  constructor(private readonly github: GitHubAccess) {}

  async update(input: UpdatePullRequestInput): Promise<void> {
    const operation = 'gh-pr-update';
    const { target, verifyAccount } = await beginGitHubMutation(this.github, input, operation);
    this.github.invalidate(input.repositoryId);
    const state = await this.github.readLiveState(input.repositoryId, input.number);
    if (state.updatedAt !== input.expectedUpdatedAt) throw new GhOperationError({ code: 'GH_PR_STATE_CHANGED', operation, message: 'This pull request changed on GitHub after you started editing. Your changes were not saved.' });
    if (!state.viewer.canUpdate) throw new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation, message: "This GitHub account can't update this pull request." });
    verifyAccount();
    try {
      await withPrivateTextFile(input.body, (bodyFile) => this.gh(target, ['pr', 'edit', String(input.number), '-R', target.nameWithOwner, '--title', input.title, '--body-file', bodyFile], operation));
    } finally {
      this.github.invalidate(input.repositoryId);
    }
  }

  async comment(input: CommentOnPullRequestInput): Promise<void> {
    const operation = 'gh-pr-comment';
    const { target } = await beginGitHubMutation(this.github, input, operation);
    try {
      await withPrivateTextFile(input.body, (bodyFile) => this.gh(target, ['pr', 'comment', String(input.number), '-R', target.nameWithOwner, '--body-file', bodyFile], operation));
    } finally {
      this.github.invalidate(input.repositoryId);
    }
  }

  async review(input: ReviewPullRequestInput): Promise<void> {
    const operation = 'gh-pr-review';
    const { target, verifyAccount } = await beginGitHubMutation(this.github, input, operation);
    this.github.invalidate(input.repositoryId);
    const state = await this.github.readLiveState(input.repositoryId, input.number);
    if (state.headRefOid !== input.expectedHeadOid) throw new GhOperationError({ code: 'GH_PR_STATE_CHANGED', operation, message: 'This pull request has new commits. Review them and try again.' });
    if (state.state !== 'OPEN') throw new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation, message: 'This pull request is no longer open.' });
    if (state.viewer.didAuthor && input.verdict !== 'comment') throw new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation, message: "GitHub doesn't let you approve or request changes on your own pull request." });
    verifyAccount();
    const flag = input.verdict === 'approve' ? '--approve' : input.verdict === 'request-changes' ? '--request-changes' : '--comment';
    const args = ['pr', 'review', String(input.number), '-R', target.nameWithOwner, flag];
    try {
      if (input.body.trim()) await withPrivateTextFile(input.body, (bodyFile) => this.gh(target, [...args, '--body-file', bodyFile], operation));
      else await this.gh(target, args, operation);
    } finally {
      this.github.invalidate(input.repositoryId);
    }
  }

  async run(input: PullRequestActionInput): Promise<PullRequestActionResult> {
    const { target, verifyAccount } = await beginGitHubMutation(this.github, input, OPERATION);
    this.github.invalidate(input.repositoryId);
    const state = await this.github.readLiveState(input.repositoryId, input.number);
    // Someone else, or GitHub itself, already removed the branch.
    if (input.action === 'delete-branch' && state.state !== 'OPEN' && state.head.refOid === null) return { outcome: 'done', state, branchDeleted: true };
    if (state.headRefOid !== input.expectedHeadOid) throw new GhOperationError({ code: 'GH_PR_STATE_CHANGED', operation: OPERATION, message: 'This pull request changed. Review it and try again.' });
    const blocked = pullRequestActionBlocked(state, input.action);
    if (blocked) throw new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation: OPERATION, message: blocked });
    if ((input.action === 'merge' || input.action === 'enable-auto-merge') && !state.repository.methods.includes(input.method)) {
      throw new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation: OPERATION, message: "This repository doesn't allow that merge method." });
    }
    verifyAccount();
    let created: PullRequestActionResult['created'];
    try {
      created = await this.execute(input, state, target);
    } finally {
      this.github.invalidate(input.repositoryId);
    }
    // The action already happened: a failed read must not present it as failed.
    const after = await this.github.readLiveState(input.repositoryId, input.number).catch(() => null);
    if (!after) return { outcome: 'unconfirmed', state: null, ...(created ? { created } : {}) };
    const branchDeleted = input.action === 'merge' && input.deleteBranch ? await this.deleteBranchAfterMerge(input, after, target) : undefined;
    return { outcome: outcomeOf(input, after), state: after, ...(created ? { created } : {}), ...(branchDeleted !== undefined ? { branchDeleted } : {}) };
  }

  /** A merge that went through stays reported as merged: a failed removal only means the branch remains. */
  private async deleteBranchAfterMerge(input: PullRequestActionInput, state: PullRequestLiveState, target: GitHubTarget): Promise<boolean> {
    if (state.state !== 'MERGED' || pullRequestActionBlocked(state, 'delete-branch')) return false;
    try {
      await this.deleteBranch(state, target);
      return true;
    } catch {
      return false;
    } finally {
      this.github.invalidate(input.repositoryId);
    }
  }

  private async execute(input: PullRequestActionInput, state: PullRequestLiveState, target: GitHubTarget): Promise<PullRequestActionResult['created']> {
    const number = String(input.number);
    switch (input.action) {
      case 'revert': {
        const created = parseCreatedPullRequestUrl(await this.gh(target, ['pr', 'revert', number, '-R', target.nameWithOwner]));
        if (!created) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation: OPERATION, message: 'GitHub CLI did not return the URL of the revert pull request.' });
        return created;
      }
      case 'approve-workflows':
        await this.approveWorkflows(input.repositoryId, state, target);
        return;
      case 'merge':
        // Queues only accept the auto-merge route, which is also how `gh` and GitHub's own UI add to one.
        await this.graphql(target, state.mergeQueue.enabled ? ENABLE_AUTO_MERGE : MERGE, { id: state.id, method: input.method, head: state.headRefOid });
        return;
      case 'enable-auto-merge':
        await this.graphql(target, ENABLE_AUTO_MERGE, { id: state.id, method: input.method, head: state.headRefOid });
        return;
      case 'disable-auto-merge':
        await this.graphql(target, DISABLE_AUTO_MERGE, { id: state.id });
        return;
      case 'update-branch':
        await this.graphql(target, UPDATE_BRANCH, { id: state.id, head: state.headRefOid, method: input.method });
        return;
      case 'delete-branch':
        await this.deleteBranch(state, target);
        return;
      case 'ready':
        await this.gh(target, ['pr', 'ready', number, '-R', target.nameWithOwner]);
        return;
      case 'draft':
        await this.gh(target, ['pr', 'ready', number, '-R', target.nameWithOwner, '--undo']);
        return;
      case 'close':
        await this.gh(target, ['pr', 'close', number, '-R', target.nameWithOwner]);
        return;
      case 'reopen':
        await this.gh(target, ['pr', 'reopen', number, '-R', target.nameWithOwner]);
    }
  }

  /**
   * A fork can open several PRs, and GitHub's list of waiting runs only knows
   * branch and commit. Approving is limited to runs that can only belong to
   * this PR, and each one is checked again just before approving it, because
   * approving lets the fork's code run with the repository's workflows.
   */
  private async approveWorkflows(repositoryId: string, state: PullRequestLiveState, target: GitHubTarget): Promise<void> {
    const deadline = Date.now() + APPROVAL_WINDOW_MS;
    for (const id of await this.waitingRuns(state, target)) {
      if (Date.now() > deadline) throw new GhOperationError({ code: 'GH_TIMEOUT', operation: OPERATION, message: 'Some workflows may still need approval. Check the pull request and try again.', retryable: true });
      const current = await this.github.readLiveState(repositoryId, state.number);
      if (current.headRefOid !== state.headRefOid || current.headRefName !== state.headRefName || current.head.owner?.toLowerCase() !== state.head.owner?.toLowerCase() || !current.isCrossRepository) {
        throw new GhOperationError({ code: 'GH_PR_STATE_CHANGED', operation: OPERATION, message: 'This pull request changed. Review it and try again.' });
      }
      if ((await this.waitingRuns(current, target)).includes(id)) await this.gh(target, ['api', '-X', 'POST', `repos/${target.nameWithOwner}/actions/runs/${id}/approve`]);
    }
  }

  private async waitingRuns(state: PullRequestLiveState, target: GitHubTarget): Promise<number[]> {
    const owner = state.head.owner;
    const refuse = (message: string) => new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation: OPERATION, message });
    if (!state.isCrossRepository || !owner) throw refuse('Only workflows from a fork need approval.');
    const [baseOwner, baseName] = target.nameWithOwner.split('/');
    const heads = openHeadsSchema.safeParse(parseJson(await this.gh(target, ['api', 'graphql', '-f', `owner=${baseOwner}`, '-f', `name=${baseName}`, '-f', `head=${state.headRefName}`, '-f', `query=${OPEN_HEADS}`])));
    if (!heads.success) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation: OPERATION, message: 'GitHub returned unreadable pull request data.' });
    const { pageInfo, nodes } = heads.data.data.repository.pullRequests;
    if (pageInfo.hasNextPage) throw refuse('Too many pull requests use this branch name to tell which runs belong to this one. Approve on GitHub.');
    const sameHead = nodes.filter((pull) => pull.headRefOid === state.headRefOid && pull.isCrossRepository && pull.headRepositoryOwner?.login.toLowerCase() === owner.toLowerCase());
    if (sameHead.length !== 1 || sameHead[0]!.number !== state.number) throw refuse('Another pull request uses the same commit from this fork, so its runs can\'t be told apart. Approve on GitHub.');
    const query = new URLSearchParams({ head_sha: state.headRefOid, branch: state.headRefName, event: 'pull_request', status: 'action_required', per_page: String(RUNS_PER_PAGE) });
    const runs = waitingRunsSchema.safeParse(parseJson(await this.gh(target, ['api', `repos/${target.nameWithOwner}/actions/runs?${query}`])));
    if (!runs.success) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation: OPERATION, message: 'GitHub returned unreadable workflow runs.' });
    if (runs.data.workflow_runs.length >= RUNS_PER_PAGE) throw refuse('Too many workflow runs are waiting. Approve them on GitHub.');
    return runs.data.workflow_runs.filter((run) => (run.conclusion === 'action_required' || run.status === 'action_required') && run.head_branch === state.headRefName).map((run) => run.id);
  }

  /** Fails if the branch moved after this read, and the branch of a fork lives in the fork rather than the base repository. */
  private deleteBranch(state: PullRequestLiveState, target: GitHubTarget): Promise<string> {
    if (!state.head.repositoryId) throw new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation: OPERATION, message: "The source repository of this pull request isn't available." });
    return this.graphql(target, DELETE_BRANCH, { repository: state.head.repositoryId, ref: `refs/heads/${state.headRefName}`, before: state.headRefOid, after: ZERO_OID });
  }

  private graphql(target: GitHubTarget, query: string, variables: Record<string, string>): Promise<string> {
    return this.gh(target, ['api', 'graphql', ...Object.entries(variables).flatMap(([key, value]) => ['-f', `${key}=${value}`]), '-f', `query=${query}`]);
  }

  private async gh(target: GitHubTarget, args: string[], operation = OPERATION): Promise<string> {
    const result = await this.github.run(target.executable, args, { auth: target.auth, executable: target.executable, cwd: target.repository.path, operation, timeoutMs: ACTION_PROCESS_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 });
    if (result.exitCode !== 0) throw classifyActionFailure({ ...result, stderr: redactCommandToken(result.stderr, target.auth) }, operation);
    return result.stdout;
  }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

/** What GitHub says happened, read after the action, rather than what was asked for. */
function outcomeOf(input: PullRequestActionInput, state: PullRequestLiveState): PullRequestActionResult['outcome'] {
  switch (input.action) {
    case 'merge':
      if (state.state === 'MERGED') return 'merged';
      if (state.mergeQueue.queued) return 'queued';
      return state.autoMerge ? 'auto-merge-enabled' : 'unconfirmed';
    case 'enable-auto-merge':
      if (state.state === 'MERGED') return 'merged';
      return state.autoMerge ? 'auto-merge-enabled' : 'unconfirmed';
    case 'disable-auto-merge':
      return state.autoMerge ? 'unconfirmed' : 'auto-merge-disabled';
    case 'update-branch':
      return 'updated';
    default:
      return 'done';
  }
}
