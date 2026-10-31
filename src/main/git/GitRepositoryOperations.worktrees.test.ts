import { chmod, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitOperationError } from '../../shared/errors';
import type { GitOutput } from './GitProcess';
import { managementRepository, addWorktree, exists, realPath, git } from './test-support/repository-fixtures';

type Fixture = Awaited<ReturnType<typeof managementRepository>>;

/** The path as Git reports it, which on Windows differs from the one it was given: separators, and 8.3 aliases such as a temp folder's. */
async function reportedPath(fixture: Fixture, branch: string): Promise<string> {
  return (await fixture.operations.worktrees(fixture.repositoryId)).find((worktree) => worktree.branch === branch)!.path;
}

/** Wraps only the `git worktree remove` step, keeping every other command real. */
function aroundRemoval(fixture: Fixture, around: (remove: () => Promise<GitOutput>) => Promise<GitOutput>) {
  const original = fixture.gitProcess.run.bind(fixture.gitProcess);
  vi.spyOn(fixture.gitProcess, 'run').mockImplementation((cwd, args, options) => args.includes('remove') ? around(() => original(cwd, args, options)) : original(cwd, args, options));
}

describe('GitRepositoryOperations worktree removal outcome', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports the branch and forgets the worktree when only the branch could not be deleted', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    await fixture.repositories.openPath(review);
    await fixture.repositories.openPath(fixture.work);
    // A second worktree on the same branch makes Git refuse to delete it.
    await git(fixture.work, ['worktree', 'add', '--force', path.join(fixture.root, 'duplicate'), 'review']);
    const oid = await git(review, ['rev-parse', 'HEAD']);

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true);

    expect(result).toMatchObject({ status: 'partial', branch: 'review' });
    expect((result as { message: string }).message).toContain('could not delete the branch review');
    expect(await exists(review)).toBe(false);
    expect(fixture.settings.recentRepositories.some((recent) => recent.path === review)).toBe(false);
    expect((await fixture.operations.localRefsSnapshot(fixture.repositoryId)).worktreeRemovals).toMatchObject([{ path: review, state: 'partial' }]);
  }, process.platform === 'win32' ? 60_000 : 20_000);

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports files left behind when Git fails after dropping its record', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const stuck = path.join(review, 'stuck');
    await mkdir(stuck);
    await writeFile(path.join(stuck, 'in-use.txt'), 'kept\n');
    await chmod(stuck, 0o555);
    const oid = await git(review, ['rev-parse', 'HEAD']);
    try {
      const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true, true);
      expect(result).toMatchObject({ status: 'partial', branch: 'review' });
      expect((result as { message: string }).message).toContain(review);
      expect(await exists(path.join(stuck, 'in-use.txt'))).toBe(true);
      expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain(review);
      expect(await git(fixture.work, ['branch', '--list', 'review'])).toBe('');
    } finally {
      await chmod(stuck, 0o755);
    }
  });

  it('reports files left behind even when Git says it succeeded', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    const reported = await reportedPath(fixture, 'review');
    aroundRemoval(fixture, async (remove) => {
      const output = await remove();
      await mkdir(path.join(review, 'junction-left-behind'), { recursive: true });
      return output;
    });

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid);

    expect(result).toMatchObject({ status: 'partial', path: reported });
    expect(fixture.settings.recentRepositories.some((recent) => recent.path === review)).toBe(false);
  });

  it('still fails when Git refuses and keeps the worktree', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    aroundRemoval(fixture, async () => { throw new GitOperationError({ code: 'UNKNOWN', operation: 'remove-worktree', message: 'Refused.' }); });

    await expect(fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true)).rejects.toThrow('Refused.');

    expect(await exists(review)).toBe(true);
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toContain('review');
    // Nobody may be waiting for this result any more, so the server keeps it.
    expect((await fixture.operations.localRefsSnapshot(fixture.repositoryId)).worktreeRemovals)
      .toMatchObject([{ path: review, state: 'failed', message: expect.stringContaining('Refused.') }]);
  });

  it('keeps the worktree listed as incomplete when Git dies after deleting .git', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    const reported = await reportedPath(fixture, 'review');
    aroundRemoval(fixture, async () => {
      await rm(path.join(review, '.git'));
      throw new GitOperationError({ code: 'TIMEOUT', operation: 'remove-worktree', message: 'Git took too long.' });
    });

    await expect(fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true)).rejects.toThrow('Git took too long.');

    expect(await git(fixture.work, ['branch', '--list', 'review'])).toContain('review');
    const [, listed] = (await fixture.operations.localRefsSnapshot(fixture.repositoryId)).worktrees;
    expect(listed).toMatchObject({ path: reported, leftoverFiles: true });
    expect(listed!.prunable).toBeTruthy();
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ available: false, leftoverFiles: true });
  });

  it('only cleans up a worktree Git lost track of when asked to, and leaves its files', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    await fixture.repositories.openPath(review);
    await fixture.repositories.openPath(fixture.work);
    const oid = await git(review, ['rev-parse', 'HEAD']);
    const reported = await reportedPath(fixture, 'review');
    await rm(path.join(review, '.git'));

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid)).toMatchObject({ status: 'prunable' });
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).toContain('prunable');

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true)).toMatchObject({ status: 'prunable' });

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true, { cleanupOnly: true });

    expect(result).toMatchObject({ status: 'partial', branch: 'review' });
    expect((result as { message: string }).message).toContain(reported);
    expect(await exists(path.join(review, 'file.txt'))).toBe(true);
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain('prunable');
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toBe('');
    expect(fixture.settings.recentRepositories.some((recent) => recent.path === review)).toBe(false);
  });

  it('cleans up the entry of a worktree whose folder is gone', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    await rm(review, { recursive: true, force: true });

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, false, { cleanupOnly: true })).toMatchObject({ status: 'removed', branch: 'review' });

    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain('prunable');
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toContain('review');
  });

  it('cleans up only the chosen entry, leaving another worktree that is missing for now', async () => {
    const fixture = await managementRepository();
    const chosen = await addWorktree(fixture, 'chosen', 'chosen');
    const removable = await addWorktree(fixture, 'removable', 'removable');
    const oid = await git(chosen, ['rev-parse', 'HEAD']);
    const [reportedChosen, reportedRemovable] = [await reportedPath(fixture, 'chosen'), await reportedPath(fixture, 'removable')];
    await rm(chosen, { recursive: true, force: true });
    await rename(removable, `${removable}-unplugged`);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, chosen, oid, false, false, { cleanupOnly: true })).toMatchObject({ status: 'removed' });

    await rename(`${removable}-unplugged`, removable);
    const listed = await git(fixture.work, ['worktree', 'list', '--porcelain']);
    expect(listed).not.toContain(reportedChosen);
    expect(listed).toContain(reportedRemovable);
    expect(await git(removable, ['status', '--porcelain'])).toBe('');
  });

  it('counts untracked files once when describing what a removal would lose', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    await writeFile(path.join(review, 'file.txt'), 'changed\n');
    await writeFile(path.join(review, 'new.txt'), 'new\n');

    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ unstagedCount: 1, untrackedCount: 1 });
  });

  it('refuses a cleanup once Git can use the worktree again, keeping its files', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    await writeFile(path.join(review, 'uncommitted.txt'), 'keep me\n');
    const elsewhere = `${review}-elsewhere`;
    await rename(review, elsewhere);
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ available: false });
    // The details said it was missing, then a drive came back before the cleanup was confirmed.
    await rename(elsewhere, review);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, false, { cleanupOnly: true })).toEqual({ status: 'stale' });

    expect(await exists(path.join(review, 'uncommitted.txt'))).toBe(true);
  });

  it('lets other commands use the lock while Git is deleting', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    let finishDeleting!: () => void;
    const deleting = new Promise<void>((resolve) => { finishDeleting = resolve; });
    let deleteStarted!: () => void;
    const started = new Promise<void>((resolve) => { deleteStarted = resolve; });
    aroundRemoval(fixture, async (remove) => {
      deleteStarted();
      await deleting;
      return remove();
    });

    const removal = fixture.operations.removeWorktree(fixture.repositoryId, review, oid);
    await started;
    await expect(fixture.gitProcess.runWriteTask(fixture.work, async () => 'ran', fixture.repositories.get(fixture.repositoryId).commonDir)).resolves.toBe('ran');
    await expect(fixture.operations.selectWorktree(fixture.repositoryId, review)).rejects.toThrow('being removed');

    finishDeleting();
    expect(await removal).toMatchObject({ status: 'removed' });
  });

  it('joins a second request for a removal already running', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);

    const [first, second] = await Promise.all([
      fixture.operations.removeWorktree(fixture.repositoryId, review, oid),
      fixture.operations.removeWorktree(fixture.repositoryId, review, oid),
    ]);

    expect(first.status).toBe('removed');
    expect(second).toEqual(first);
  });

  it('shows a removal as running while it waits and until it ends', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const lock = fixture.gitProcess.runWriteTask(fixture.work, () => held, fixture.repositories.get(fixture.repositoryId).commonDir);

    const removal = fixture.operations.removeWorktree(fixture.repositoryId, review, oid);
    await vi.waitFor(async () => {
      expect((await fixture.operations.localRefsSnapshot(fixture.repositoryId)).worktreeRemovals).toEqual([{ path: review, state: 'running', message: null, finishedAt: null }]);
    });

    release();
    await lock;
    expect(await removal).toMatchObject({ status: 'removed' });
    expect((await fixture.operations.localRefsSnapshot(fixture.repositoryId)).worktreeRemovals).toBeUndefined();
  });

  it('does not start a removal whose request ended while it waited', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    const controller = new AbortController();
    controller.abort();

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true, { signal: controller.signal })).toEqual({ status: 'cancelled' });

    expect(await exists(review)).toBe(true);
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toContain('review');
  });

  it('finishes a removal that already started when its request ends', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    const controller = new AbortController();
    aroundRemoval(fixture, (remove) => {
      controller.abort();
      return remove();
    });

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true, { signal: controller.signal })).toMatchObject({ status: 'removed' });

    expect(await exists(review)).toBe(false);
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toBe('');
  });
});

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
