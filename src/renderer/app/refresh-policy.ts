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
  manual?: boolean;
  scope: RepositoryChangeScope;
  background: boolean;
  view: RefreshView;
}

export function mergeRefreshRequests(left: RefreshRequest, right: RefreshRequest): RefreshRequest {
  return {
    ...(left.manual || right.manual ? { manual: true } : {}),
    scope: mergeRepositoryChangeScopes(left.scope, right.scope),
    background: left.background && right.background,
    view: right.view,
  };
}

export function shouldRefreshViewer(
  scope: RepositoryChangeScope,
  selectionType: 'diff' | 'conflict' | 'file' | 'commit' | 'commit-file' | 'pull-request' | 'release' | 'workflow-run' | null,
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

/** Switching between sections quickly asks for nothing; one that was last read longer ago than this is read again behind what it shows. */
export const SECTION_REFRESH_MIN_INTERVAL_MS = 5_000;

/** Branches, worktrees and the remote are read again on entering a section once they are this old. */
export const SECTION_FULL_REFRESH_MIN_INTERVAL_MS = 60_000;

/**
 * What entering a section reads, behind what is already on screen. The file
 * watcher keeps the status current, so this only covers what it may have missed
 * and the file tree, which is not read while another section is open. The
 * watcher can stop, as it does when the system runs out of watches on a very
 * large repository, and then this is the only thing that notices a branch or a
 * worktree made elsewhere: once a minute it reads everything.
 */
export function sectionRefresh(view: RefreshView, age: { snapshotMs: number; filesMs: number; refsMs: number }): 'none' | 'files' | 'snapshot' | 'full' {
  if (age.refsMs >= SECTION_FULL_REFRESH_MIN_INTERVAL_MS) return 'full';
  if (age.snapshotMs >= SECTION_REFRESH_MIN_INTERVAL_MS) return 'snapshot';
  return view === 'files' && age.filesMs >= SECTION_REFRESH_MIN_INTERVAL_MS ? 'files' : 'none';
}
