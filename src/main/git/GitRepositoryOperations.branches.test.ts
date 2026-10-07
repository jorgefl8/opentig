import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { managementRepository, addRemote, addWorktree, commitOnBranch, realPath, standaloneRepository, git, gitRaw } from './test-support/repository-fixtures';

describe('GitRepositoryOperations local refs snapshot', () => {
  it('returns local and remote branches, current first, with tip metadata', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'zeta']);
    await git(fixture.work, ['branch', 'alpha']);
    await addRemote(fixture);
    await git(fixture.work, ['push', '-q', 'origin', 'main']);
    const headOid = await git(fixture.work, ['rev-parse', 'HEAD']);

    const snapshot = await fixture.operations.localRefsSnapshot(fixture.repositoryId);
    expect(snapshot.branches.map((branch) => branch.name)).toEqual(['main', 'alpha', 'origin/main', 'zeta']);
    expect(snapshot.branches.filter((branch) => branch.remote)).toHaveLength(1);
    expect(snapshot.branches[0]).toMatchObject({ current: true, oid: headOid, subject: 'Base commit', author: 'OpenTig Test' });
    expect(snapshot.branches[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('identifies the main worktree and the one OpenTig currently has open', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');

    const snapshot = await fixture.operations.localRefsSnapshot(fixture.repositoryId);
    expect(snapshot.worktrees).toHaveLength(2);
    expect(snapshot.worktrees[0]).toMatchObject({ main: true, current: true, branch: 'main' });
    expect(snapshot.worktrees[1]).toMatchObject({ main: false, current: false, branch: 'review' });
    expect(await realPath(snapshot.worktrees[1]!.path)).toBe(await realPath(review));
  });
});

describe('GitRepositoryOperations branch switching', () => {
  it('offers blocked local changes and then moves them to the destination unstaged', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'first\nsecond\nthird\n');
    await git(fixture.work, ['commit', '-am', 'Expand fixture']);
    await git(fixture.work, ['switch', '-c', 'destination']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'destination\nsecond\nthird\n');
    await git(fixture.work, ['commit', '-am', 'Change destination']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'first\nsecond\nlocal staged\n');
    await git(fixture.work, ['add', 'file.txt']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'first\nsecond\nlocal staged\nlocal unstaged\n');
    await writeFile(path.join(fixture.work, 'untracked.txt'), 'untracked\n');

    expect(await fixture.operations.switchBranch(fixture.repositoryId, 'destination')).toEqual({
      status: 'blocked-local-changes', files: ['file.txt', 'untracked.txt'],
    });
    expect(await git(fixture.work, ['branch', '--show-current'])).toBe('main');

    expect(await fixture.operations.switchBranch(fixture.repositoryId, 'destination', true)).toEqual({
      status: 'switched', movedChanges: true,
    });
    expect(await git(fixture.work, ['branch', '--show-current'])).toBe('destination');
    expect(await gitRaw(fixture.work, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await gitRaw(fixture.work, ['diff', '--name-only'])).toBe('file.txt\n');
    expect(await gitRaw(fixture.work, ['status', '--porcelain', '--', 'untracked.txt'])).toBe('?? untracked.txt\n');
    expect(await gitRaw(fixture.work, ['stash', 'list'])).toBe('');
    expect((await readFile(path.join(fixture.work, 'file.txt'), 'utf8')).replace(/\r\n/g, '\n'))
      .toBe('destination\nsecond\nlocal staged\nlocal unstaged\n');
  });

  it('keeps the safety stash when moved changes conflict on the destination', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['switch', '-c', 'destination']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'destination\n');
    await git(fixture.work, ['commit', '-am', 'Change destination']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'local\n');

    expect((await fixture.operations.switchBranch(fixture.repositoryId, 'destination')).status).toBe('blocked-local-changes');
    const result = await fixture.operations.switchBranch(fixture.repositoryId, 'destination', true);
    expect(result).toMatchObject({ status: 'moved-with-conflicts', files: ['file.txt'] });
    expect(await git(fixture.work, ['branch', '--show-current'])).toBe('destination');
    expect(await gitRaw(fixture.work, ['status', '--porcelain', '--', 'file.txt'])).toContain('UU file.txt');
    expect(await gitRaw(fixture.work, ['stash', 'list'])).toContain('OpenTig branch move to destination');
  });
});

