import { describe, expect, it } from 'vitest';
import type { BranchDetails, BranchInfo, ManagedWorktree, WorktreeDetails } from '../../../shared/git-types';
import {
  branchBadges, branchDeleteEligibility, branchDetailBadges, branchKey, filterBranches, filterWorktrees,
  localChangeSummary, nextSelectionKey, normalizeWorktreePath, samePath, worktreeBadges, worktreeKey,
  worktreeName, worktreeRemoveEligibility,
} from './local-refs-model';

function branch(partial: Partial<BranchInfo> & { name: string }): BranchInfo {
  return {
    fullName: `refs/heads/${partial.name}`, current: false, remote: false, upstream: null, ahead: 0, behind: 0,
    worktreePath: null, oid: 'a'.repeat(40), shortOid: 'aaaaaaa', subject: '', author: '', date: '', ...partial,
  };
}

function worktree(partial: Partial<ManagedWorktree> & { path: string }): ManagedWorktree {
  return {
    oid: 'b'.repeat(40), branch: null, bare: false, detached: false, locked: null, prunable: null,
    main: false, current: false, ...partial,
  };
}

function branchDetails(partial: Partial<BranchDetails>): BranchDetails {
  return {
    fullName: 'refs/heads/feature', name: 'feature', oid: 'a'.repeat(40), shortOid: 'aaaaaaa', subject: '', author: '', date: '',
    upstream: null, ahead: 0, behind: 0, worktreePath: null, deletion: 'safe', comparisonKind: 'head',
    comparisonBase: 'HEAD', uniqueCommits: 0, ...partial,
  };
}

function worktreeDetails(partial: Partial<WorktreeDetails>): WorktreeDetails {
  return {
    path: 'C:\\repos\\app-trees\\review', oid: 'b'.repeat(40), branch: 'review', main: false, current: false,
    detached: false, bare: false, locked: null, prunable: null, available: true,
    stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 0, operation: null, readOnly: false,
    lastCommit: null, ...partial,
  };
}

describe('path helpers', () => {
  it('compares Windows paths case-insensitively across separators and trailing slashes', () => {
    expect(samePath('C:\\Repos\\App', 'c:/repos/app/')).toBe(true);
    expect(samePath('C:\\Repos\\App', 'C:\\Repos\\App2')).toBe(false);
    expect(normalizeWorktreePath('C:\\Mis Repos\\Aplicación\\')).toBe('c:/mis repos/aplicación');
  });

  it('reads the folder name from either separator', () => {
    expect(worktreeName('C:\\repos\\app trees\\revisión')).toBe('revisión');
    expect(worktreeName('/home/user/repos/review/')).toBe('review');
    expect(worktreeName('review')).toBe('review');
  });
});

describe('filterBranches', () => {
  const branches = [
    branch({ name: 'main', current: true, subject: 'Base commit' }),
    branch({ name: 'función/ñandú', subject: 'Añade soporte', shortOid: 'fedcba9' }),
    branch({ name: 'release', upstream: 'origin/release' }),
  ];

  it('preserves the backend order, which keeps the current branch first', () => {
    expect(filterBranches(branches, '   ').map((item) => item.name)).toEqual(['main', 'función/ñandú', 'release']);
  });

  it('matches name, ref, upstream, tip, and subject case-insensitively', () => {
    expect(filterBranches(branches, 'ÑAN').map((item) => item.name)).toEqual(['función/ñandú']);
    expect(filterBranches(branches, 'origin/rel').map((item) => item.name)).toEqual(['release']);
    expect(filterBranches(branches, 'FEDCBA9').map((item) => item.name)).toEqual(['función/ñandú']);
    expect(filterBranches(branches, 'refs/heads/main').map((item) => item.name)).toEqual(['main']);
    expect(filterBranches(branches, 'nothing here')).toEqual([]);
  });
});

