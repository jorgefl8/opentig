import type { RepositoryChangeScope } from '../../shared/repository-change';
import { mergeRepositoryChangeScopes } from '../../shared/repository-change';

export type RefreshView = 'changes' | 'files' | 'history' | 'prs' | 'search';

export interface RefreshOperations {
  status: true;
  branches: boolean;
  worktrees: boolean;
  files: boolean;
  history: boolean;
}

export interface RefreshRequest {
  scope: RepositoryChangeScope;
  background: boolean;
  view: RefreshView;
}

export function mergeRefreshRequests(left: RefreshRequest, right: RefreshRequest): RefreshRequest {
  return {
    scope: mergeRepositoryChangeScopes(left.scope, right.scope),
    background: left.background && right.background,
    view: right.view,
  };
}

export function shouldRefreshViewer(
  scope: RepositoryChangeScope,
  selectionType: 'diff' | 'conflict' | 'file' | 'commit' | 'commit-file' | 'pull-request' | null,
): boolean {
  if (selectionType !== 'diff' && selectionType !== 'conflict') return false;
  return scope === 'worktree' || scope === 'index' || scope === 'unknown';
}

export function shouldRefreshSearch(scope: RepositoryChangeScope): boolean {
  return scope === 'worktree' || scope === 'index' || scope === 'unknown';
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
