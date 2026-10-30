import type { PullRequestLiveState } from './contracts';

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
  if (state.mergeable === 'CONFLICTING' || state.mergeStateStatus === 'DIRTY') return { tone: 'danger', label: `Conflicts with ${state.baseRefName}` };
  if (state.isDraft) return null;
  if (state.mergeQueue.queued) return { tone: 'progress', label: 'In merge queue' };
  if (state.mergeable === 'UNKNOWN' || state.mergeStateStatus === 'UNKNOWN') return { tone: 'progress', label: 'Checking mergeability…' };
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
