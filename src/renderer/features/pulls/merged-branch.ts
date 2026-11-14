import type { PullRequestSummary } from '@shared/contracts';
import type { BranchInfo, WorktreeInfo } from '@shared/git-types';
import { samePath } from '@/features/refs/local-refs-model';

/**
 * How to leave a checked-out branch whose pull request is merged, before deleting it:
 * a main checkout switches to the pull request's base, a linked worktree is left for
 * the main one. `from` is the folder it starts in.
 */
export type MergedBranchCleanUp =
  | { kind: 'branch'; from: string; branch: string; base: Pick<BranchInfo, 'name' | 'fullName'> }
  | { kind: 'worktree'; from: string; mainPath: string };

/** Null when there is nowhere safe to go first, so no clean-up is offered. */
export function mergedBranchCleanUp(input: {
  pullRequest: Pick<PullRequestSummary, 'baseRefName'>;
  branch: string;
  repositoryPath: string;
  branches: readonly BranchInfo[];
  worktrees: readonly WorktreeInfo[];
}): MergedBranchCleanUp | null {
  const { pullRequest, branch, repositoryPath } = input;
  const current = input.worktrees.find((item) => samePath(item.path, repositoryPath));
  if (current && !current.main) {
    const main = input.worktrees.find((item) => item.main && !item.bare && !item.prunable);
    return main ? { kind: 'worktree', from: current.path, mainPath: main.path } : null;
  }
  const base = input.branches.find((item) => !item.remote && item.name === pullRequest.baseRefName);
  if (!base || base.name === branch) return null;
  // Git refuses to check out here a branch that another worktree has checked out.
  if (base.worktreePath && !samePath(base.worktreePath, repositoryPath)) return null;
  return { kind: 'branch', from: repositoryPath, branch: `refs/heads/${branch}`, base: { name: base.name, fullName: base.fullName } };
}

export function mergedBranchCleanUpLabel(cleanUp: MergedBranchCleanUp): string {
  return cleanUp.kind === 'worktree' ? 'Remove this worktree and delete the branch…' : `Switch to ${cleanUp.base.name} and delete this branch…`;
}

/**
 * Whether a started clean-up has arrived where it was going. The switch has its own
 * prompts and can be cancelled or fail, so the deletion is offered (`open`) only once
 * the app is really there, and forgotten (`drop`) when the switch ended anywhere else.
 */
export function mergedBranchCleanUpStep(cleanUp: MergedBranchCleanUp, now: {
  repositoryPath: string; branch: string | null; switching: boolean; conflicts: boolean;
}): 'wait' | 'open' | 'drop' {
  if (cleanUp.kind === 'worktree') {
    if (samePath(now.repositoryPath, cleanUp.mainPath)) return 'open';
  } else if (samePath(now.repositoryPath, cleanUp.from) && now.branch === cleanUp.base.name) {
    // Changes moved along with conflicts need attention before anything is deleted.
    return now.conflicts ? 'drop' : 'open';
  }
  return now.switching && samePath(now.repositoryPath, cleanUp.from) ? 'wait' : 'drop';
}

/** "2 commits", for the commits a branch gained after its pull request was merged. */
export function commitCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'commit' : 'commits'}`;
}
