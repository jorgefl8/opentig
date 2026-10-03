import { rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { managementRepository, addWorktree, exists, realPath, git } from './test-support/repository-fixtures';

describe('GitRepositoryOperations safe worktree removal', () => {
  it.skipIf(process.platform !== 'linux')('distinguishes worktree paths differing only in case on Linux', async () => {
    const fixture = await managementRepository();
    const lower = await addWorktree(fixture, 'review', 'lower');
    const upper = await addWorktree(fixture, 'REVIEW', 'upper');
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, lower)).toMatchObject({ branch: 'lower' });
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, upper)).toMatchObject({ branch: 'upper' });
  });

  it('recognizes worktrees through a parent alias, including when the directory becomes prunable', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const alias = path.join(fixture.root, 'parent-alias');
    await symlink(fixture.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasedReview = path.join(alias, path.relative(fixture.root, review));
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, aliasedReview)).toMatchObject({ branch: 'review', available: true });
    await rm(review, { recursive: true, force: true });
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, aliasedReview)).toMatchObject({ available: false });
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, aliasedReview, oid)).toMatchObject({ status: 'prunable' });
  });

  it('removes a clean linked worktree, keeps its branch, and forgets only its recent entry', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    // Open it, then return to the main worktree, exactly as the UI would.
    await fixture.repositories.openPath(review);
    await fixture.repositories.openPath(fixture.work);
    expect(fixture.settings.recentRepositories).toHaveLength(2);
    const oid = await git(review, ['rev-parse', 'HEAD']);

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid);
    expect(result).toMatchObject({ status: 'removed', branch: 'review' });
    expect(await exists(review)).toBe(false);
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toContain('refs/heads/review');
    const recents = (result as { recentRepositories: { path: string }[] }).recentRepositories;
    expect(recents).toHaveLength(1);
    expect(await realPath(recents[0]!.path)).toBe(await realPath(fixture.work));
  // This scenario opens both worktrees and performs multiple real Git scans.
  // Windows runners can exceed the suite's 20s budget under parallel load.
  }, process.platform === 'win32' ? 60_000 : 20_000);

  it('removes a worktree whose path contains spaces and Unicode', async () => {
    const fixture = await managementRepository();
    const target = await addWorktree(fixture, 'mi revisión ñ', 'revisión');
    const oid = await git(target, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, target, oid)).toMatchObject({ status: 'removed', branch: 'revisión' });
    expect(await exists(target)).toBe(false);
  });

  it('refuses the main worktree and the one currently open', async () => {
    const fixture = await managementRepository();
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, fixture.work, oid)).toEqual({ status: 'main' });
    expect(await exists(fixture.work)).toBe(true);
  });

  it('refuses a linked worktree that OpenTig currently has open', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const opened = await fixture.repositories.openPath(review);
    expect(await fixture.operations.removeWorktree(opened.id, review, await git(review, ['rev-parse', 'HEAD']))).toEqual({ status: 'current' });
    expect(await exists(review)).toBe(true);
  });

  it('refuses a worktree in the middle of a Git operation', async () => {
    const fixture = await managementRepository();
    const conflicted = await addWorktree(fixture, 'conflicted', 'conflicted');
    await writeFile(path.join(conflicted, 'file.txt'), 'their side\n');
    await git(conflicted, ['commit', '-qam', 'Change on the worktree branch']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'our side\n');
    await git(fixture.work, ['commit', '-qam', 'Change on main']);
    await expect(git(conflicted, ['merge', 'main'])).rejects.toThrow();

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, conflicted, await git(conflicted, ['rev-parse', 'HEAD']));
    expect(result).toMatchObject({ status: 'dirty', conflictCount: 1, operation: 'merge' });
    expect(await exists(conflicted)).toBe(true);
  });

  it('refuses staged, unstaged, and untracked worktrees', async () => {
    const fixture = await managementRepository();
    const staged = await addWorktree(fixture, 'staged', 'staged');
    await writeFile(path.join(staged, 'file.txt'), 'staged change\n');
    await git(staged, ['add', 'file.txt']);
    const unstaged = await addWorktree(fixture, 'unstaged', 'unstaged');
    await writeFile(path.join(unstaged, 'file.txt'), 'unstaged change\n');
    const untracked = await addWorktree(fixture, 'untracked', 'untracked');
    await writeFile(path.join(untracked, 'extra.txt'), 'new\n');

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, staged, await git(staged, ['rev-parse', 'HEAD'])))
      .toMatchObject({ status: 'dirty', stagedCount: 1, operation: null });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, unstaged, await git(unstaged, ['rev-parse', 'HEAD'])))
      .toMatchObject({ status: 'dirty', unstagedCount: 1 });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, untracked, await git(untracked, ['rev-parse', 'HEAD'])))
      .toMatchObject({ status: 'dirty', untrackedCount: 1 });
    for (const directory of [staged, unstaged, untracked]) expect(await exists(directory)).toBe(true);
  });

  it('force-removes a dirty linked worktree while keeping its branch', async () => {
    const fixture = await managementRepository();
    const target = await addWorktree(fixture, 'dirty', 'dirty');
    await writeFile(path.join(target, 'file.txt'), 'uncommitted change\n');
    await writeFile(path.join(target, 'untracked.txt'), 'lost forever\n');
    const oid = await git(target, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, target, oid, true))
      .toMatchObject({ status: 'removed', branch: 'dirty' });
    expect(await exists(target)).toBe(false);
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads/dirty'])).toContain('refs/heads/dirty');
  });

  it('optionally force-deletes the branch after removing its worktree', async () => {
    const fixture = await managementRepository();
    const target = await addWorktree(fixture, 'temporary', 'temporary');
    await writeFile(path.join(target, 'untracked.txt'), 'discard me\n');
    const oid = await git(target, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, target, oid, true, true))
      .toMatchObject({ status: 'removed', branch: 'temporary' });
    expect(await exists(target)).toBe(false);
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads/temporary'])).toBe('');
  });

  it('refuses a locked worktree', async () => {
    const fixture = await managementRepository();
    const locked = await addWorktree(fixture, 'locked', 'locked');
    await git(fixture.work, ['worktree', 'lock', '--reason', 'in use elsewhere', locked]);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, locked, await git(locked, ['rev-parse', 'HEAD'])))
      .toEqual({ status: 'locked', reason: 'in use elsewhere' });
    expect(await exists(locked)).toBe(true);
  });

  it('refuses a prunable worktree whose directory disappeared', async () => {
    const fixture = await managementRepository();
    const vanished = await addWorktree(fixture, 'vanished', 'vanished');
    const oid = await git(vanished, ['rev-parse', 'HEAD']);
    await rm(vanished, { recursive: true, force: true });
    const result = await fixture.operations.removeWorktree(fixture.repositoryId, vanished, oid);
    expect(result.status).toBe('prunable');
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toContain('refs/heads/vanished');
  });

  it('refuses a stale expected OID and an unknown path without removing anything', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const staleOid = await git(review, ['rev-parse', 'HEAD']);
    await writeFile(path.join(review, 'file.txt'), 'moved\n');
    await git(review, ['commit', '-qam', 'Move the worktree HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, staleOid)).toEqual({ status: 'stale' });
    expect(await exists(review)).toBe(true);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, path.join(fixture.root, 'nowhere'), staleOid)).toEqual({ status: 'missing' });
  });

  it('keeps the recent entries untouched when removal is refused', async () => {
    const fixture = await managementRepository();
    const locked = await addWorktree(fixture, 'locked', 'locked');
    await fixture.repositories.openPath(locked);
    await fixture.repositories.openPath(fixture.work);
    await git(fixture.work, ['worktree', 'lock', locked]);
    await fixture.operations.removeWorktree(fixture.repositoryId, locked, await git(locked, ['rev-parse', 'HEAD']));
    expect(fixture.settings.recentRepositories).toHaveLength(2);
  });
});

