import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GitProcess } from './GitProcess';
import { addWorktree, git, repositoryWithUpstream } from './test-support/repository-fixtures';

async function feature() {
  const f = await repositoryWithUpstream();
  await git(f.work, ['branch', 'feature']);
  await git(f.work, ['push', '-u', 'origin', 'feature']);
  const details = await f.operations.remoteBranchDetails(f.repositoryId, 'refs/remotes/origin/feature');
  const request = { repositoryId: f.repositoryId, fullName: details.fullName, expectedOid: details.oid, destinationId: details.destinationId };
  return { ...f, details, request };
}

describe('remote branch management', () => {
  it('lists locals and remotes, excludes symbolic aliases, and identifies tracking branches', async () => {
    const f = await feature();
    await git(f.work, ['remote', 'set-head', 'origin', '-a']);
    const snapshot = await f.operations.localRefsSnapshot(f.repositoryId);
    expect(snapshot.remotes).toEqual(['origin']);
    expect(snapshot.branches.map(branch => branch.fullName)).toContain('refs/remotes/origin/feature');
    expect(snapshot.branches.map(branch => branch.fullName)).not.toContain('refs/remotes/origin/HEAD');
    expect(snapshot.branches.find(branch => branch.fullName === f.details.fullName))
      .toMatchObject({ remoteName: 'origin', remoteBranchName: 'feature' });
    expect(f.details).toMatchObject({ remote: 'origin', branchName: 'feature', defaultBranch: 'main', deletionBlockedReason: null,
      localBranches: [expect.objectContaining({ fullName: 'refs/heads/feature' })] });
  });

  it('creates a tracking branch without switching checkout or touching local changes', async () => {
    const f = await feature();
    await writeFile(path.join(f.work, 'unstaged.txt'), 'keep my edits\n');
    const status = await git(f.work, ['status', '--porcelain']);
    expect(await f.operations.createTrackingBranch({ ...f.request, localName: 'review/feature' }))
      .toEqual({ status: 'created', fullName: 'refs/heads/review/feature' });
    expect(await git(f.work, ['branch', '--show-current'])).toBe('main');
    expect(await git(f.work, ['status', '--porcelain'])).toBe(status);
    expect(await git(f.work, ['rev-parse', 'review/feature@{upstream}'])).toBe(f.details.oid);
    expect(await f.operations.createTrackingBranch({ ...f.request, localName: 'feature' })).toEqual({ status: 'exists' });
    await expect(f.operations.createTrackingBranch({ ...f.request, localName: '../bad' })).rejects.toThrow();
  });

  it('deletes only the remote branch while retaining local branches and worktrees', async () => {
    const f = await feature();
    const target = await addWorktree(f, 'review', 'review');
    await git(f.work, ['config', 'remote.origin.mirror', 'true']);
    await git(f.work, ['config', 'remote.origin.push', 'refs/heads/*:refs/heads/*']);
    await git(f.work, ['config', 'push.followTags', 'true']);
    await git(f.work, ['tag', '-a', 'keep-local-tag', '-m', 'Local']);
    expect(await f.operations.deleteRemoteBranch(f.request)).toEqual({ status: 'deleted' });
    expect(await git(f.remote, ['for-each-ref', '--format=%(refname)'])).toBe('refs/heads/main');
    expect(await git(f.work, ['rev-parse', 'feature'])).toBe(f.details.oid);
    expect(await git(target, ['rev-parse', 'HEAD'])).toBe(f.details.oid);
  });

  it('refuses a remote tip changed after the details loaded', async () => {
    const f = await feature();
    await git(f.work, ['commit', '--allow-empty', '-m', 'New commit']);
    await git(f.work, ['push', 'origin', 'main']);
    const changed = await git(f.work, ['rev-parse', 'HEAD']);
    await git(f.remote, ['update-ref', 'refs/heads/feature', changed]);
    expect(await f.operations.deleteRemoteBranch(f.request)).toEqual({ status: 'stale' });
    expect(await git(f.remote, ['rev-parse', 'feature'])).toBe(changed);
    expect(await f.operations.remoteBranchDetails(f.repositoryId, f.request.fullName))
      .toMatchObject({ deletionBlockedReason: expect.stringContaining('changed since the last fetch') });
  });

  it('rechecks the remote default branch at deletion time', async () => {
    const f = await feature();
    await git(f.remote, ['symbolic-ref', 'HEAD', 'refs/heads/feature']);
    expect(await f.operations.deleteRemoteBranch(f.request)).toEqual({ status: 'default' });
    expect(await git(f.remote, ['rev-parse', 'feature'])).toBe(f.details.oid);
  });

  it('rejects a concurrent update between the remote check and the push', async () => {
    const f = await feature();
    await git(f.work, ['commit', '--allow-empty', '-m', 'Concurrent commit']);
    await git(f.work, ['push', 'origin', 'main']);
    const changed = await git(f.work, ['rev-parse', 'HEAD']);
    const original = GitProcess.prototype.run;
    const spy = vi.spyOn(GitProcess.prototype, 'run').mockImplementation(async function (this: GitProcess, cwd, args, options) {
      if (options.operation === 'delete-remote-branch') await git(f.remote, ['update-ref', 'refs/heads/feature', changed]);
      return original.call(this, cwd, args, options);
    });
    try {
      expect(await f.operations.deleteRemoteBranch(f.request)).toMatchObject({ status: 'rejected' });
      expect(await git(f.remote, ['rev-parse', 'feature'])).toBe(changed);
      expect(await git(f.work, ['rev-parse', 'feature'])).toBe(f.details.oid);
    } finally { spy.mockRestore(); }
  });

  it('keeps the branch when the server refuses deletion and hides server details', async () => {
    const f = await feature();
    await writeFile(path.join(f.remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho private-server-information >&2\nexit 1\n', { mode: 0o755 });
    const result = await f.operations.deleteRemoteBranch(f.request);
    expect(result).toMatchObject({ status: 'rejected', message: expect.stringContaining('permissions or branch protection') });
    expect(JSON.stringify(result)).not.toContain('private-server-information');
    expect(await git(f.remote, ['rev-parse', 'feature'])).toBe(f.details.oid);
  });

  it('does not delete when push destination configuration changed', async () => {
    const f = await feature();
    await git(f.work, ['remote', 'set-url', '--push', 'origin', path.join(f.root, 'other.git')]);
    expect(await f.operations.deleteRemoteBranch(f.request)).toEqual({ status: 'destination-changed' });
    expect(await git(f.remote, ['rev-parse', 'feature'])).toBe(f.details.oid);
    expect(await f.operations.remoteBranchDetails(f.repositoryId, f.request.fullName))
      .toMatchObject({ deletionBlockedReason: expect.stringContaining('destinations differ') });
  });

  it('supports custom fetch mappings and remote names containing slashes', async () => {
    const f = await feature();
    await git(f.work, ['remote', 'add', 'team/review', f.remote]);
    await git(f.work, ['config', 'remote.team/review.fetch', '+refs/heads/*:refs/remotes/cache/review/*']);
    await f.operations.fetchBranches(f.repositoryId);
    const details = await f.operations.remoteBranchDetails(f.repositoryId, 'refs/remotes/cache/review/feature');
    expect(details).toMatchObject({ remote: 'team/review', branchName: 'feature' });
    expect(await f.operations.deleteRemoteBranch({ repositoryId: f.repositoryId, fullName: details.fullName,
      expectedOid: details.oid, destinationId: details.destinationId })).toEqual({ status: 'deleted' });
  });

  it('fetches and prunes branch refs across remotes while preserving tags and local branches', async () => {
    const f = await feature();
    await git(f.work, ['remote', 'add', 'second', f.remote]);
    await git(f.work, ['tag', 'local-tag']);
    await git(f.work, ['config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*']);
    await git(f.work, ['config', 'fetch.pruneTags', 'true']);
    await git(f.remote, ['update-ref', '-d', 'refs/heads/feature']);
    expect(await f.operations.remoteBranchDetails(f.repositoryId, f.request.fullName)).toMatchObject({ remoteState: 'missing' });
    expect(await f.operations.fetchBranches(f.repositoryId)).toMatchObject({ status: 'success' });
    expect(await git(f.work, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/feature'])).toBe('');
    expect(await git(f.work, ['rev-parse', 'refs/remotes/second/main'])).toBe(f.details.oid);
    expect(await git(f.work, ['rev-parse', 'feature'])).toBe(f.details.oid);
    expect(await git(f.work, ['rev-parse', 'refs/tags/local-tag'])).toBe(f.details.oid);
  });

  it('rejects symbolic and unmapped refs and refuses stale creation', async () => {
    const f = await feature();
    await git(f.work, ['remote', 'set-head', 'origin', '-a']);
    await expect(f.operations.remoteBranchDetails(f.repositoryId, 'refs/remotes/origin/HEAD')).rejects.toThrow();
    expect(await f.operations.createTrackingBranch({ ...f.request, expectedOid: '0'.repeat(40), localName: 'stale' })).toEqual({ status: 'stale' });
    expect(await f.operations.createTrackingBranch({ ...f.request, fullName: 'refs/heads/feature', localName: 'wrong' })).toEqual({ status: 'missing' });
    await git(f.work, ['update-ref', 'refs/remotes/unknown/feature', f.details.oid]);
    await expect(f.operations.remoteBranchDetails(f.repositoryId, 'refs/remotes/unknown/feature')).rejects.toThrow();
  });
});
