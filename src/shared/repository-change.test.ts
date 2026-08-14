import { describe, expect, it } from 'vitest';
import { mergeRepositoryChangeScopes } from './repository-change';

describe('mergeRepositoryChangeScopes', () => {
  it('keeps identical scopes and merges worktree plus index without widening', () => {
    expect(mergeRepositoryChangeScopes('refs', 'refs')).toBe('refs');
    expect(mergeRepositoryChangeScopes('worktree', 'index')).toBe('index');
    expect(mergeRepositoryChangeScopes('index', 'worktree')).toBe('index');
  });

  it('widens incomparable scopes so no consumer is skipped', () => {
    expect(mergeRepositoryChangeScopes('worktree', 'refs')).toBe('unknown');
    expect(mergeRepositoryChangeScopes('refs', 'worktrees')).toBe('unknown');
    expect(mergeRepositoryChangeScopes('unknown', 'index')).toBe('unknown');
  });
});