describe('filterWorktrees', () => {
  const worktrees = [
    worktree({ path: 'C:\\repos\\app-trees\\zulu', branch: 'zulu' }),
    worktree({ path: 'C:\\repos\\app', branch: 'main', main: true }),
    worktree({ path: 'C:\\repos\\app-trees\\alpha', branch: 'alpha', current: true }),
    worktree({ path: 'C:\\repos\\app-trees\\Bravo', branch: 'bravo' }),
  ];

  it('orders main first, then the open worktree, then folder names', () => {
    expect(filterWorktrees(worktrees, '').map((item) => worktreeName(item.path))).toEqual(['app', 'alpha', 'Bravo', 'zulu']);
  });

  it('matches path, folder name, and branch', () => {
    expect(filterWorktrees(worktrees, 'bravo').map((item) => item.branch)).toEqual(['bravo']);
    expect(filterWorktrees(worktrees, 'app-trees')).toHaveLength(3);
    expect(filterWorktrees(worktrees, 'missing')).toEqual([]);
  });
});

describe('badges', () => {
  it('labels branch state without claiming more than the data supports', () => {
    expect(branchBadges(branch({ name: 'main', current: true, upstream: 'origin/main' }))).toEqual([{ label: 'Current', tone: 'current' }]);
    expect(branchBadges(branch({ name: 'idle' }))).toEqual([{ label: 'No upstream', tone: 'neutral' }]);
    expect(branchBadges(branch({ name: 'busy', worktreePath: 'C:\\repos\\app-trees\\busy', upstream: 'origin/busy', ahead: 2, behind: 3 })))
      .toEqual([{ label: 'In a worktree', tone: 'warning' }, { label: '↑2', tone: 'neutral' }, { label: '↓3', tone: 'neutral' }]);
  });

  it('derives detail badges from the deletion state rather than a current flag', () => {
    expect(branchDetailBadges(branchDetails({ deletion: 'current', upstream: 'origin/main', ahead: 1 })))
      .toEqual([{ label: 'Current', tone: 'current' }, { label: '↑1', tone: 'neutral' }]);
    expect(branchDetailBadges(branchDetails({ deletion: 'checked-out', worktreePath: 'C:\\repos\\app-trees\\review' })))
      .toEqual([{ label: 'In a worktree', tone: 'warning' }, { label: 'No upstream', tone: 'neutral' }]);
    // A safe branch reports its own worktreePath as null, so no state badge shows.
    expect(branchDetailBadges(branchDetails({ deletion: 'safe' }))).toEqual([{ label: 'No upstream', tone: 'neutral' }]);
  });

  it('labels every worktree state', () => {
    expect(worktreeBadges(worktree({ path: 'C:\\repos\\app', main: true, current: true }))).toEqual([
      { label: 'Main', tone: 'neutral' }, { label: 'Open', tone: 'current' },
    ]);
    expect(worktreeBadges(worktree({ path: 'C:\\repos\\d', detached: true, locked: 'on a usb drive', prunable: 'gone' }))).toEqual([
      { label: 'Detached HEAD', tone: 'warning' }, { label: 'Locked', tone: 'warning' }, { label: 'Missing', tone: 'warning' },
    ]);
    expect(worktreeBadges(worktree({ path: 'C:\\repos\\app.git', main: true, bare: true }))).toContainEqual({ label: 'Bare', tone: 'warning' });
  });
});

describe('branchDeleteEligibility', () => {
  it('allows deletion only for a safe branch and names the comparison base', () => {
    const eligibility = branchDeleteEligibility(branchDetails({ deletion: 'safe', comparisonBase: 'origin/feature' }));
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.reason).toContain('origin/feature');
  });

  it('explains every blocked reason without offering the action', () => {
    const current = branchDeleteEligibility(branchDetails({ deletion: 'current', comparisonBase: null }));
    expect(current).toMatchObject({ allowed: false });
    expect(current.reason).toContain('checked out');

    const occupied = branchDeleteEligibility(branchDetails({ deletion: 'checked-out', comparisonBase: null, worktreePath: 'C:\\repos\\app-trees\\review' }));
    expect(occupied.allowed).toBe(false);
    expect(occupied.reason).toContain('C:\\repos\\app-trees\\review');

    const unmerged = branchDeleteEligibility(branchDetails({ deletion: 'unmerged', comparisonBase: 'origin/main', uniqueCommits: 1 }));
    expect(unmerged.allowed).toBe(false);
    expect(unmerged.reason).toContain('1 commit is not in origin/main');

    const many = branchDeleteEligibility(branchDetails({ deletion: 'unmerged', comparisonBase: 'HEAD', uniqueCommits: 4 }));
    expect(many.reason).toContain('4 commits are not in HEAD');

    const unknown = branchDeleteEligibility(branchDetails({ deletion: 'unknown', comparisonKind: 'upstream', comparisonBase: 'origin/gone' }));
    expect(unknown.allowed).toBe(false);
    expect(unknown.reason).toContain('origin/gone is not available locally');
  });
});

