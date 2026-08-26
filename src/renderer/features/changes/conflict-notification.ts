export type ConflictNotificationAction = 'show' | 'dismiss' | 'none';

/**
 * Conflict notifications describe transitions, not snapshots. A refresh that
 * returns the same conflicts must stay silent, and resolving one of several
 * conflicts must not recreate an error toast.
 */
export function conflictNotificationAction(
  previous: readonly string[] | undefined,
  current: readonly string[],
): ConflictNotificationAction {
  if (current.length === 0) return previous && previous.length > 0 ? 'dismiss' : 'none';
  if (!previous) return 'show';
  const known = new Set(previous);
  return current.some((path) => !known.has(path)) ? 'show' : 'none';
}

export function conflictToastId(repositoryId: string): string {
  return `repository-sync:${repositoryId}:pull`;
}
