import { describe, expect, it } from 'vitest';
import { mobileMainAction } from './mobile-main-action';

describe('the one floating action on a phone', () => {
  it('commits from Changes when something is staged or a plan is waiting', () => {
    expect(mobileMainAction({ screen: 'changes', stagedCount: 2, hasCommitPlan: false })).toBe('commit');
    expect(mobileMainAction({ screen: 'changes', stagedCount: 0, hasCommitPlan: true })).toBe('commit');
    expect(mobileMainAction({ screen: 'changes', stagedCount: 0, hasCommitPlan: false })).toBeNull();
  });

  it('saves a file while it has unsaved edits or is being saved', () => {
    expect(mobileMainAction({ screen: 'file', dirty: true, saving: false })).toBe('save');
    expect(mobileMainAction({ screen: 'file', dirty: false, saving: true })).toBe('save');
    expect(mobileMainAction({ screen: 'file', dirty: false, saving: false })).toBeNull();
  });

  it('follows the pull request tab, and floats nothing over code', () => {
    expect(mobileMainAction({ screen: 'pull-request', tab: 'summary', primary: 'action' })).toBe('pull-request-primary');
    expect(mobileMainAction({ screen: 'pull-request', tab: 'summary', primary: 'github' })).toBe('pull-request-primary');
    expect(mobileMainAction({ screen: 'pull-request', tab: 'timeline', primary: 'action' })).toBe('comment');
    expect(mobileMainAction({ screen: 'pull-request', tab: 'diff', primary: 'action' })).toBeNull();
  });

  it('has nothing to press when the pull request only has a reason to give', () => {
    for (const primary of ['none', 'text', 'retry'] as const) {
      expect(mobileMainAction({ screen: 'pull-request', tab: 'summary', primary })).toBeNull();
      expect(mobileMainAction({ screen: 'pull-request', tab: 'timeline', primary })).toBe('comment');
    }
  });

  it('publishes only a draft release the account can change', () => {
    expect(mobileMainAction({ screen: 'release', isDraft: true, canWrite: true })).toBe('publish-release');
    expect(mobileMainAction({ screen: 'release', isDraft: false, canWrite: true })).toBeNull();
    expect(mobileMainAction({ screen: 'release', isDraft: true, canWrite: false })).toBeNull();
  });
});