describe('worktreeRemoveEligibility', () => {
  it('allows removal only for a clean, unlocked, non-main, non-current worktree', () => {
    const eligibility = worktreeRemoveEligibility(worktreeDetails({}));
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.reason).toContain('leaves its branch intact');
  });

  it('reports the highest-priority blocker for every refused state', () => {
    const cases: [Partial<WorktreeDetails>, string][] = [
      [{ main: true }, 'main worktree'],
      [{ current: true }, 'open'],
      [{ bare: true }, 'bare repository'],
      [{ locked: 'on a usb drive' }, 'Locked: on a usb drive'],
      [{ locked: 'locked' }, 'Locked.'],
      [{ prunable: 'gitdir missing', available: false }, 'no longer find this worktree'],
      [{ operation: 'rebase', readOnly: true }, 'A rebase is in progress'],
      [{ stagedCount: 2 }, '2 staged changes'],
      [{ untrackedCount: 1 }, '1 untracked change'],
      [{ conflictCount: 1, unstagedCount: 2 }, '1 conflicted, 2 unstaged changes'],
    ];
    for (const [partial, expected] of cases) {
      const eligibility = worktreeRemoveEligibility(worktreeDetails(partial));
      expect(eligibility.allowed).toBe(false);
      expect(eligibility.reason).toContain(expected);
    }
  });

  it('ranks main above every other blocker so the copy never misleads', () => {
    expect(worktreeRemoveEligibility(worktreeDetails({ main: true, current: true, stagedCount: 3 })).reason).toContain('main worktree');
  });
});

describe('localChangeSummary', () => {
  it('returns null when the worktree is clean and counts everything otherwise', () => {
    expect(localChangeSummary(worktreeDetails({}))).toBeNull();
    expect(localChangeSummary(worktreeDetails({ stagedCount: 1 }))).toBe('1 staged change');
    expect(localChangeSummary(worktreeDetails({ stagedCount: 1, unstagedCount: 2, untrackedCount: 3, conflictCount: 4 })))
      .toBe('4 conflicted, 1 staged, 2 unstaged, 3 untracked changes');
  });
});

describe('nextSelectionKey', () => {
  const previous = ['refs/heads/main', 'refs/heads/alpha', 'refs/heads/beta'];

  it('keeps a selection that survived the refresh', () => {
    expect(nextSelectionKey(previous, previous, 'refs/heads/alpha')).toBe('refs/heads/alpha');
  });

  it('falls back to the row that took the deleted item\'s place', () => {
    expect(nextSelectionKey(['refs/heads/main', 'refs/heads/beta'], previous, 'refs/heads/alpha')).toBe('refs/heads/beta');
  });

  it('clamps to the last row when the deleted item was last', () => {
    expect(nextSelectionKey(['refs/heads/main', 'refs/heads/alpha'], previous, 'refs/heads/beta')).toBe('refs/heads/alpha');
  });

  it('handles an empty list, an absent selection, and no previous selection', () => {
    expect(nextSelectionKey([], previous, 'refs/heads/alpha')).toBeNull();
    expect(nextSelectionKey(previous, [], 'refs/heads/gone')).toBe('refs/heads/main');
    expect(nextSelectionKey(previous, previous, null)).toBe('refs/heads/main');
  });

  it('keys worktrees by normalized path so casing changes do not lose the selection', () => {
    expect(worktreeKey(worktree({ path: 'C:\\Repos\\App-Trees\\Review' }))).toBe('c:/repos/app-trees/review');
    expect(branchKey(branch({ name: 'main' }))).toBe('refs/heads/main');
    expect(nextSelectionKey(['c:/repos/app-trees/review'], ['c:/repos/app-trees/review'], worktreeKey(worktree({ path: 'C:/repos/app-trees/review/' }))))
      .toBe('c:/repos/app-trees/review');
  });
});
