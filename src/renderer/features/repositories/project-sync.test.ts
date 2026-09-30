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

  it('offers publication without an ahead count only for an existing local branch', () => {
    const status = { branch: 'feature', upstream: null, ahead: 0, behind: 0 };
    expect(visibleRepositorySyncActions(status)).toEqual(['push']);
    expect(visibleRepositorySyncActions({ ...status, unborn: true })).toEqual([]);
    expect(visibleRepositorySyncActions({ ...status, detached: true, branch: null })).toEqual([]);
    expect(visibleRepositorySyncActions({ ...status, upstream: 'origin/feature' })).toEqual([]);
    expect(projectPushSuccessCopy('repo', { status: 'published', remote: 'origin', branch: 'feature' }))
      .toEqual({ title: 'repo: branch published', description: 'origin/feature' });
  });

  it('keeps an in-flight operation visible while counts refresh', () => {
    expect(visibleRepositorySyncActions({ ahead: 0, behind: 0 }, 'push')).toEqual(['push']);
  });

  it('gives concurrent repository operations distinct Sileo identities', () => {
    const first = repositorySyncLoadingToast('repo-one', 'push', 'Pushing one…');
    expect(first).toEqual({
      id: expect.stringMatching(/^repository-sync:repo-one:push:/),
      title: 'Pushing one…',
    });
    const otherRepo = repositorySyncLoadingToast('repo-two', 'push', 'Pushing two…');
    const nextPush = repositorySyncLoadingToast('repo-one', 'push', 'Pushing again…');
    const pull = repositorySyncLoadingToast('repo-one', 'pull', 'Pulling…');
    expect(new Set([first.id, otherRepo.id, nextPush.id, pull.id]).size).toBe(4);
  });

  it('identifies each repository in successful pull and push results', () => {
    expect(projectPullSuccessCopy('Web · frontend', { status: 'success', commits: 2, restoredLocalChanges: true, rebased: false, localCommits: 0 })).toEqual({
      title: 'Web · frontend: 2 commits pulled',
      description: 'Local and staged changes were restored.',
    });
    expect(projectPullSuccessCopy('repotest', { status: 'success', commits: 73, restoredLocalChanges: false, rebased: true, localCommits: 1 })).toEqual({
      title: 'repotest: 73 commits pulled',
      description: 'Your local commit was kept on top and is ready to push.',
    });
    expect(projectPushSuccessCopy('API · backend', { status: 'up-to-date' })).toEqual({ title: 'API · backend: no commits pending push' });
  });

  it('keeps blocked operations attributable and actionable', () => {
    expect(projectPullBlockedCopy('Web · frontend', { status: 'rebase-conflict', files: ['netpol.yaml'] })).toEqual({
      title: 'Could not pull Web · frontend',
      description: 'Your local commits overlap the remote changes in netpol.yaml. The branch was left unchanged.',
      duration: 10_000,
    });
    expect(projectPushBlockedCopy('API · backend', { status: 'no-upstream' })).toEqual({
      title: 'Could not push API · backend',
      description: 'Current branch has no upstream configured.',
      duration: 10_000,
    });
    expect(projectPullBlockedCopy('Web · frontend', { status: 'stash-conflict', updated: true, files: ['App.tsx'], stashOid: 'abc123' })).toEqual({
      title: 'Web · frontend updated with local conflicts',
      description: 'Safety stash was preserved. Resolve conflicts before continuing.',
      duration: 12_000,
    });
  });
});
