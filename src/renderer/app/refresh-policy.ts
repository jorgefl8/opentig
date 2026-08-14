import type { RepositoryChangeScope } from '../../shared/repository-change';

export type RefreshView = 'changes' | 'files' | 'history' | 'prs';

export interface RefreshOperations {
  status: true;
  branches: boolean;
  worktrees: boolean;
  files: boolean;
  history: boolean;
}

export function refreshOperationsForScope(
  scope: RepositoryChangeScope,
  view: RefreshView,
): RefreshOperations {
  const full = scope === 'unknown';
  return {
    status: true,
    branches: full || scope === 'refs' || scope === 'worktrees',
    worktrees: full || scope === 'worktrees',
    files: view === 'files' && (full || scope === 'worktree' || scope === 'index'),
    history: view === 'history' && (full || scope === 'refs'),
  };
}
