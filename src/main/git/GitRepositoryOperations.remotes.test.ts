import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { managementRepository, addRemote, repositoryWithUpstream, commitOnRemote, git } from './test-support/repository-fixtures';

describe('GitRepositoryOperations branch publication', () => {
  it.each([0, 2])('publishes a branch with %i new commits and preserves uncommitted changes', async (count) => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['switch', '-c', 'feat/publish']);
    for (let index = 0; index < count; index += 1) await git(fixture.work, ['commit', '--allow-empty', '-m', `Local ${index}`]);
    await writeFile(path.join(fixture.work, 'staged.txt'), 'staged change\n');
    await git(fixture.work, ['add', 'staged.txt']);
    await writeFile(path.join(fixture.work, 'unstaged.txt'), 'unstaged change\n');
    await writeFile(path.join(fixture.work, 'new.txt'), 'untracked\n');
    const before = await git(fixture.work, ['status', '--porcelain']);
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ upstream: null, ahead: 0 });
    expect(await fixture.operations.push(fixture.repositoryId)).toEqual({ status: 'published', branch: 'feat/publish', remote: 'origin' });
    expect(await git(fixture.remote, ['rev-parse', 'refs/heads/feat/publish'])).toBe(oid);
    expect(await git(fixture.work, ['status', '--porcelain'])).toBe(before);
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ upstream: 'origin/feat/publish', ahead: 0, behind: 0 });
    expect((await fixture.operations.listCommits(fixture.repositoryId)).commits.every((commit) => commit.upstreamState === 'published')).toBe(true);
    expect(await fixture.operations.push(fixture.repositoryId)).toEqual({ status: 'up-to-date' });
    await git(fixture.work, ['commit', '--allow-empty', '-m', 'Next commit']);
    expect(await fixture.operations.push(fixture.repositoryId)).toEqual({ status: 'success', commits: 1 });
  });

  it('asks for a remote when several exist and publishes only to the selected remote', async () => {
    const fixture = await repositoryWithUpstream();
    const second = path.join(fixture.root, 'second.git');
    await git(fixture.root, ['init', '--bare', second]);
    await git(fixture.work, ['remote', 'add', 'second', second]);
    await git(fixture.work, ['switch', '-c', 'choose']);
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.push(fixture.repositoryId)).toEqual({ status: 'remote-required', branch: 'choose', oid, remotes: ['origin', 'second'] });
    expect(await git(second, ['for-each-ref'])).toBe('');
    expect(await fixture.operations.push(fixture.repositoryId, { remote: 'second', expectedBranch: 'choose', expectedOid: oid }))
      .toEqual({ status: 'published', branch: 'choose', remote: 'second' });
    expect(await git(second, ['rev-parse', 'refs/heads/choose'])).toBe(oid);
    expect(await git(fixture.remote, ['for-each-ref', 'refs/heads/choose'])).toBe('');
  });

  it.each(['branch.preferred.pushRemote', 'remote.pushDefault', 'branch.preferred.remote'])('respects %s for publication', async (key) => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['remote', 'add', 'second', fixture.remote]);
    await git(fixture.work, ['switch', '-c', 'preferred']);
    await git(fixture.work, ['config', key, 'second']);
    expect(await fixture.operations.push(fixture.repositoryId)).toEqual({ status: 'published', branch: 'preferred', remote: 'second' });
  });

  it('prefers branch pushRemote over remote.pushDefault and refuses invalid destinations', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['remote', 'add', 'second', fixture.remote]);
    await git(fixture.work, ['switch', '-c', 'preferred']);
    await git(fixture.work, ['config', 'remote.pushDefault', 'second']);
    await git(fixture.work, ['config', 'branch.preferred.pushRemote', 'missing']);
    expect(await fixture.operations.push(fixture.repositoryId)).toMatchObject({ status: 'rejected', reason: 'configuration' });
    await git(fixture.work, ['config', 'branch.preferred.pushRemote', 'origin']);
    expect(await fixture.operations.push(fixture.repositoryId)).toEqual({ status: 'published', branch: 'preferred', remote: 'origin' });
  });

  it('refuses a changed branch or commit while remote selection was open', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['switch', '-c', 'selected']);
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    const selection = { remote: 'origin', expectedBranch: 'selected', expectedOid: oid };
    await git(fixture.work, ['switch', '-c', 'other']);
    expect(await fixture.operations.push(fixture.repositoryId, selection)).toMatchObject({ status: 'rejected', reason: 'configuration' });
    await git(fixture.work, ['switch', 'selected']);
    await git(fixture.work, ['commit', '--allow-empty', '-m', 'Changed']);
    expect(await fixture.operations.push(fixture.repositoryId, selection)).toMatchObject({ status: 'rejected', reason: 'configuration' });
    expect(await git(fixture.remote, ['for-each-ref', 'refs/heads/selected', 'refs/heads/other'])).toBe('');
  });

  it('sets upstream when the same branch already exists remotely', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['branch', '--unset-upstream']);
    expect(await fixture.operations.push(fixture.repositoryId)).toEqual({ status: 'published', branch: 'main', remote: 'origin' });
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ upstream: 'origin/main' });
  });

  it('does not overwrite a diverged remote branch', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['branch', '--unset-upstream']);
    await git(fixture.work, ['commit', '--allow-empty', '-m', 'Local']);
    await commitOnRemote(fixture, 'remote.txt', 'remote\n', 'Remote');
    const remoteOid = await git(fixture.remote, ['rev-parse', 'main']);
    expect(await fixture.operations.push(fixture.repositoryId)).toMatchObject({ status: 'rejected', reason: 'remote-changed' });
    expect(await git(fixture.remote, ['rev-parse', 'main'])).toBe(remoteOid);
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ upstream: null });
  });

  it('ignores mirror, tag-following, and extra push refspecs when publishing', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['switch', '-c', 'only-this']);
    await git(fixture.work, ['branch', 'unrelated']);
    await git(fixture.work, ['tag', '-a', 'local-tag', '-m', 'Local']);
    await git(fixture.work, ['config', 'remote.origin.mirror', 'true']);
    await git(fixture.work, ['config', 'remote.origin.push', 'refs/heads/*:refs/heads/*']);
    await git(fixture.work, ['config', 'push.followTags', 'true']);
    expect(await fixture.operations.push(fixture.repositoryId)).toMatchObject({ status: 'published' });
    expect(await git(fixture.remote, ['for-each-ref', '--format=%(refname)'])).toBe('refs/heads/main\nrefs/heads/only-this');
  });

  it('requires a remote, a checked-out branch, and an initial commit', async () => {
    const fixture = await managementRepository();
    expect(await fixture.operations.push(fixture.repositoryId)).toMatchObject({ status: 'rejected', message: expect.stringContaining('No remote') });
    await addRemote(fixture);
    await git(fixture.work, ['switch', '--detach']);
    expect(await fixture.operations.push(fixture.repositoryId)).toMatchObject({ status: 'rejected', message: expect.stringContaining('Check out a branch') });
    await git(fixture.work, ['switch', '--orphan', 'empty']);
    expect(await fixture.operations.push(fixture.repositoryId)).toMatchObject({ status: 'rejected', message: expect.stringContaining('first commit') });
  });
});

