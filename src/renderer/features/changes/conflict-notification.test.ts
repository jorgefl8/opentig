import { describe, expect, it } from 'vitest';
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

  it('uses a repository-specific stable toast id', () => {
    expect(conflictToastId('repo-one')).toBe('repository-conflicts:repo-one');
    expect(conflictToastId('repo-one')).not.toBe(conflictToastId('repo-two'));
  });
});
