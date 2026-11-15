import { describe, expect, it } from 'vitest';
import {
  mergeRefreshRequests, refreshOperationsForScope, SECTION_FULL_REFRESH_MIN_INTERVAL_MS, SECTION_REFRESH_MIN_INTERVAL_MS, sectionRefresh, shouldRefreshSearch, shouldRefreshViewer,
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
  it('preserves a manual remote check when watcher refreshes are coalesced', () => {
    expect(mergeRefreshRequests(
      { manual: true, scope: 'unknown', background: false, view: 'changes' },
      { scope: 'refs', background: true, view: 'history' },
    )).toEqual({ manual: true, scope: 'unknown', background: false, view: 'history' });
  });
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

describe('sectionRefresh', () => {
  const recent = SECTION_REFRESH_MIN_INTERVAL_MS - 1;
  const old = SECTION_REFRESH_MIN_INTERVAL_MS;

  it('asks for nothing when the section was read moments ago', () => {
    expect(sectionRefresh('changes', { snapshotMs: recent, filesMs: Number.POSITIVE_INFINITY, refsMs: recent })).toBe('none');
    expect(sectionRefresh('files', { snapshotMs: recent, filesMs: recent, refsMs: recent })).toBe('none');
  });

  it('reads the file tree alone when only it is missing or old, since no other section reads it', () => {
    expect(sectionRefresh('files', { snapshotMs: recent, filesMs: Number.POSITIVE_INFINITY, refsMs: recent })).toBe('files');
    expect(sectionRefresh('files', { snapshotMs: recent, filesMs: old, refsMs: recent })).toBe('files');
  });

  it('reads everything once branches and worktrees are a minute old, so a stopped file watcher cannot leave them stale for good', () => {
    expect(sectionRefresh('changes', { snapshotMs: recent, filesMs: recent, refsMs: SECTION_FULL_REFRESH_MIN_INTERVAL_MS })).toBe('full');
    expect(sectionRefresh('changes', { snapshotMs: old, filesMs: recent, refsMs: SECTION_FULL_REFRESH_MIN_INTERVAL_MS - 1 })).toBe('snapshot');
  });

  it('reads the snapshot again once it is no longer recent, including before the first one arrives', () => {
    expect(sectionRefresh('history', { snapshotMs: old, filesMs: recent, refsMs: recent })).toBe('snapshot');
    expect(sectionRefresh('files', { snapshotMs: Number.POSITIVE_INFINITY, filesMs: Number.POSITIVE_INFINITY, refsMs: recent })).toBe('snapshot');
  });
});