describe('GitRepositoryOperations fetch and pull', () => {
  it('fetches remote commits so behind counts become visible', async () => {
    const fixture = await repositoryWithUpstream();
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ ahead: 0, behind: 0 });
    expect(await fixture.operations.fetch(fixture.repositoryId)).toEqual({ status: 'success', ahead: 0, behind: 1 });
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ ahead: 0, behind: 1 });
  });

  it('shares one Git fetch among callers that arrive while it runs, and fetches again afterwards', async () => {
    const fixture = await repositoryWithUpstream();
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');
    let fetches = 0;
    fixture.gitProcess.network = (_cwd, args, options, execute) => {
      if (args.includes('fetch')) fetches += 1;
      return execute(args, options);
    };
    const results = await Promise.all([1, 2, 3].map(() => fixture.operations.fetch(fixture.repositoryId)));
    expect(results).toEqual([1, 2, 3].map(() => ({ status: 'success', ahead: 0, behind: 1 })));
    expect(fetches).toBe(1);

    await commitOnRemote(fixture, 'later.txt', 'from origin\n', 'Later remote commit');
    expect(await fixture.operations.fetch(fixture.repositoryId)).toEqual({ status: 'success', ahead: 0, behind: 2 });
    expect(fetches).toBe(2);
  });

  it('fast-forwards when the branch has no local commits', async () => {
    const fixture = await repositoryWithUpstream();
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');
    expect(await fixture.operations.pull(fixture.repositoryId)).toEqual({
      status: 'success', commits: 1, restoredLocalChanges: false, rebased: false, localCommits: 0,
    });
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ ahead: 0, behind: 0 });
  });

  it('rebases a local commit onto remote changes when there is no conflict', async () => {
    const fixture = await repositoryWithUpstream();
    await writeFile(path.join(fixture.work, 'local.txt'), 'mine\n');
    await git(fixture.work, ['add', 'local.txt']);
    await git(fixture.work, ['commit', '-m', 'Local commit']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');

    expect(await fixture.operations.pull(fixture.repositoryId)).toEqual({
      status: 'success', commits: 1, restoredLocalChanges: false, rebased: true, localCommits: 1,
    });
    const status = await fixture.repositories.status(fixture.repositoryId, false);
    expect(status).toMatchObject({ ahead: 1, behind: 0 });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).not.toBe(localOid);
    expect(await git(fixture.work, ['log', '-1', '--format=%s'])).toBe('Local commit');
    expect(await git(fixture.work, ['merge-base', '--is-ancestor', '@{upstream}', 'HEAD'])).toBe('');
  });

  it('aborts a conflicting rebase and leaves the local commit unchanged', async () => {
    const fixture = await repositoryWithUpstream();
    await writeFile(path.join(fixture.work, 'committed.txt'), 'local edit\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local edit']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await commitOnRemote(fixture, 'committed.txt', 'remote edit\n', 'Remote edit');

    const result = await fixture.operations.pull(fixture.repositoryId);
    expect(result.status).toBe('rebase-conflict');
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(localOid);
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ operation: null, ahead: 1, behind: 1 });
  });
});

