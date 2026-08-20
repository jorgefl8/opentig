import type { PullResult, PushResult } from '../../../shared/contracts';
import type { SileoOptions } from 'sileo';

export type ProjectSyncAction = 'pull' | 'push';

export interface RepositorySyncCounts {
  ahead: number;
  behind: number;
}

/** Sileo otherwise reuses `sileo-default`, replacing concurrent operations. */
export function repositorySyncLoadingToast(repositoryId: string, action: ProjectSyncAction, title: string): SileoOptions & { id: string } {
  return { id: `repository-sync:${repositoryId}:${action}`, title };
}

/** Only pending operations are visible; an in-flight operation stays visible. */
export function visibleRepositorySyncActions(counts: RepositorySyncCounts | undefined, running?: ProjectSyncAction): ProjectSyncAction[] {
  if (running) return [running];
  if (!counts) return [];
  return [
    ...(counts.behind > 0 ? ['pull' as const] : []),
    ...(counts.ahead > 0 ? ['push' as const] : []),
  ];
}

export interface ProjectSyncToastCopy {
  title: string;
  description?: string;
  duration?: number | null;
}

export function projectPullSuccessCopy(repository: string, result: Extract<PullResult, { status: 'success' | 'up-to-date' }>): ProjectSyncToastCopy {
  if (result.status === 'up-to-date') return { title: `${repository} is already up to date` };
  return {
    title: `${repository}: ${result.commits} ${result.commits === 1 ? 'commit pulled' : 'commits pulled'}`,
    ...(result.restoredLocalChanges ? { description: 'Local and staged changes were restored.' } : {}),
  };
}

export function projectPullBlockedCopy(repository: string, result: Exclude<PullResult, { status: 'success' | 'up-to-date' }>): ProjectSyncToastCopy {
  if (result.status === 'blocked-conflicts') return { title: `Could not pull ${repository}`, description: `${result.files.length} pending ${result.files.length === 1 ? 'conflict' : 'conflicts'} must be resolved.`, duration: 10_000 };
  if (result.status === 'blocked-operation') return { title: `Could not pull ${repository}`, description: `Finish or cancel ${result.operation} first.`, duration: 10_000 };
  if (result.status === 'no-upstream') return { title: `Could not pull ${repository}`, description: 'Current branch has no upstream configured.', duration: 10_000 };
  if (result.status === 'diverged') return { title: `Could not pull ${repository}`, description: `Branch is ${result.ahead} ahead and ${result.behind} behind. Choose rebase or merge first.`, duration: 10_000 };
  if (result.status === 'stash-conflict') return { title: result.updated ? `${repository} updated with local conflicts` : `Could not restore ${repository}`, description: 'Safety stash was preserved. Resolve conflicts before continuing.', duration: null };
  return {
    title: `Could not restore ${repository}`,
    description: result.recoveredChanges ? 'Some local changes were recovered; safety stash was preserved.' : 'Worktree remains clean; safety stash was preserved.',
    duration: null,
  };
}

export function projectPushSuccessCopy(repository: string, result: Extract<PushResult, { status: 'success' | 'up-to-date' }>): ProjectSyncToastCopy {
  return result.status === 'success'
    ? { title: `${repository}: ${result.commits} ${result.commits === 1 ? 'commit pushed' : 'commits pushed'}` }
    : { title: `${repository}: no commits pending push` };
}

export function projectPushBlockedCopy(repository: string, result: Exclude<PushResult, { status: 'success' | 'up-to-date' }>): ProjectSyncToastCopy {
  if (result.status === 'blocked-conflicts') return { title: `Could not push ${repository}`, description: `${result.files.length} pending ${result.files.length === 1 ? 'conflict' : 'conflicts'} must be resolved.`, duration: 10_000 };
  if (result.status === 'blocked-operation') return { title: `Could not push ${repository}`, description: `Finish or cancel ${result.operation} first.`, duration: 10_000 };
  if (result.status === 'no-upstream') return { title: `Could not push ${repository}`, description: 'Current branch has no upstream configured.', duration: 10_000 };
  if (result.status === 'diverged') return { title: `Could not push ${repository}`, description: `Remote has new changes; branch is ${result.ahead} ahead and ${result.behind} behind. Pull first.`, duration: 10_000 };
  return { title: `Could not push ${repository}`, description: result.message, duration: 10_000 };
}
