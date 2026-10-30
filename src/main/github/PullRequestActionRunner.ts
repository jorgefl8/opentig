import { GhOperationError } from '../../shared/errors';
import type { PullRequestActionInput, PullRequestActionResult, PullRequestLiveState } from '../../shared/contracts';
import { pullRequestActionBlocked } from '../../shared/pull-request-actions';
import { redactCommandToken } from './GitHubAccountAuth';
import { classifyActionFailure } from './GitHubActionErrors';
import type { GitHubAccess, GitHubTarget } from './GitHubAccess';

const OPERATION = 'gh-pr-action';
// With the reads around it, this stays inside the command's 180 s window.
const ACTION_PROCESS_TIMEOUT_MS = 45_000;
const ZERO_OID = '0'.repeat(40);

const MERGE = 'mutation($id:ID!,$method:PullRequestMergeMethod!,$head:GitObjectID!){mergePullRequest(input:{pullRequestId:$id,mergeMethod:$method,expectedHeadOid:$head}){clientMutationId}}';
const ENABLE_AUTO_MERGE = 'mutation($id:ID!,$method:PullRequestMergeMethod!,$head:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method,expectedHeadOid:$head}){clientMutationId}}';
const DISABLE_AUTO_MERGE = 'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}';
const UPDATE_BRANCH = 'mutation($id:ID!,$head:GitObjectID!,$method:PullRequestBranchUpdateMethod!){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$head,updateMethod:$method}){clientMutationId}}';
const DELETE_BRANCH = 'mutation($repository:ID!,$ref:GitRefname!,$before:GitObjectID!,$after:GitObjectID!){updateRefs(input:{repositoryId:$repository,refUpdates:[{name:$ref,beforeOid:$before,afterOid:$after}]}){clientMutationId}}';

export class PullRequestActionRunner {
  constructor(private readonly github: GitHubAccess) {}

  async run(input: PullRequestActionInput): Promise<PullRequestActionResult> {
    const { repository, nameWithOwner, auth, executable, context } = await this.github.requireGitHub(input.repositoryId, OPERATION);
    const target: GitHubTarget = { repository, nameWithOwner, auth, executable };
    const verifyAccount = () => {
      const expected = input.expectedAccount;
      if (expected.revision !== this.github.revisionFor(repository) || expected.revision !== context.revision || expected.login.toLowerCase() !== context.login?.toLowerCase()) {
        throw new GhOperationError({ code: 'GH_ACCOUNT_UNRESOLVED', operation: OPERATION, message: 'The GitHub account changed. Review the current identity before continuing.' });
      }
    };
    verifyAccount();
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
    try {
      await this.execute(input, state, target);
    } finally {
      this.github.invalidate(input.repositoryId);
    }
    // The action already happened: a failed read must not present it as failed.
    const after = await this.github.readLiveState(input.repositoryId, input.number).catch(() => null);
    if (!after) return { outcome: 'unconfirmed', state: null };
    const branchDeleted = input.action === 'merge' && input.deleteBranch ? await this.deleteBranchAfterMerge(input, after, target) : undefined;
    return { outcome: outcomeOf(input, after), state: after, ...(branchDeleted !== undefined ? { branchDeleted } : {}) };
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

  private async execute(input: PullRequestActionInput, state: PullRequestLiveState, target: GitHubTarget): Promise<void> {
    const number = String(input.number);
    switch (input.action) {
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

  /** Fails if the branch moved after this read, and the branch of a fork lives in the fork rather than the base repository. */
  private deleteBranch(state: PullRequestLiveState, target: GitHubTarget): Promise<string> {
    if (!state.head.repositoryId) throw new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation: OPERATION, message: "The source repository of this pull request isn't available." });
    return this.graphql(target, DELETE_BRANCH, { repository: state.head.repositoryId, ref: `refs/heads/${state.headRefName}`, before: state.headRefOid, after: ZERO_OID });
  }

  private graphql(target: GitHubTarget, query: string, variables: Record<string, string>): Promise<string> {
    return this.gh(target, ['api', 'graphql', ...Object.entries(variables).flatMap(([key, value]) => ['-f', `${key}=${value}`]), '-f', `query=${query}`]);
  }

  private async gh(target: GitHubTarget, args: string[]): Promise<string> {
    const result = await this.github.run(target.executable, args, { auth: target.auth, executable: target.executable, cwd: target.repository.path, operation: OPERATION, timeoutMs: ACTION_PROCESS_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 });
    if (result.exitCode !== 0) throw classifyActionFailure({ ...result, stderr: redactCommandToken(result.stderr, target.auth) }, OPERATION);
    return result.stdout;
  }
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
