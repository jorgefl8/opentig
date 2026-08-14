import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyRepositoryChange, RepositoryWatcher, shouldIgnore } from './RepositoryWatcher';

describe('shouldIgnore', () => {
  it('ignores node_modules at the repository root', () => {
    expect(shouldIgnore('node_modules/.vite/deps/x.js', false)).toBe(true);
  });

  it('ignores nested node_modules', () => {
    expect(shouldIgnore('packages/app/node_modules/x/y.js', false)).toBe(true);
  });

  it('ignores transient git lock files', () => {
    expect(shouldIgnore('.git/index.lock', false)).toBe(true);
  });

  it('keeps the git index', () => {
    expect(shouldIgnore('.git/index', false)).toBe(false);
  });

  it('ignores git objects in the worktree git dir', () => {
    expect(shouldIgnore('.git/objects/ab/cdef', false)).toBe(true);
  });

  it('ignores git objects in a linked common dir', () => {
    expect(shouldIgnore('objects/ab/cdef', true)).toBe(true);
  });

  it('keeps source files', () => {
    expect(shouldIgnore('src/renderer/app/App.tsx', false)).toBe(false);
  });

  it('keeps HEAD updates', () => {
    expect(shouldIgnore('.git/HEAD', false)).toBe(false);
  });

  it('keeps unnamed events', () => {
    expect(shouldIgnore('', false)).toBe(false);
  });

  it('ignores reflog and fetch bookkeeping', () => {
    expect(shouldIgnore('.git/logs/HEAD', false)).toBe(true);
    expect(shouldIgnore('.git/FETCH_HEAD', false)).toBe(true);
    expect(shouldIgnore('.git/COMMIT_EDITMSG', false)).toBe(true);
  });

  it('ignores fsmonitor daemon cookies and other git bookkeeping', () => {
    expect(shouldIgnore('.git/fsmonitor--daemon/cookies/abc123', false)).toBe(true);
    expect(shouldIgnore('fsmonitor--daemon/cookies/abc123', true)).toBe(true);
    expect(shouldIgnore('.git/gc.pid', false)).toBe(true);
    expect(shouldIgnore('.git/sharedindex.0f2a', false)).toBe(true);
    expect(shouldIgnore('.git', false)).toBe(true);
  });

  it('keeps ref and branch updates', () => {
    expect(shouldIgnore('.git/refs/heads/main', false)).toBe(false);
    expect(shouldIgnore('.git/packed-refs', false)).toBe(false);
    expect(shouldIgnore('refs/heads/main', true)).toBe(false);
    expect(shouldIgnore('worktrees/feature/HEAD', true)).toBe(false);
    expect(shouldIgnore('.git/MERGE_HEAD', false)).toBe(false);
  });
});

describe('classifyRepositoryChange', () => {
  it('classifies source, index, ref and worktree metadata separately', () => {
    expect(classifyRepositoryChange('src/renderer/app/App.tsx', false)).toBe('worktree');
    expect(classifyRepositoryChange('.git/index', false)).toBe('index');
    expect(classifyRepositoryChange('.git/HEAD', false)).toBe('refs');
    expect(classifyRepositoryChange('refs/heads/main', true)).toBe('refs');
    expect(classifyRepositoryChange('worktrees/feature/HEAD', true)).toBe('worktrees');
  });

  it('widens unnamed and configuration changes to unknown', () => {
    expect(classifyRepositoryChange('', false)).toBe('unknown');
    expect(classifyRepositoryChange('.git/config', false)).toBe('unknown');
  });

  it('drops bookkeeping events', () => {
    expect(classifyRepositoryChange('.git/objects/ab/cdef', false)).toBeNull();
    expect(classifyRepositoryChange('node_modules/example/index.js', false)).toBeNull();
    expect(classifyRepositoryChange('.git/index.lock', false)).toBeNull();
  });
});

describe('RepositoryWatcher batching', () => {
  afterEach(() => vi.useRealTimers());

  it('merges scopes during debounce and preserves the broader notification', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const watcher = new RepositoryWatcher(onChange);
    const internals = watcher as unknown as {
      active: { id: string } | null;
      schedule(scope: 'worktree' | 'refs'): void;
    };
    internals.active = { id: 'repository-1' };

    internals.schedule('worktree');
    internals.schedule('refs');
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('repository-1', 'unknown');
  });

  it('defers a batch while Git is active without losing its scope', () => {
    vi.useFakeTimers();
    let activeChecks = 0;
    const onChange = vi.fn();
    const watcher = new RepositoryWatcher(onChange, () => activeChecks++ === 0);
    const internals = watcher as unknown as {
      active: { id: string } | null;
      schedule(scope: 'index'): void;
    };
    internals.active = { id: 'repository-1' };

    internals.schedule('index');
    vi.advanceTimersByTime(250);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledWith('repository-1', 'index');
  });
});
