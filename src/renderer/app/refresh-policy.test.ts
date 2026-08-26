import { describe, expect, it } from 'vitest';
import {
  mergeRefreshRequests, refreshOperationsForScope, shouldRefreshSearch, shouldRefreshViewer,
} from './refresh-policy';

describe('refreshOperationsForScope', () => {
  it('refreshes only status for a worktree event outside Files', () => {
    expect(refreshOperationsForScope('worktree', 'changes')).toEqual({
      status: true, branches: false, worktrees: false, files: false, history: false,
    });
  });

  it('refreshes Files for worktree and index changes when visible', () => {
    expect(refreshOperationsForScope('worktree', 'files').files).toBe(true);
    expect(refreshOperationsForScope('index', 'files').files).toBe(true);
  });

  it('refreshes branches and visible history for ref changes', () => {
    expect(refreshOperationsForScope('refs', 'history')).toEqual({
      status: true, branches: true, worktrees: false, files: false, history: true,
    });
  });

  it('refreshes branches and worktrees for linked-worktree metadata', () => {
    expect(refreshOperationsForScope('worktrees', 'history')).toEqual({
      status: true, branches: true, worktrees: true, files: false, history: false,
    });
  });

  it('uses the complete visible-view matrix for an unknown change', () => {
    expect(refreshOperationsForScope('unknown', 'files')).toEqual({
      status: true, branches: true, worktrees: true, files: true, history: false,
    });
    expect(refreshOperationsForScope('unknown', 'history').history).toBe(true);
  });
});

describe('refresh scheduling', () => {
  it('coalesces scopes without hiding a foreground refresh', () => {
    expect(mergeRefreshRequests(
      { scope: 'worktree', background: true, view: 'changes' },
      { scope: 'refs', background: false, view: 'history' },
    )).toEqual({ scope: 'unknown', background: false, view: 'history' });
  });

  it('reloads mutable viewers only for worktree-bearing scopes', () => {
    expect(shouldRefreshViewer('worktree', 'diff')).toBe(true);
    expect(shouldRefreshViewer('index', 'conflict')).toBe(true);
    expect(shouldRefreshViewer('refs', 'diff')).toBe(false);
    expect(shouldRefreshViewer('unknown', 'file')).toBe(false);
    expect(shouldRefreshViewer('unknown', 'commit')).toBe(false);
  });

  it('keeps search stable for ref-only refreshes', () => {
    expect(shouldRefreshSearch('worktree')).toBe(true);
    expect(shouldRefreshSearch('index')).toBe(true);
    expect(shouldRefreshSearch('refs')).toBe(false);
  });
});
