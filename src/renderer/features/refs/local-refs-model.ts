import type { BranchDetails, BranchInfo, BrokenWorktreeLink, ManagedWorktree, WorktreeAgents, WorktreeDetails } from '../../../shared/git-types';
import type { PullRequestSummary } from '../../../shared/contracts';

export type LocalRefsTab = 'branches' | 'worktrees';
/** The branch (full ref) or worktree (folder) the manager opens on, when it is opened for one. */
export interface LocalRefsFocus { branch?: string; worktree?: string }

/** Windows paths compare case-insensitively and ignore separator spelling. */
export function normalizeWorktreePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
}

export function samePath(left: string, right: string): boolean {
  return normalizeWorktreePath(left) === normalizeWorktreePath(right);
}

/** The agents working in a worktree, by name. */
export function agentsAt(entries: readonly WorktreeAgents[] | undefined, worktreePath: string): string[] {
  return entries?.find((entry) => samePath(entry.path, worktreePath))?.agents ?? [];
}

/** "Claude Code", "Claude Code and Codex", "Aider, Claude Code and Codex". */
export function listAgents(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
export function branchBadges(branch: Pick<BranchInfo, 'current' | 'worktreePath' | 'upstream' | 'ahead' | 'behind'> & { remote?: boolean }): RefBadge[] {
  const badges: RefBadge[] = [];
  if (branch.current) badges.push({ label: 'Current', tone: 'current' });
  else if (branch.worktreePath) badges.push({ label: 'In a worktree', tone: 'warning' });
  if (branch.upstream) {
    if (branch.ahead > 0) badges.push({ label: `↑${branch.ahead}`, tone: 'neutral' });
    if (branch.behind > 0) badges.push({ label: `↓${branch.behind}`, tone: 'neutral' });
  } else if (!branch.remote) {
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

export function worktreeBadges(worktree: Pick<ManagedWorktree, 'main' | 'current' | 'bare' | 'detached' | 'locked' | 'prunable' | 'leftoverFiles' | 'brokenLink'>): RefBadge[] {
  const badges: RefBadge[] = [];
  if (worktree.main) badges.push({ label: 'Main', tone: 'neutral' });
  if (worktree.current) badges.push({ label: 'Open', tone: 'current' });
  if (worktree.bare) badges.push({ label: 'Bare', tone: 'warning' });
  if (worktree.detached) badges.push({ label: 'Detached HEAD', tone: 'warning' });
  if (worktree.locked) badges.push({ label: 'Locked', tone: 'warning' });
  if (worktree.prunable) badges.push({ label: worktree.leftoverFiles ? 'Incomplete' : 'Missing', tone: 'warning' });
  if (worktree.brokenLink) badges.push({ label: 'Broken link', tone: 'warning' });
  return badges;
}

/** Git reports a worktree as missing as soon as its `.git` file goes, long before the removal ends. */
export function removingWorktreeBadges(): RefBadge[] {
  return [{ label: 'Removing', tone: 'neutral' }];
}

export interface DeleteEligibility {
  /** Only `true` renders a destructive control. */
  allowed: boolean;
  /** Dirty linked worktrees may be removed only through explicit force confirmation. */
  forceAllowed?: boolean;
  /** The only way out is dropping Git's entry, which leaves the folder on disk. */
  cleanupOnly?: boolean;
  /** Why the action is offered or refused, in the user's terms. */
  reason: string;
}

/**
 * Branch deletion eligibility, derived only from the backend's structured
 * state. The copy names the comparison base so "merged" is never a mystery.
 */
export function branchDeleteEligibility(details: BranchDetails, pullRequest: PullRequestSummary | null = null): DeleteEligibility {
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
        forceAllowed: true,
        reason: pullRequestReason(pullRequest, details)
          ?? `${details.uniqueCommits} ${details.uniqueCommits === 1 ? 'commit is' : 'commits are'} not in ${details.comparisonBase ?? 'the comparison base'}. Force deletion may make those commits inaccessible.`,
      };
    default:
      return {
        allowed: false,
        forceAllowed: true,
        reason: pullRequestReason(pullRequest, details)
          ?? (details.comparisonBase
            ? `${details.comparisonBase} is not available locally, so Git cannot tell whether this branch is merged. Force deletion is still available.`
            : 'Git cannot tell whether this branch is merged. Force deletion is still available.'),
      };
  }
}

/**
 * Whether GitHub merged exactly this branch tip. Squash and rebase merges leave
 * no local ancestry, so comparing the merged head commit is the only way to
 * tell that nothing on the branch was left out.
 */
export function mergedPullRequestTip(details: Pick<BranchDetails, 'oid'>, pullRequest: PullRequestSummary | null): 'same' | 'different' | 'unknown' | null {
  if (pullRequest?.state !== 'MERGED') return null;
  if (!pullRequest.headRefOid || !details.oid) return 'unknown';
  return pullRequest.headRefOid.toLowerCase() === details.oid.toLowerCase() ? 'same' : 'different';
}

function pullRequestReason(pullRequest: PullRequestSummary | null, details: Pick<BranchDetails, 'oid'>): string | null {
  if (!pullRequest) return null;
  const tip = mergedPullRequestTip(details, pullRequest);
  if (tip === 'same') {
    return `GitHub merged PR #${pullRequest.number} into ${pullRequest.baseRefName} with exactly this tip, so every commit of the branch reached GitHub. Git cannot see that locally (for example after a squash or rebase merge), so deletion requires force.`;
  }
  if (tip === 'different') {
    return `GitHub PR #${pullRequest.number} is merged into ${pullRequest.baseRefName}, but this branch's tip is not the merged head: it may have commits that were never merged. Force deletion may make them inaccessible.`;
  }
  if (pullRequest.state === 'MERGED') {
    return `GitHub PR #${pullRequest.number} is merged into ${pullRequest.baseRefName}, but the local comparison ref is unavailable or has different ancestry. Local deletion requires force.`;
  }
  if (pullRequest.state === 'OPEN') return `GitHub PR #${pullRequest.number} is still open. Force deletion removes only the local branch.`;
  return `GitHub PR #${pullRequest.number} was closed without merging. Force deletion may make branch-only commits inaccessible.`;
}

/** Every reason a worktree cannot be removed, in the order the user should see. */
export function worktreeRemoveEligibility(details: WorktreeDetails): DeleteEligibility {
  if (details.main) return { allowed: false, reason: 'This is the repository\'s main worktree. Git can never remove it.' };
  if (details.current) return { allowed: false, reason: 'OpenTig has this worktree open. Switch to another worktree first.' };
  if (details.bare) return { allowed: false, reason: 'This entry is a bare repository, not a removable worktree.' };
  if (details.locked) return { allowed: false, reason: `Locked${details.locked === 'locked' ? '' : `: ${details.locked}`}. Unlock it in Git before removing it.` };
  // Git refuses even a forced removal while its `.git` file doesn't lead back here.
  if (details.brokenLink) {
    const explanation = brokenLinkExplanation(details);
    return { allowed: false, forceAllowed: true, cleanupOnly: true, reason: [explanation.lead, explanation.path, explanation.cause, ...explanation.notes, explanation.actions].filter(Boolean).join(' ') };
  }
  if (details.prunable) return { allowed: false, forceAllowed: true, cleanupOnly: true, reason: details.leftoverFiles
    ? 'This worktree is incomplete, for example because a removal stopped before it finished. Git can no longer use it, but its folder still has files.'
    : 'Git can no longer find this worktree on disk. Only its entry remains.' };
  if (details.operation) return { allowed: false, forceAllowed: true, reason: `A ${details.operation} is in progress here. Force removal permanently discards it and every local change.` };
  if (details.unreadable) return { allowed: false, forceAllowed: true, reason: `Git can't read this worktree's local changes, so force removal may permanently delete uncommitted work. Git said: ${lastLine(details.unreadable)}` };
  const pending = localChangeSummary(details);
  if (pending) return { allowed: false, forceAllowed: true, reason: `${pending} would be permanently lost by force removal.` };
  if (details.submodules) return { allowed: false, forceAllowed: true, reason: 'It contains submodules, which Git removes only with force. Force removal deletes them and everything inside them.' };
  return { allowed: true, reason: 'No local changes. Removing it deletes the folder from disk and leaves its branch intact.' };
}

/** Why a worktree's link is broken, in parts the panel styles: the path on its own line, notes in bold. */
export interface BrokenLinkExplanation {
  lead: string;
  /** Where its `.git` points, or the Git folder the folder belongs to now. */
  path: string | null;
  cause: string | null;
  /** What cleaning up its entry would or would not lose. */
  notes: string[];
  /** Repair link is offered only where the folder is still this repository's. */
  repairable: boolean;
  /** What the actions do; the panel shows the button names in bold. */
  actions: string;
}

export const REPAIR_ACTIONS = 'Repair link reconnects it to this repository. Clean up entry makes Git forget it and leaves the folder on disk.';
export const TAKEN_ACTIONS = 'Clean up entry removes that entry and leaves the folder and the other repository untouched.';
export const LEFT_OVER_ACTIONS = 'Clean up entry removes that entry and leaves the folder untouched.';

export function brokenLinkExplanation(details: Pick<WorktreeDetails, 'brokenLink' | 'nothingLost' | 'unreachableHead'>): BrokenLinkExplanation {
  const link: BrokenWorktreeLink = details.brokenLink ?? { kind: 'unlinked', pointsTo: null };
  const unreachable = unreachableHeadNote(details);
  if (link.kind === 'taken') {
    const leftOver = { path: link.owner, cause: 'This repository\'s entry for it is left over.', notes: unreachable ? [unreachable] : [], repairable: false };
    if (link.by === 'worktree') return { ...leftOver, lead: 'This folder is now a worktree of another repository:', actions: TAKEN_ACTIONS };
    if (link.by === 'repository') return { ...leftOver, lead: 'This folder now holds a repository of its own:', actions: TAKEN_ACTIONS };
    return { ...leftOver, lead: 'Its .git file points to a folder that is not this repository\'s entry for it:', actions: LEFT_OVER_ACTIONS };
  }
  const notes = [
    ...(link.otherDrive ? ['That folder is on another drive than this repository, which may only be disconnected: connect it before you clean up the entry.'] : []),
    ...(details.nothingLost ? ['The folder has no other files, so no work would be lost.'] : []),
    ...(unreachable ? [unreachable] : []),
  ];
  const base = { notes, repairable: true, actions: REPAIR_ACTIONS };
  if (link.pointsTo === null) {
    return { ...base, lead: 'Its .git file doesn\'t say where its repository is, so Git can\'t use or remove this worktree as it is.', path: null, cause: null };
  }
  return { ...base, lead: 'Its .git file points to a folder that no longer exists:', path: link.pointsTo, cause: 'The repository was probably moved, so Git can\'t use or remove this worktree as it is.' };
}

/** Names a HEAD on no branch or tag, which cleaning up the entry would leave unreachable. */
export function unreachableHeadNote(details: Pick<WorktreeDetails, 'unreachableHead'>): string | null {
  const head = details.unreachableHead;
  return head ? `Its HEAD, ${head.shortOid} ${head.subject}, is on no branch: cleaning up the entry leaves that commit unreachable.` : null;
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).filter((line) => line.trim()).pop()?.trim() ?? text;
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
