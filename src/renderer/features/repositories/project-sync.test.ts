import { describe, expect, it } from 'vitest';
import { projectPullBlockedCopy, projectPullSuccessCopy, projectPushBlockedCopy, projectPushSuccessCopy, repositorySyncLoadingToast, visibleRepositorySyncActions } from './project-sync';

describe('project sync toast copy', () => {
  it('shows only pending repository operations', () => {
    expect(visibleRepositorySyncActions({ ahead: 3, behind: 0 })).toEqual(['push']);
    expect(visibleRepositorySyncActions({ ahead: 0, behind: 2 })).toEqual(['pull']);
    expect(visibleRepositorySyncActions({ ahead: 3, behind: 2 })).toEqual(['pull', 'push']);
    expect(visibleRepositorySyncActions({ ahead: 0, behind: 0 })).toEqual([]);
    expect(visibleRepositorySyncActions(undefined)).toEqual([]);
  });

  it('keeps an in-flight operation visible while counts refresh', () => {
    expect(visibleRepositorySyncActions({ ahead: 0, behind: 0 }, 'push')).toEqual(['push']);
  });

  it('gives concurrent repository operations distinct Sileo identities', () => {
    expect(repositorySyncLoadingToast('repo-one', 'push', 'Pushing one…')).toEqual({
      id: 'repository-sync:repo-one:push',
      title: 'Pushing one…',
    });
    expect(repositorySyncLoadingToast('repo-two', 'push', 'Pushing two…').id).not.toBe('repository-sync:repo-one:push');
  });

  it('identifies each repository in successful pull and push results', () => {
    expect(projectPullSuccessCopy('Web · frontend', { status: 'success', commits: 2, restoredLocalChanges: true })).toEqual({
      title: 'Web · frontend: 2 commits pulled',
      description: 'Local and staged changes were restored.',
    });
    expect(projectPushSuccessCopy('API · backend', { status: 'up-to-date' })).toEqual({ title: 'API · backend: no commits pending push' });
  });

  it('keeps blocked operations attributable and actionable', () => {
    expect(projectPullBlockedCopy('Web · frontend', { status: 'diverged', ahead: 2, behind: 3 })).toEqual({
      title: 'Could not pull Web · frontend',
      description: 'Branch is 2 ahead and 3 behind. Choose rebase or merge first.',
      duration: 10_000,
    });
    expect(projectPushBlockedCopy('API · backend', { status: 'no-upstream' })).toEqual({
      title: 'Could not push API · backend',
      description: 'Current branch has no upstream configured.',
      duration: 10_000,
    });
  });
});