describe('GitRepositoryOperations branch details', () => {
  it('reports a merged branch as safe against HEAD when no upstream is configured', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'merged']);
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/merged')).toMatchObject({
      name: 'merged', deletion: 'safe', comparisonKind: 'head', comparisonBase: 'HEAD', uniqueCommits: 0,
    });
  });

  it('reports an unmerged branch with the commits it would take with it', async () => {
    const fixture = await managementRepository();
    await commitOnBranch(fixture, 'feature', 'one');
    await commitOnBranch(fixture, 'feature', 'two');
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/feature')).toMatchObject({
      deletion: 'unmerged', comparisonKind: 'head', comparisonBase: 'HEAD', uniqueCommits: 2,
    });
  });

  it('prefers the configured upstream over HEAD', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await commitOnBranch(fixture, 'tracked', 'shared');
    await git(fixture.work, ['push', '-q', '-u', 'origin', 'tracked']);
    // Merged into its upstream even though it is ahead of HEAD.
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/tracked')).toMatchObject({
      deletion: 'safe', comparisonKind: 'upstream', comparisonBase: 'origin/tracked', uniqueCommits: 0, upstream: 'origin/tracked',
    });

    await commitOnBranch(fixture, 'tracked', 'unpushed');
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/tracked')).toMatchObject({
      deletion: 'unmerged', comparisonKind: 'upstream', comparisonBase: 'origin/tracked', uniqueCommits: 1,
    });
  });

  it('reports current and checked-out states before analyzing merges', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/main')).toMatchObject({
      deletion: 'current', comparisonKind: 'none', comparisonBase: null, uniqueCommits: 0,
    });
    const details = await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/review');
    expect(details).toMatchObject({ deletion: 'checked-out', comparisonKind: 'none', comparisonBase: null });
    expect(await realPath(details.worktreePath!)).toBe(await realPath(review));
  });

  it('returns unknown rather than guessing when the upstream no longer resolves locally', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await commitOnBranch(fixture, 'gone', 'work');
    await git(fixture.work, ['push', '-q', '-u', 'origin', 'gone']);
    await git(fixture.work, ['update-ref', '-d', 'refs/remotes/origin/gone']);
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/gone')).toMatchObject({
      deletion: 'unknown', comparisonKind: 'upstream', comparisonBase: 'origin/gone', uniqueCommits: 0,
    });
  });

  it('rejects a branch that no longer exists and never accepts a remote ref', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await git(fixture.work, ['push', '-q', 'origin', 'main']);
    await expect(fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/never')).rejects.toThrow();
    await expect(fixture.operations.branchDetails(fixture.repositoryId, 'refs/remotes/origin/main')).rejects.toThrow();
  });
});

describe('GitRepositoryOperations safe branch deletion', () => {
  it('deletes a merged unused branch and leaves every other ref in place', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'merged']);
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/merged']);
    const headBefore = await git(fixture.work, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/merged', oid))
      .toEqual({ status: 'deleted', fullName: 'refs/heads/merged', name: 'merged', oid });
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe('refs/heads/main');
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(headBefore);
  });

  it('deletes branch names containing spaces and Unicode', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'función/ñandú']);
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/función/ñandú']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/función/ñandú', oid))
      .toMatchObject({ status: 'deleted', name: 'función/ñandú' });
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe('refs/heads/main');
  });

  it('refuses the current branch without touching it', async () => {
    const fixture = await managementRepository();
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/main']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/main', oid)).toEqual({ status: 'current' });
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/main'])).toBe(oid);
  });

  it('refuses a branch checked out in another worktree', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/review']);
    const result = await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/review', oid);
    expect(result.status).toBe('checked-out');
    expect(await realPath((result as { worktreePath: string }).worktreePath)).toBe(await realPath(review));
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/review'])).toBe(oid);
  });

  it('refuses an unmerged branch and reports the base it compared against', async () => {
    const fixture = await managementRepository();
    await commitOnBranch(fixture, 'feature', 'unmerged work');
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/feature']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/feature', oid))
      .toEqual({ status: 'unmerged', comparisonBase: 'HEAD', uniqueCommits: 1 });
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/feature'])).toBe(oid);
  });

  it('force-deletes an unmerged branch after explicit confirmation', async () => {
    const fixture = await managementRepository();
    await commitOnBranch(fixture, 'temporary', 'unmerged work');
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/temporary']);

    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/temporary', oid, true))
      .toEqual({ status: 'deleted', fullName: 'refs/heads/temporary', name: 'temporary', oid });
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads/temporary'])).toBe('');
  });

  it('refuses a branch whose comparison base no longer resolves', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await commitOnBranch(fixture, 'gone', 'work');
    await git(fixture.work, ['push', '-q', '-u', 'origin', 'gone']);
    await git(fixture.work, ['update-ref', '-d', 'refs/remotes/origin/gone']);
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/gone']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/gone', oid))
      .toEqual({ status: 'unknown', comparisonBase: 'origin/gone' });
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/gone'])).toBe(oid);
  });

  it('refuses a stale expected OID and a missing branch', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'merged']);
    const staleOid = await git(fixture.work, ['rev-parse', 'refs/heads/merged']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'base\nmore\n');
    await git(fixture.work, ['commit', '-qam', 'Move main']);
    await git(fixture.work, ['branch', '-f', 'merged', 'HEAD']);

    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/merged', staleOid)).toEqual({ status: 'stale' });
    expect(await git(fixture.work, ['rev-parse', '--verify', 'refs/heads/merged'])).not.toBe(staleOid);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/never', staleOid)).toEqual({ status: 'missing' });
  });
});
