import type { BranchDetails, BranchInfo, ManagedWorktree, WorktreeDetails } from '../../../shared/git-types';

export type LocalRefsTab = 'branches' | 'worktrees';

/** Windows paths compare case-insensitively and ignore separator spelling. */
export function normalizeWorktreePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
}

export function samePath(left: string, right: string): boolean {
  return normalizeWorktreePath(left) === normalizeWorktreePath(right);
}

/** The trailing folder name, which is what identifies a worktree at a glance. */
export function worktreeName(worktreePath: string): string {
  const segments = worktreePath.replace(/[\\/]+$/, '').split(/[\\/]/);
  return segments[segments.length - 1] || worktreePath;
}

/**
 * Filters by name, ref, upstream, or tip while preserving the backend order,
 * which already puts the checked-out branch first.
 */
export function filterBranches(branches: BranchInfo[], query: string): BranchInfo[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return branches;
  return branches.filter((branch) => [branch.name, branch.fullName, branch.upstream ?? '', branch.shortOid, branch.subject]
    .some((field) => field.toLocaleLowerCase().includes(needle)));
}

/** Keeps the main worktree first, then the open one, then folder name order. */
export function filterWorktrees(worktrees: ManagedWorktree[], query: string): ManagedWorktree[] {
  const needle = query.trim().toLocaleLowerCase();
  const matched = !needle
    ? [...worktrees]
    : worktrees.filter((worktree) => [worktree.path, worktree.branch ?? '', worktreeName(worktree.path)]
      .some((field) => field.toLocaleLowerCase().includes(needle)));
  return matched.sort((left, right) => {
    if (left.main !== right.main) return left.main ? -1 : 1;
    if (left.current !== right.current) return left.current ? -1 : 1;
    return worktreeName(left.path).localeCompare(worktreeName(right.path), 'en', { sensitivity: 'base', numeric: true });
  });
}

export interface RefBadge {
  label: string;
  tone: 'current' | 'neutral' | 'warning';
}

/** Takes the smallest shape it needs so list rows and detail panels can share it. */
export function branchBadges(branch: Pick<BranchInfo, 'current' | 'worktreePath' | 'upstream' | 'ahead' | 'behind'>): RefBadge[] {
  const badges: RefBadge[] = [];
  if (branch.current) badges.push({ label: 'Current', tone: 'current' });
  else if (branch.worktreePath) badges.push({ label: 'In a worktree', tone: 'warning' });
  if (branch.upstream) {
    if (branch.ahead > 0) badges.push({ label: `↑${branch.ahead}`, tone: 'neutral' });
    if (branch.behind > 0) badges.push({ label: `↓${branch.behind}`, tone: 'neutral' });
  } else {
    badges.push({ label: 'No upstream', tone: 'neutral' });
  }
  return badges;
}

/** Details carry the deletion state rather than a `current` flag. */
export function branchDetailBadges(details: BranchDetails): RefBadge[] {
  return branchBadges({
    current: details.deletion === 'current',
    worktreePath: details.deletion === 'checked-out' ? details.worktreePath : null,
    upstream: details.upstream,
    ahead: details.ahead,
    behind: details.behind,
  });
}

export function worktreeBadges(worktree: Pick<ManagedWorktree, 'main' | 'current' | 'bare' | 'detached' | 'locked' | 'prunable'>): RefBadge[] {
  const badges: RefBadge[] = [];
  if (worktree.main) badges.push({ label: 'Main', tone: 'neutral' });
  if (worktree.current) badges.push({ label: 'Open', tone: 'current' });
  if (worktree.bare) badges.push({ label: 'Bare', tone: 'warning' });
  if (worktree.detached) badges.push({ label: 'Detached HEAD', tone: 'warning' });
  if (worktree.locked) badges.push({ label: 'Locked', tone: 'warning' });
  if (worktree.prunable) badges.push({ label: 'Missing', tone: 'warning' });
  return badges;
}

