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

  it('shares the repository pull toast id so the conflict lifecycle replaces and dismisses it', () => {
    expect(conflictToastId('repo-one')).toBe('repository-sync:repo-one:pull');
    expect(conflictToastId('repo-one')).toBe(repositorySyncLoadingToast('repo-one', 'pull', 'Pulling…').id);
    expect(conflictToastId('repo-one')).not.toBe(conflictToastId('repo-two'));
  });
});
