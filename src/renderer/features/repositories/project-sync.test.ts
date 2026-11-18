import { describe, expect, it } from 'vitest';
import { countsAfterFailedFetch, mobileSyncPill, nothingPushedCopy, projectPullBlockedCopy, projectPullSuccessCopy, projectPushSuccessCopy, pullAndPushSuccessCopy, pushBlockedCopy, repositorySyncLoadingToast, settleRepositorySync, visibleRepositorySyncActions, type ProjectSyncAction, type RepositorySyncCounts } from './project-sync';

describe('the sync pill in a phone top bar', () => {
  const status = { branch: 'feature', upstream: 'origin/feature', ahead: 0, behind: 0 };

  it('offers nothing when the branch is up to date', () => {
    expect(mobileSyncPill(status)).toBeNull();
    expect(mobileSyncPill(null)).toBeNull();
  });

  it('offers pushing with its count, and publishing a branch with no upstream', () => {
    expect(mobileSyncPill({ ...status, ahead: 2 })).toEqual({ action: 'push', count: 2 });
    expect(mobileSyncPill({ ...status, upstream: null })).toEqual({ action: 'publish' });
    expect(mobileSyncPill({ ...status, upstream: null, ahead: 4 })).toEqual({ action: 'publish' });
  });

  it('pulls first when both apply, because the push would be refused', () => {
    expect(mobileSyncPill({ ...status, behind: 3 })).toEqual({ action: 'pull', count: 3 });
    expect(mobileSyncPill({ ...status, ahead: 2, behind: 3 })).toEqual({ action: 'pull', count: 3 });
  });

  it('stays out while syncing could not run', () => {
    for (const blocked of [{ readOnly: true }, { detached: true }, { unborn: true }]) {
      expect(mobileSyncPill({ ...status, ahead: 2, behind: 3, ...blocked })).toBeNull();
    }
  });
});

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
    expect(pushBlockedCopy('API · backend', { status: 'no-upstream' }, { project: true })).toEqual({
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

describe('the notice for a push that did not happen', () => {
  const gitOutput = " ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'https://github.com/acme/deployments.git'";

  it('offers to pull and push with the real upstream and counts', () => {
    expect(pushBlockedCopy('deployments', { status: 'diverged', ahead: 1, behind: 1, upstream: 'origin/main', incoming: ['4c1d9aa fix(values): bump image tag'], details: gitOutput })).toEqual({
      title: 'Push needs the latest commits first',
      lead: "origin/main has 1 commit you don't have.",
      description: 'Your commit has to go on top of it before it can be pushed.',
      details: `${gitOutput}\nThis branch is 1 behind and 1 ahead of origin/main.\nincoming: 4c1d9aa fix(values): bump image tag`,
      action: 'sync', offer: true, duration: 15_000,
    });
    expect(pushBlockedCopy('deployments', { status: 'diverged', ahead: 3, behind: 7, upstream: 'origin/main', incoming: ['a1 one', 'b2 two'] })).toMatchObject({
      lead: "origin/main has 7 commits you don't have.",
      description: 'Your 3 commits have to go on top of them before they can be pushed.',
      details: 'This branch is 7 behind and 3 ahead of origin/main.\nincoming: a1 one\nincoming: b2 two\nand 5 more',
    });
  });

  it('names the repository of a project row, and falls back to the upstream the client knows', () => {
    expect(pushBlockedCopy('Web · frontend', { status: 'diverged', ahead: 2, behind: 1, upstream: 'origin/dev' }, { project: true })).toMatchObject({
      title: 'Web · frontend needs the latest commits first', lead: "origin/dev has 1 commit you don't have.", action: 'sync',
    });
    expect(pushBlockedCopy('deployments', { status: 'rejected', reason: 'remote-changed', message: '', details: gitOutput }, { upstream: 'origin/main' })).toMatchObject({
      title: 'Push needs the latest commits first', lead: "origin/main has commits you don't have.", details: gitOutput, action: 'sync', offer: true,
    });
  });

  it('only offers pulling when there is nothing to push', () => {
    expect(pushBlockedCopy('deployments', { status: 'diverged', ahead: 0, behind: 2, upstream: 'origin/main' })).toMatchObject({
      description: 'Pull them first. There is nothing to push yet.', action: 'pull',
    });
  });

  it('offers repository access only for account problems, and never puts Git output in the body', () => {
    const reasons = ['authentication', 'inaccessible', 'permission', 'destination-exists', 'hook', 'network', 'configuration', 'unknown'] as const;
    const copies = reasons.map((reason) => pushBlockedCopy('deployments', { status: 'rejected', reason, message: '', details: gitOutput }));
    expect(copies.map((copy) => copy.action)).toEqual(['access', 'access', 'access', undefined, undefined, undefined, undefined, undefined]);
    for (const copy of copies) {
      expect(copy.title).toBe('deployments: could not push commits');
      expect(copy.description).toMatch(/^[A-Z][^\n]+\.$/);
      expect(`${copy.lead ?? ''}${copy.description}`).not.toMatch(/rejected|failed to push|github\.com/);
      expect(copy.details).toBe(gitOutput);
    }
    expect(new Set(copies.map((copy) => copy.description)).size).toBe(reasons.length);
  });

  it('keeps the sentence the server wrote for a branch name the remote already uses', () => {
    const message = "origin/fix/login already exists and has commits this branch doesn't. OpenTig won't overwrite it, and the branch still tracks origin/dev.";
    for (const project of [false, true]) {
      const copy = pushBlockedCopy('deployments', { status: 'rejected', reason: 'destination-exists', message, details: gitOutput }, { project });
      expect(copy).toMatchObject({ description: message, details: gitOutput });
      expect(copy.action).toBeUndefined();
    }
  });
});

describe('pulling and then pushing as one notice', () => {
  const pulled = { status: 'success', commits: 1, restoredLocalChanges: false, rebased: true, localCommits: 1 } as const;

  it('reports both halves once, with their own counts', () => {
    expect(pullAndPushSuccessCopy(null, pulled, { status: 'success', commits: 1 })).toEqual({ title: 'Pulled 1 commit and pushed 1' });
    expect(pullAndPushSuccessCopy('Web · frontend', { ...pulled, commits: 4, restoredLocalChanges: true }, { status: 'success', commits: 2 })).toEqual({
      title: 'Web · frontend: pulled 4 commits and pushed 2',
      description: 'Local and staged changes were restored.',
    });
  });

  it('does not claim a pull or a push that did not happen', () => {
    expect(pullAndPushSuccessCopy(null, { status: 'up-to-date' }, { status: 'success', commits: 2 })).toEqual({ title: '2 commits pushed' });
    expect(pullAndPushSuccessCopy(null, pulled, { status: 'up-to-date' })).toEqual({ title: 'Pulled 1 commit; nothing left to push' });
    expect(pullAndPushSuccessCopy(null, pulled, null)).toEqual({ title: 'Pulled 1 commit; publication canceled' });
  });

  it('says nothing was pushed when the pull stops it', () => {
    const stopped = projectPullBlockedCopy('Web · frontend', { status: 'rebase-conflict', files: ['values.yaml'] });
    expect(nothingPushedCopy(stopped).description).toBe('Your local commits overlap the remote changes in values.yaml. The branch was left unchanged. Nothing was pushed.');
    const untitled = { title: 'Branch has no upstream configured' };
    expect(nothingPushedCopy(untitled)).toEqual({ title: 'Branch has no upstream configured', description: 'Nothing was pushed.' });
  });
});


describe('the counts of a repository whose fetch failed', () => {
  const status = { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 0, detached: false, unborn: false, readOnly: false, operation: null };
  const counts = new Map([['open', { ahead: 2, behind: 1 }], ['other', { ahead: 3, behind: 0 }]]);

  it('keeps the open repository on offer with what its status says', () => {
    const next = countsAfterFailedFetch(counts, 'open', { repositoryId: 'open', status });
    expect(next.get('open')).toEqual(status);
    expect(visibleRepositorySyncActions(next.get('open'))).toEqual(['push']);
    expect(next.get('other')).toEqual({ ahead: 3, behind: 0 });
  });

  it('offers nothing for another repository, or for the open one before its status is read', () => {
    expect(countsAfterFailedFetch(counts, 'other', { repositoryId: 'open', status }).has('other')).toBe(false);
    expect(countsAfterFailedFetch(counts, 'open', { repositoryId: 'open', status: null }).has('open')).toBe(false);
  });
});

describe('a row of the repository list as its pull or push ends', () => {
  /**
   * A row as the list draws it, noting what it shows after every change: an
   * action with `…` while its spinner turns, the actions on offer otherwise.
   */
  function listRow(counts: RepositorySyncCounts, running: ProjectSyncAction) {
    let state: { counts: RepositorySyncCounts; running?: ProjectSyncAction } = { counts, running };
    const shown: string[][] = [];
    const draw = () => shown.push(state.running ? [`${state.running}…`] : visibleRepositorySyncActions(state.counts));
    draw();
    return {
      shown,
      // The repository's status is read again, and answers a moment later.
      recount: (after: RepositorySyncCounts) => async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        state = { ...state, counts: after };
        draw();
      },
      release: () => { state = { counts: state.counts }; draw(); },
    };
  }

  it('goes from the spinner straight to what is left, for a pull and for a push', async () => {
    const pulled = listRow({ ahead: 0, behind: 2 }, 'pull');
    await settleRepositorySync(pulled.recount({ ahead: 0, behind: 0 }), pulled.release);
    expect(pulled.shown).toEqual([['pull…'], ['pull…'], []]);

    const pushed = listRow({ ahead: 3, behind: 0 }, 'push');
    await settleRepositorySync(pushed.recount({ ahead: 0, behind: 0 }), pushed.release);
    expect(pushed.shown).toEqual([['push…'], ['push…'], []]);
  });

  it('offers again what is still pending after a pull that failed or a push that was refused', async () => {
    const failed = listRow({ ahead: 0, behind: 2 }, 'pull');
    await settleRepositorySync(failed.recount({ ahead: 0, behind: 2 }), failed.release);
    expect(failed.shown.at(-1)).toEqual(['pull']);

    const refused = listRow({ ahead: 1, behind: 0 }, 'push');
    await settleRepositorySync(refused.recount({ ahead: 1, behind: 1 }), refused.release);
    expect(refused.shown).toEqual([['push…'], ['push…'], ['pull', 'push']]);
  });

  it('lets the row go when its status cannot be read', async () => {
    const row = listRow({ ahead: 0, behind: 2 }, 'pull');
    await settleRepositorySync(() => Promise.reject(new Error('The server did not answer.')), row.release);
    expect(row.shown.at(-1)).not.toEqual(['pull…']);
  });
});
