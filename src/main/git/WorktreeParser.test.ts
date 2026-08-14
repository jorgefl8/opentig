import { describe, expect, it } from 'vitest';
import { parseWorktrees } from './WorktreeParser';

/** `git worktree list --porcelain -z` emits NUL-terminated attribute lines. */
function porcelain(...records: string[][]): Buffer {
  return Buffer.from(records.flat().map((line) => `${line}\0`).join(''), 'utf8');
}

describe('parseWorktrees', () => {
  it('marks only the first record as the main worktree', () => {
    const worktrees = parseWorktrees(porcelain(
      ['worktree C:/repos/app', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/main'],
      ['worktree C:/repos/app-trees/review', 'HEAD ' + 'b'.repeat(40), 'branch refs/heads/review'],
      ['worktree C:/repos/app-trees/spike', 'HEAD ' + 'c'.repeat(40), 'branch refs/heads/spike'],
    ));
    expect(worktrees.map((worktree) => [worktree.path, worktree.branch, worktree.main])).toEqual([
      ['C:/repos/app', 'main', true],
      ['C:/repos/app-trees/review', 'review', false],
      ['C:/repos/app-trees/spike', 'spike', false],
    ]);
  });

  it('parses a detached worktree without a branch', () => {
    const [worktree] = parseWorktrees(porcelain(['worktree C:/repos/app', 'HEAD ' + 'd'.repeat(40), 'detached']));
    expect(worktree).toMatchObject({ branch: null, detached: true, bare: false, main: true, oid: 'd'.repeat(40) });
  });

  it('parses a bare main repository', () => {
    const [worktree] = parseWorktrees(porcelain(['worktree C:/repos/app.git', 'bare']));
    expect(worktree).toMatchObject({ path: 'C:/repos/app.git', bare: true, main: true, oid: '', branch: null });
  });

  it('keeps a lock reason and falls back to a generic label without one', () => {
    const worktrees = parseWorktrees(porcelain(
      ['worktree C:/repos/app', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/main'],
      ['worktree D:/usb/detachable', 'HEAD ' + 'b'.repeat(40), 'branch refs/heads/usb', 'locked on a removable drive'],
      ['worktree C:/repos/app-trees/quiet', 'HEAD ' + 'c'.repeat(40), 'branch refs/heads/quiet', 'locked'],
    ));
    expect(worktrees.map((worktree) => worktree.locked)).toEqual([null, 'on a removable drive', 'locked']);
  });

  it('keeps a prunable reason and falls back to a generic label without one', () => {
    const worktrees = parseWorktrees(porcelain(
      ['worktree C:/repos/app', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/main'],
      ['worktree C:/repos/app-trees/gone', 'HEAD ' + 'b'.repeat(40), 'branch refs/heads/gone', 'prunable gitdir file points to non-existent location'],
      ['worktree C:/repos/app-trees/vanished', 'HEAD ' + 'c'.repeat(40), 'prunable'],
    ));
    expect(worktrees.map((worktree) => worktree.prunable)).toEqual([
      null, 'gitdir file points to non-existent location', 'prunable',
    ]);
  });

  it('preserves paths containing spaces and Unicode', () => {
    const worktrees = parseWorktrees(porcelain(
      ['worktree C:/Mis Repos/aplicación', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/principal'],
      ['worktree C:/Mis Repos/aplicación – revisión', 'HEAD ' + 'b'.repeat(40), 'branch refs/heads/revisión'],
    ));
    expect(worktrees.map((worktree) => worktree.path)).toEqual([
      'C:/Mis Repos/aplicación', 'C:/Mis Repos/aplicación – revisión',
    ]);
    expect(worktrees[1]?.branch).toBe('revisión');
  });

  it('strips only the refs/heads/ prefix from branch names', () => {
    const [worktree] = parseWorktrees(porcelain(['worktree C:/repos/app', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/feature/refs/heads/nested']));
    expect(worktree?.branch).toBe('feature/refs/heads/nested');
  });

  it('returns an empty list for empty output', () => {
    expect(parseWorktrees(Buffer.from('', 'utf8'))).toEqual([]);
  });
});