describe('GitRepositoryOperations worktree details', () => {
  it('counts local changes and reports the last commit of the selected worktree only', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    await writeFile(path.join(review, 'file.txt'), 'changed\n');
    await writeFile(path.join(review, 'extra.txt'), 'new\n');
    await git(review, ['add', 'extra.txt']);

    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, review);
    expect(details).toMatchObject({
      branch: 'review', main: false, current: false, available: true, detached: false,
      stagedCount: 1, unstagedCount: 1, untrackedCount: 0, conflictCount: 0, operation: null, readOnly: false,
    });
    expect(details.lastCommit).toMatchObject({ subject: 'Base commit', author: 'OpenTig Test' });
    expect(details.lastCommit?.oid).toBe(await git(review, ['rev-parse', 'HEAD']));
  });

  it('does not run Git inside a worktree whose directory disappeared', async () => {
    const fixture = await managementRepository();
    const vanished = await addWorktree(fixture, 'vanished', 'vanished');
    await rm(vanished, { recursive: true, force: true });
    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, vanished);
    expect(details).toMatchObject({ available: false, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 0, lastCommit: null });
    expect(details.prunable).toBeTruthy();
  });

  it('reports the main worktree as current while OpenTig has it open', async () => {
    const fixture = await managementRepository();
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, fixture.work))
      .toMatchObject({ main: true, current: true, branch: 'main', available: true });
  });
});
