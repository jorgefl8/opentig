export type RepositoryChangeScope =
  | 'worktree'
  | 'index'
  | 'refs'
  | 'worktrees'
  | 'unknown';

export function mergeRepositoryChangeScopes(
  left: RepositoryChangeScope,
  right: RepositoryChangeScope,
): RepositoryChangeScope {
  if (left === right) return left;
  if (left === 'unknown' || right === 'unknown') return 'unknown';

  // Worktree and index changes require the same visible refresh operations.
  if ((left === 'worktree' && right === 'index') || (left === 'index' && right === 'worktree')) {
    return 'index';
  }

  // The remaining combinations need different consumers (files, history or
  // worktrees). Widen to a full refresh instead of silently losing one.
  return 'unknown';
}