describe('GitRepositoryOperations fast-forward-only pull', () => {
  const fastForwardOnly = { fastForwardOnly: true };

  it('moves past local changes Git does not need to touch, without a stash', async () => {
    const fixture = await repositoryWithUpstream();
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');
    await writeFile(path.join(fixture.work, 'unstaged.txt'), 'mine\n');
    await writeFile(path.join(fixture.work, 'new.txt'), 'untracked\n');
    const before = await git(fixture.work, ['status', '--porcelain']);

    expect(await fixture.operations.pull(fixture.repositoryId, fastForwardOnly)).toEqual({
      status: 'success', commits: 1, restoredLocalChanges: false, rebased: false, localCommits: 0, keptLocalChanges: true,
    });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(await git(fixture.work, ['rev-parse', '@{upstream}']));
    expect(await git(fixture.work, ['status', '--porcelain'])).toBe(before);
    expect(await git(fixture.work, ['stash', 'list'])).toBe('');
  });

  it.each([
    ['a modified file the pull changes', 'unstaged.txt'],
    ['an untracked file the pull would bring', 'incoming.txt'],
  ])('touches nothing when %s is in the way', async (_case, file) => {
    const fixture = await repositoryWithUpstream();
    await commitOnRemote(fixture, file, 'from origin\n', 'Remote commit');
    await writeFile(path.join(fixture.work, file), 'mine\n');
    const head = await git(fixture.work, ['rev-parse', 'HEAD']);
    const before = await git(fixture.work, ['status', '--porcelain']);

    expect(await fixture.operations.pull(fixture.repositoryId, fastForwardOnly)).toEqual({ status: 'blocked-local-changes', files: [file] });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(head);
    expect(await git(fixture.work, ['status', '--porcelain'])).toBe(before);
    expect(await git(fixture.work, ['stash', 'list'])).toBe('');
  });

  it('answers diverged for a branch with commits of its own and does not rebase it', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['commit', '--allow-empty', '-m', 'Local commit']);
    const head = await git(fixture.work, ['rev-parse', 'HEAD']);
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');

    expect(await fixture.operations.pull(fixture.repositoryId, fastForwardOnly)).toEqual({ status: 'diverged', ahead: 1, behind: 1 });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(head);
  });
});
