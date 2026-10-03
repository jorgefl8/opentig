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
