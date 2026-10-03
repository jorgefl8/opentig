import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryWithUpstream, standaloneRepository, git, gitRaw } from './test-support/repository-fixtures';

describe('GitRepositoryOperations local history', () => {
  it('classifies published feature commits separately from the remote base and local work', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['switch', '-c', 'feature']);
    await writeFile(path.join(fixture.work, 'feature.txt'), 'published\n');
    await git(fixture.work, ['add', '.']);
    await git(fixture.work, ['commit', '-m', 'Published feature']);
    await git(fixture.work, ['push', '-u', 'origin', 'feature']);
    await writeFile(path.join(fixture.work, 'feature.txt'), 'local\n');
    await git(fixture.work, ['commit', '-am', 'Local feature']);
    const page = await fixture.operations.listCommits(fixture.repositoryId);
    expect(page.baseRef).toBe('origin/main');
    expect(page.commits.map((commit) => [commit.subject, commit.upstreamState, commit.baseState])).toEqual([
      ['Local feature', 'local-only', 'outside'], ['Published feature', 'published', 'outside'], ['Base commit', 'published', 'included'],
    ]);
  });

  it('marks commits relative to the configured upstream', async () => {
    const fixture = await repositoryWithUpstream();
    const baseOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await writeFile(path.join(fixture.work, 'committed.txt'), 'base\nlocal\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local change']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);

    const page = await fixture.operations.listCommits(fixture.repositoryId);
    expect(page.commits.find((commit) => commit.oid === localOid)).toMatchObject({ upstreamState: 'local-only', isHead: true });
    expect(page.commits.find((commit) => commit.oid === baseOid)).toMatchObject({ upstreamState: 'published', isHead: false });
  });

  it('uses unknown rather than guessing when no upstream exists', async () => {
    const fixture = await standaloneRepository();
    const page = await fixture.operations.listCommits(fixture.repositoryId);
    expect(page.commits).toHaveLength(1);
    expect(page.commits[0]).toMatchObject({ upstreamState: 'unknown', isHead: true });
  });

  it('undoes only the expected local HEAD while preserving index and worktree changes', async () => {
    const fixture = await repositoryWithUpstream();
    const baseOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await writeFile(path.join(fixture.work, 'committed.txt'), 'base\nlocal\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local subject', '-m', 'Local body']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);

    await writeFile(path.join(fixture.work, 'staged.txt'), 'base\nstaged later\n');
    await git(fixture.work, ['add', 'staged.txt']);
    await writeFile(path.join(fixture.work, 'unstaged.txt'), 'base\nunstaged later\n');
    const stagedBefore = await gitRaw(fixture.work, ['diff', '--cached', '--', 'staged.txt']);
    const unstagedBefore = await gitRaw(fixture.work, ['diff', '--', 'unstaged.txt']);

    const result = await fixture.operations.undoLatestCommit(fixture.repositoryId, localOid);
    expect(result).toMatchObject({ status: 'success', undoneOid: localOid, newHeadOid: baseOid, message: 'Local subject\n\nLocal body', stagedCount: 2 });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(baseOid);
    expect(await git(fixture.work, ['rev-parse', 'ORIG_HEAD'])).toBe(localOid);
    expect(await gitRaw(fixture.work, ['diff', '--cached', '--', 'staged.txt'])).toBe(stagedBefore);
    expect(await gitRaw(fixture.work, ['diff', '--', 'unstaged.txt'])).toBe(unstagedBefore);
    expect(await gitRaw(fixture.work, ['diff', '--cached', '--', 'committed.txt'])).toContain('+local');
  });

  it('rejects a stale expected OID without moving HEAD', async () => {
    const fixture = await repositoryWithUpstream();
    const baseOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await writeFile(path.join(fixture.work, 'committed.txt'), 'base\nlocal\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local change']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, baseOid)).toEqual({ status: 'stale-head' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(localOid);
  });

  it('does not undo without an upstream', async () => {
    const fixture = await standaloneRepository();
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, oid)).toEqual({ status: 'no-upstream' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(oid);
  });

  it('does not undo a commit that is already in the upstream', async () => {
    const fixture = await repositoryWithUpstream();
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, oid)).toEqual({ status: 'not-local' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(oid);
  });

  it('protects a local merge commit', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['switch', '-c', 'feature']);
    await writeFile(path.join(fixture.work, 'feature.txt'), 'feature\n');
    await git(fixture.work, ['add', 'feature.txt']);
    await git(fixture.work, ['commit', '-m', 'Feature change']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'main.txt'), 'main\n');
    await git(fixture.work, ['add', 'main.txt']);
    await git(fixture.work, ['commit', '-m', 'Main change']);
    await git(fixture.work, ['merge', '--no-ff', 'feature', '-m', 'Merge feature']);
    const mergeOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, mergeOid)).toEqual({ status: 'unsupported-merge' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(mergeOid);
  });
});
