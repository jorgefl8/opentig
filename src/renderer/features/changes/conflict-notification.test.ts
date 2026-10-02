import { describe, expect, it } from 'vitest';
import { repositorySyncLoadingToast } from '../repositories/project-sync';
import { conflictNotificationAction, conflictToastId } from './conflict-notification';

describe('conflict notifications', () => {
  it('shows only when conflicts first appear or a new path is introduced', () => {
    expect(conflictNotificationAction(undefined, ['a.ts'])).toBe('show');
    expect(conflictNotificationAction([], ['a.ts'])).toBe('show');
    expect(conflictNotificationAction(['a.ts'], ['a.ts'])).toBe('none');
    expect(conflictNotificationAction(['a.ts'], ['a.ts', 'b.ts'])).toBe('show');
  });

  it('does not recreate an error while conflicts are being resolved', () => {
    expect(conflictNotificationAction(['a.ts', 'b.ts'], ['b.ts'])).toBe('none');
    expect(conflictNotificationAction(['b.ts'], [])).toBe('dismiss');
    expect(conflictNotificationAction([], [])).toBe('none');
  });

  it('keeps a stable conflict identity separate from every pull operation', () => {
    const conflictId = conflictToastId('repo-one');
    expect(conflictId).toBe(conflictToastId('repo-one'));
    expect(conflictId).not.toBe(conflictToastId('repo-two'));
    const firstPull = repositorySyncLoadingToast('repo-one', 'pull', 'Pulling…');
    const nextPull = repositorySyncLoadingToast('repo-one', 'pull', 'Pulling again…');
    expect(new Set([conflictId, firstPull.id, nextPull.id]).size).toBe(3);
  });
});