export interface DeleteEligibility {
  /** Only `true` renders a destructive control. */
  allowed: boolean;
  /** Why the action is offered or refused, in the user's terms. */
  reason: string;
}

/**
 * Branch deletion eligibility, derived only from the backend's structured
 * state. The copy names the comparison base so "merged" is never a mystery.
 */
export function branchDeleteEligibility(details: BranchDetails): DeleteEligibility {
  switch (details.deletion) {
    case 'safe':
      return { allowed: true, reason: `Fully merged into ${details.comparisonBase ?? 'its comparison base'}, so Git can delete it without losing commits.` };
    case 'current':
      return { allowed: false, reason: 'This is the branch you have checked out. Switch to another branch first.' };
    case 'checked-out':
      return { allowed: false, reason: `Checked out in the worktree ${details.worktreePath ?? 'another worktree'}. Close or switch that worktree first.` };
    case 'unmerged':
      return {
        allowed: false,
        reason: `${details.uniqueCommits} ${details.uniqueCommits === 1 ? 'commit is' : 'commits are'} not in ${details.comparisonBase ?? 'the comparison base'}. JustGit never force-deletes a branch.`,
      };
    default:
      return {
        allowed: false,
        reason: details.comparisonBase
          ? `${details.comparisonBase} is not available locally, so JustGit cannot tell whether this branch is merged.`
          : 'JustGit cannot tell whether this branch is merged, so it will not delete it.',
      };
  }
}

/** Every reason a worktree cannot be removed, in the order the user should see. */
export function worktreeRemoveEligibility(details: WorktreeDetails): DeleteEligibility {
  if (details.main) return { allowed: false, reason: 'This is the repository\'s main worktree. Git can never remove it.' };
  if (details.current) return { allowed: false, reason: 'JustGit has this worktree open. Switch to another worktree first.' };
  if (details.bare) return { allowed: false, reason: 'This entry is a bare repository, not a removable worktree.' };
  if (details.locked) return { allowed: false, reason: `Locked${details.locked === 'locked' ? '' : `: ${details.locked}`}. Unlock it in Git before removing it.` };
  if (details.prunable) return { allowed: false, reason: 'Git can no longer find this worktree on disk, so there is nothing to remove.' };
  if (details.operation) return { allowed: false, reason: `A ${details.operation} is in progress here. Finish or abort it first.` };
  const pending = localChangeSummary(details);
  if (pending) return { allowed: false, reason: `${pending} would be lost. Commit, stash, or discard them first.` };
  return { allowed: true, reason: 'No local changes. Removing it deletes the folder from disk and leaves its branch intact.' };
}

/** A human count of everything that is not committed, or `null` when clean. */
export function localChangeSummary(details: WorktreeDetails): string | null {
  const parts = [
    [details.conflictCount, 'conflicted'],
    [details.stagedCount, 'staged'],
    [details.unstagedCount, 'unstaged'],
    [details.untrackedCount, 'untracked'],
  ] as const;
  const present = parts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  if (present.length === 0) return null;
  const total = parts.reduce((sum, [count]) => sum + count, 0);
  return `${present.join(', ')} ${total === 1 ? 'change' : 'changes'}`;
}

/**
 * Keeps a selection alive across refreshes. The same row wins when it survived;
 * otherwise the row that took its place in the old ordering does, so deleting
 * an item lands the user on its neighbour instead of on nothing.
 */
export function nextSelectionKey(nextKeys: string[], previousKeys: string[], selected: string | null): string | null {
  if (nextKeys.length === 0) return null;
  if (selected && nextKeys.includes(selected)) return selected;
  const previousIndex = selected ? previousKeys.indexOf(selected) : -1;
  if (previousIndex < 0) return nextKeys[0] ?? null;
  return nextKeys[Math.min(previousIndex, nextKeys.length - 1)] ?? null;
}

export function branchKey(branch: BranchInfo): string {
  return branch.fullName;
}

export function worktreeKey(worktree: ManagedWorktree): string {
  return normalizeWorktreePath(worktree.path);
}
