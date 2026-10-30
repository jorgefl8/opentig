import type { PullRequestAction, PullRequestLiveState } from './contracts';

export type PullRequestStatusTone = 'ready' | 'attention' | 'danger' | 'progress';

export interface PullRequestStatusLine {
  tone: PullRequestStatusTone;
  label: string;
  detail?: string;
}

/** Why GitHub won't merge a blocked PR: reviews first, then required checks, then rules OpenTig can't see. */
export function pullRequestBlockReason(state: Pick<PullRequestLiveState, 'reviewDecision' | 'checks'>): string {
  if (state.reviewDecision === 'REVIEW_REQUIRED') return 'Review required';
  if (state.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested';
  const required = state.checks.items.filter((check) => check.required);
  if (required.some((check) => check.result === 'fail' || check.result === 'action-required')) return 'Required checks failing';
  if (required.some((check) => check.result === 'pending')) return 'Required checks pending';
  return 'A branch rule blocks merging';
}

/** One line on where an open PR stands. Finished PRs and drafts already say so in their state badge. */
export function pullRequestStatusLine(state: PullRequestLiveState): PullRequestStatusLine | null {
  if (state.state !== 'OPEN') return null;
  if (isConflicting(state)) return { tone: 'danger', label: `Conflicts with ${state.baseRefName}` };
  if (state.isDraft) return null;
  if (state.mergeQueue.queued) return { tone: 'progress', label: 'In merge queue' };
  if (isComputing(state)) return { tone: 'progress', label: 'Checking mergeability…' };
  switch (state.mergeStateStatus) {
    case 'BEHIND':
      return { tone: 'attention', label: state.behindBy ? `${state.behindBy} ${state.behindBy === 1 ? 'commit' : 'commits'} behind ${state.baseRefName}` : `Behind ${state.baseRefName}` };
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { tone: 'ready', label: 'Ready to merge' };
    case 'UNSTABLE':
      return { tone: 'ready', label: 'Ready to merge', detail: "Some optional checks haven't passed" };
    case 'BLOCKED':
      return { tone: 'attention', label: pullRequestBlockReason(state) };
    default:
      return null;
  }
}

const NOT_OPEN = 'This pull request is no longer open.';
const NO_WRITE = "This GitHub account doesn't have write access to this repository.";
const NO_UPDATE = "This GitHub account can't update this pull request.";

function isConflicting(state: PullRequestLiveState): boolean {
  return state.mergeable === 'CONFLICTING' || state.mergeStateStatus === 'DIRTY';
}

function isComputing(state: PullRequestLiveState): boolean {
  return state.mergeable === 'UNKNOWN' || state.mergeStateStatus === 'UNKNOWN';
}

function isReadyToMerge(state: PullRequestLiveState): boolean {
  return state.mergeStateStatus === 'CLEAN' || state.mergeStateStatus === 'HAS_HOOKS' || state.mergeStateStatus === 'UNSTABLE';
}

function mergingBlocked(state: PullRequestLiveState): string | null {
  if (state.state !== 'OPEN') return NOT_OPEN;
  if (state.isDraft) return 'Mark this pull request as ready for review first.';
  if (isConflicting(state)) return `This pull request conflicts with ${state.baseRefName}.`;
  if (isComputing(state)) return 'GitHub is still checking whether this pull request can be merged.';
  if (!state.viewer.canWrite) return NO_WRITE;
  if (state.stack === 'unknown') return "Couldn't confirm whether this pull request is part of a stack. Try again.";
  if (state.stack === 'member') return 'Layers of a stack are merged on GitHub.';
  if (state.autoMerge) return 'Auto-merge is already enabled.';
  if (state.mergeQueue.queued) return 'This pull request is already in the merge queue.';
  return null;
}

function branchRemovalBlocked(state: PullRequestLiveState): string | null {
  if (!state.viewer.canDeleteBranch) return "This GitHub account can't delete the source branch.";
  if (state.stack !== 'none') return 'Branches of a stack are managed on GitHub.';
  if (state.headRefName === state.baseRefName || state.headRefName === state.head.defaultBranch) return 'This is a protected branch of the repository.';
  if (state.head.refOid !== state.headRefOid) return 'The branch has moved since this pull request. Its new commits would be lost.';
  return null;
}

/** Why the action can't run on this state, or null when it can. The renderer and the server share this answer. */
export function pullRequestActionBlocked(state: PullRequestLiveState, action: PullRequestAction): string | null {
  const open = state.state === 'OPEN';
  switch (action) {
    case 'ready':
      if (!open) return NOT_OPEN;
      if (!state.isDraft) return 'This pull request is already ready for review.';
      return state.viewer.canUpdate ? null : NO_UPDATE;
    case 'draft':
      if (!open) return NOT_OPEN;
      if (state.isDraft) return 'This pull request is already a draft.';
      if (state.mergeQueue.queued) return "A pull request in the merge queue can't become a draft.";
      return state.viewer.canUpdate ? null : NO_UPDATE;
    case 'close':
      if (!open) return NOT_OPEN;
      return state.viewer.canUpdate ? null : NO_UPDATE;
    case 'reopen':
      if (state.state !== 'CLOSED') return 'Only a closed pull request can be reopened.';
      return state.viewer.canUpdate ? null : NO_UPDATE;
    case 'merge': {
      const blocked = mergingBlocked(state);
      if (blocked) return blocked;
      if (!state.repository.methods.length) return "This repository doesn't allow any merge method.";
      if (isReadyToMerge(state) || state.mergeQueue.enabled) return null;
      return state.mergeStateStatus === 'BEHIND' ? 'Update the branch first.' : pullRequestBlockReason(state);
    }
    case 'enable-auto-merge': {
      const blocked = mergingBlocked(state);
      if (blocked) return blocked;
      if (state.mergeQueue.enabled) return 'This repository uses a merge queue.';
      if (!state.repository.autoMergeAllowed) return "This repository doesn't allow auto-merge.";
      return isReadyToMerge(state) ? 'This pull request can be merged now.' : null;
    }
    case 'disable-auto-merge':
      if (!state.autoMerge) return 'Auto-merge is not enabled.';
      return state.viewer.canWrite ? null : NO_WRITE;
    case 'update-branch':
      if (!open) return NOT_OPEN;
      if (!state.viewer.canUpdateBranch) return "This GitHub account can't update the branch.";
      if (state.mergeable !== 'MERGEABLE') return isConflicting(state) ? `This pull request conflicts with ${state.baseRefName}.` : 'GitHub is still checking whether this branch can be updated.';
      return state.mergeStateStatus === 'BEHIND' || (state.behindBy ?? 0) > 0 ? null : 'This branch is already up to date.';
    case 'delete-branch':
      return open ? 'Close or merge this pull request first.' : branchRemovalBlocked(state);
  }
}

const ACTIONS: PullRequestAction[] = ['merge', 'enable-auto-merge', 'disable-auto-merge', 'update-branch', 'ready', 'draft', 'close', 'reopen', 'delete-branch'];

/** What can be done whichever control is primary, so the state a button shows never hides an action. */
export function allowedPullRequestActions(state: PullRequestLiveState): PullRequestAction[] {
  return ACTIONS.filter((action) => pullRequestActionBlocked(state, action) === null);
}

/** Whether merging can also remove the branch: GitHub may do it for us, and auto-merge and queues finish after this moment. */
export function canDeleteBranchWithMerge(state: PullRequestLiveState): boolean {
  return !state.repository.deleteBranchOnMerge && !state.mergeQueue.enabled && branchRemovalBlocked(state) === null;
}

export type PullRequestPrimary =
  /** The state badge already says everything. */
  | { kind: 'none' }
  /** Nothing to press here, only a reason. */
  | { kind: 'text'; label: string }
  /** The state couldn't be established, and reading it again may help. */
  | { kind: 'retry'; label: string }
  /** This has to be done on GitHub. */
  | { kind: 'github'; label: string }
  | { kind: 'action'; action: PullRequestAction; label: string };

/** The main control of the viewer. The first matching case wins, and the order mirrors what blocks what on GitHub. */
export function resolvePullRequestPrimary(state: PullRequestLiveState): PullRequestPrimary {
  if (state.state !== 'OPEN') return { kind: 'none' };
  if (state.stack === 'member') return { kind: 'github', label: 'Merge on GitHub' };
  if (state.stack === 'unknown') return { kind: 'retry', label: "Couldn't confirm the stack" };
  if (isConflicting(state)) return { kind: 'text', label: `Conflicts with ${state.baseRefName}` };
  if (state.isDraft) return state.viewer.canUpdate ? { kind: 'action', action: 'ready', label: 'Ready for review' } : { kind: 'text', label: 'Draft' };
  if (state.mergeQueue.queued) return { kind: 'github', label: 'Manage on GitHub' };
  if (state.autoMerge) return { kind: 'none' };
  if (!state.viewer.canWrite) return { kind: 'text', label: 'Merging requires write access' };
  if (isComputing(state)) return { kind: 'text', label: 'Checking mergeability…' };
  if (state.mergeQueue.enabled) return { kind: 'action', action: 'merge', label: state.mergeStateStatus === 'CLEAN' ? 'Add to merge queue' : 'Merge when ready' };
  switch (state.mergeStateStatus) {
    case 'BEHIND':
      return state.viewer.canUpdateBranch ? { kind: 'action', action: 'update-branch', label: 'Update branch' } : { kind: 'text', label: 'Updating the branch requires write access' };
    case 'CLEAN':
    case 'HAS_HOOKS':
    case 'UNSTABLE':
      return { kind: 'action', action: 'merge', label: 'Merge' };
    case 'BLOCKED':
      return state.repository.autoMergeAllowed ? { kind: 'action', action: 'enable-auto-merge', label: 'Merge when ready' } : { kind: 'text', label: pullRequestBlockReason(state) };
    default:
      return { kind: 'none' };
  }
}
