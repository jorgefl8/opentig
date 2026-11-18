import { chmod, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitOperationError } from '../../shared/errors';
import type { GitOutput } from './GitProcess';
import { managementRepository, standaloneRepository, addWorktree, exists, realPath, git } from './test-support/repository-fixtures';

type Fixture = Awaited<ReturnType<typeof managementRepository>>;

/** The path as Git reports it, which on Windows differs from the one it was given: separators, and 8.3 aliases such as a temp folder's. */
async function reportedPath(fixture: Fixture, branch: string): Promise<string> {
  return (await fixture.operations.worktrees(fixture.repositoryId)).find((worktree) => worktree.branch === branch)!.path;
}

/** Wraps only the `git worktree remove` step, keeping every other command real. Needs `worktreeDeletion: 'git'`. */
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
    const fixture = await managementRepository({ worktreeDeletion: 'git' });
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

  it('lets the caller stop what uses the folder before anything is deleted, and never removes the worktree the caller has open', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);

    // The request names the main worktree, but the client that sent it is in review.
    const own = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, false, { currentPath: () => review });
    expect(own).toEqual({ status: 'current' });
    expect(await exists(review)).toBe(true);

    const present: boolean[] = [];
    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, false, {
      beforeDelete: async () => { present.push(await exists(review)); },
    });
    expect(result).toMatchObject({ status: 'removed' });
    expect(present).toEqual([true]);
    expect(await exists(review)).toBe(false);
  }, process.platform === 'win32' ? 60_000 : 20_000);

  it('reports files left behind even when Git says it succeeded', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'git' });
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
    const fixture = await managementRepository({ worktreeDeletion: 'git' });
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
    const fixture = await managementRepository({ worktreeDeletion: 'git' });
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
    const fixture = await managementRepository({ worktreeDeletion: 'git' });
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
    const fixture = await managementRepository({ worktreeDeletion: 'git' });
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

  it('refuses to remove a locked worktree, but opens it', async () => {
    const fixture = await managementRepository();
    const locked = await addWorktree(fixture, 'locked', 'locked');
    // How Claude Code marks the worktrees of its sessions.
    await git(fixture.work, ['worktree', 'lock', '--reason', 'claude session locked (pid 3692)', locked]);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, locked, await git(locked, ['rev-parse', 'HEAD'])))
      .toEqual({ status: 'locked', reason: 'claude session locked (pid 3692)' });
    expect(await exists(locked)).toBe(true);
    const opened = await fixture.operations.selectWorktree(fixture.repositoryId, locked);
    expect(opened.path).toBe(await realpath(locked));
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

describe('GitRepositoryOperations worktree removal that deletes the folder first', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /** Deletes like the default, but fails on `.next` the way a file another program holds open does on Windows. */
  function blockingNext(blockedFile: () => string) {
    const state = { blocked: true };
    const remove = async (target: string) => {
      if (state.blocked && path.basename(target) === '.next') {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${blockedFile()}'`), { code: 'EBUSY', path: blockedFile() });
      }
      await rm(target, { recursive: true, force: true });
    };
    return { state, remove };
  }

  it('removes a clean worktree without Git deleting it, and deletes its branch when asked', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'node' });
    const review = await addWorktree(fixture, 'review', 'review');
    const reported = await reportedPath(fixture, 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    const run = vi.spyOn(fixture.gitProcess, 'run');

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true)).toMatchObject({ status: 'removed', branch: 'review' });

    expect(run.mock.calls.some(([, args]) => args.includes('worktree') && args.includes('remove'))).toBe(false);
    expect(await exists(review)).toBe(false);
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain(reported);
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toBe('');
    expect((await fixture.operations.localRefsSnapshot(fixture.repositoryId)).worktreeRemovals).toBeUndefined();
  });

  it('keeps the worktree registered when a file is in use, then removes it with force', async () => {
    let review = '';
    const trace = () => path.join(review, '.next', 'trace');
    const blocking = blockingNext(trace);
    const fixture = await managementRepository({ worktreeDeletion: 'node', removeWorktreeEntry: blocking.remove });
    review = await addWorktree(fixture, 'review', 'review');
    await writeFile(path.join(fixture.work, '.git', 'info', 'exclude'), '.next/\n');
    await mkdir(path.join(review, '.next'));
    await writeFile(trace(), 'held open\n');
    const reported = await reportedPath(fixture, 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);

    const failure = fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true);

    await expect(failure).rejects.toThrow(trace());
    await expect(failure).rejects.toThrow('in use by another program');
    expect(await exists(path.join(review, '.git'))).toBe(true);
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).toContain(reported);
    expect(await git(review, ['status', '--porcelain'])).toBe('');
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toContain('review');
    const snapshot = await fixture.operations.localRefsSnapshot(fixture.repositoryId);
    expect(snapshot.worktreeRemovals).toMatchObject([{ path: review, state: 'failed', message: expect.stringContaining(trace()) }]);
    expect(snapshot.worktrees.find((worktree) => worktree.branch === 'review')).toMatchObject({ prunable: null });
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ available: true });

    blocking.state.blocked = false;
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true, true)).toMatchObject({ status: 'removed', branch: 'review' });
    expect(await exists(review)).toBe(false);
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain(reported);
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toBe('');
  });

  it('says removing again needs force once some files were deleted', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'node', removeWorktreeEntry: async (target) => {
      if (path.basename(target) === 'z-held.txt') throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY', path: target });
      await rm(target, { recursive: true, force: true });
    } });
    const review = await addWorktree(fixture, 'review', 'review');
    await writeFile(path.join(fixture.work, '.git', 'info', 'exclude'), 'z-held.txt\n');
    await writeFile(path.join(review, 'z-held.txt'), 'held open\n');
    const oid = await git(review, ['rev-parse', 'HEAD']);

    await expect(fixture.operations.removeWorktree(fixture.repositoryId, review, oid)).rejects.toThrow('need Force');

    // The tracked file went first, so the worktree now reports it as deleted.
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ available: true, unstagedCount: 1 });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid)).toMatchObject({ status: 'dirty', unstagedCount: 1 });
  });

  it('puts .git back when the folder cannot be deleted at the end', async () => {
    let review = '';
    const fixture = await managementRepository({ worktreeDeletion: 'node', removeWorktreeEntry: async (target) => {
      // Another program writes a file just as the folder empties.
      if (path.basename(target) === '.git') await writeFile(path.join(review, 'late.log'), 'written meanwhile\n');
      await rm(target, { recursive: true, force: true });
    } });
    review = await addWorktree(fixture, 'review', 'review');
    const reported = await reportedPath(fixture, 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);

    await expect(fixture.operations.removeWorktree(fixture.repositoryId, review, oid)).rejects.toThrow('The worktree was kept');

    expect(await exists(path.join(review, '.git'))).toBe(true);
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).toContain(reported);
    expect(await git(review, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('review');
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ available: true, prunable: null });
  });

  it('deletes a link to a folder outside the worktree without touching that folder', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'node' });
    const review = await addWorktree(fixture, 'review', 'review');
    const outside = path.join(fixture.root, 'shared-cache');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'outside the worktree\n');
    await symlink(outside, path.join(review, 'linked-cache'), process.platform === 'win32' ? 'junction' : 'dir');
    const oid = await git(review, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true)).toMatchObject({ status: 'removed' });

    expect(await exists(review)).toBe(false);
    expect(await exists(path.join(outside, 'keep.txt'))).toBe(true);
  });

  it('removes a read-only file', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'node' });
    const review = await addWorktree(fixture, 'review', 'review');
    await chmod(path.join(review, 'file.txt'), 0o444);
    const oid = await git(review, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid)).toMatchObject({ status: 'removed' });

    expect(await exists(review)).toBe(false);
  });

  it.each(['node', 'git'] as const)('refuses a worktree with submodules unless forced (%s)', async (worktreeDeletion) => {
    const fixture = await managementRepository({ worktreeDeletion });
    const library = path.join(fixture.root, 'library');
    await git(fixture.root, ['init', '-q', '-b', 'main', library]);
    await git(library, ['-c', 'user.name=OpenTig Test', '-c', 'user.email=opentig@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'Library']);
    const review = await addWorktree(fixture, 'review', 'review');
    await git(review, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', library, 'library']);
    await git(review, ['commit', '-qm', 'Add the library']);
    const oid = await git(review, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ submodules: true, stagedCount: 0, unstagedCount: 0, untrackedCount: 0 });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid)).toEqual({ status: 'submodules' });
    expect(await exists(path.join(review, 'library', '.git'))).toBe(true);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true)).toMatchObject({ status: 'removed' });
    expect(await exists(review)).toBe(false);
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain('trees');
    expect(await exists(path.join(library, '.git'))).toBe(true);
  }, process.platform === 'win32' ? 60_000 : 20_000);

  // Windows creates links to files only with extra privileges.
  it.skipIf(process.platform === 'win32')('falls back to Git when the folder is not a linked worktree with a .git file', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'node', removeWorktreeEntry: async () => { throw new Error('Node deletion must not run.'); } });
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    // Its `.git` is a link to a file now, which is neither linked nor provably broken, so only Git may decide what to delete.
    const moved = path.join(fixture.root, 'moved-git-file');
    await rename(path.join(review, '.git'), moved);
    await symlink(moved, path.join(review, '.git'));
    const run = vi.spyOn(fixture.gitProcess, 'run');

    await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true).catch(() => undefined);

    expect(run.mock.calls.some(([, args]) => args.includes('worktree') && args.includes('remove'))).toBe(true);
  });

  it('never deletes the main worktree', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'node', removeWorktreeEntry: async () => { throw new Error('Node deletion must not run.'); } });
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, fixture.work, oid, true)).toEqual({ status: 'main' });
    expect(await exists(path.join(fixture.work, 'file.txt'))).toBe(true);
  });
});

/** Points a worktree's `.git` file somewhere else. Git for Windows hides `.git`, and Windows refuses to overwrite a hidden file, so it is replaced. */
async function pointGitFile(worktree: string, target: string): Promise<void> {
  await rm(path.join(worktree, '.git'));
  await writeFile(path.join(worktree, '.git'), `gitdir: ${target}\n`);
}

/** Deletes everything in a worktree's folder but its `.git` file, as a cleanup of temporary files can. */
async function emptyFolder(worktree: string): Promise<void> {
  for (const entry of await readdir(worktree)) if (entry !== '.git') await rm(path.join(worktree, entry), { recursive: true, force: true });
}

const slow = process.platform === 'win32' ? 60_000 : 20_000;

describe('GitRepositoryOperations worktree with a broken link', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports a worktree whose .git file points nowhere as broken, not as a conflict, and runs no Git inside it', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    await writeFile(path.join(review, 'file.txt'), 'changed\n');
    const gone = path.join(fixture.root, 'gone', '.git', 'worktrees', 'review');
    await pointGitFile(review, gone);
    const run = vi.spyOn(fixture.gitProcess, 'run');

    const [main, listed] = (await fixture.operations.localRefsSnapshot(fixture.repositoryId)).worktrees;
    expect(main!.brokenLink).toBeUndefined();
    expect(listed).toMatchObject({ prunable: null, brokenLink: { kind: 'unlinked', pointsTo: gone, pointsToMissing: true } });

    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, review);
    // A client that doesn't know `brokenLink` still reads it as not clean, never as removable.
    expect(details).toMatchObject({ available: false, brokenLink: { kind: 'unlinked', pointsTo: gone, pointsToMissing: true }, conflictCount: 1, stagedCount: 0, unstagedCount: 0, untrackedCount: 0 });
    expect(details.lastCommit?.oid).toBe(oid);
    expect(details.submodules).toBeUndefined();
    expect(details.unreadable).toBeUndefined();
    expect(details.onlyGitFile).toBeUndefined();

    // Git refuses even a forced removal here, so it is not tried.
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true)).toEqual({ status: 'broken-link' });
    expect(await exists(path.join(review, 'file.txt'))).toBe(true);
    const repositoryPath = fixture.repositories.get(fixture.repositoryId).path;
    expect(run.mock.calls.filter(([cwd]) => cwd !== repositoryPath)).toEqual([]);
    expect(run.mock.calls.some(([, args]) => args.includes('remove'))).toBe(false);
  }, slow);

  it('recognizes a moved repository, repairs the link, and then reads the real changes', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const other = await addWorktree(fixture, 'other', 'other');
    await writeFile(path.join(review, 'file.txt'), 'changed\n');
    const moved = path.join(fixture.root, 'moved');
    await rename(fixture.work, moved);
    const { id } = await fixture.repositories.openPath(moved);

    const before = await fixture.operations.worktreeDetails(id, review);
    expect(before).toMatchObject({ available: false, stagedCount: 0, brokenLink: { pointsToMissing: true } });
    // Git writes forward slashes on Windows too.
    expect((before.brokenLink as { pointsTo: string }).pointsTo.replace(/\\/g, '/')).toMatch(/\/work\/\.git\/worktrees\/review$/);
    const otherGitFile = await readFile(path.join(other, '.git'), 'utf8');

    expect(await fixture.operations.repairWorktree(id, review)).toEqual({ status: 'repaired' });

    const after = await fixture.operations.worktreeDetails(id, review);
    expect(after).toMatchObject({ available: true, unstagedCount: 1, conflictCount: 0 });
    expect(after.brokenLink).toBeUndefined();
    // Only the worktree asked for: the sibling the same move broke is left as it was.
    expect(await readFile(path.join(other, '.git'), 'utf8')).toBe(otherGitFile);
    expect((await fixture.operations.worktreeDetails(id, other)).brokenLink).toMatchObject({ kind: 'unlinked', pointsToMissing: true });
    const oid = await git(review, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(id, review, oid)).toMatchObject({ status: 'dirty', unstagedCount: 1 });
    expect(await fixture.operations.removeWorktree(id, review, oid, true)).toMatchObject({ status: 'removed' });
    expect(await exists(review)).toBe(false);
  }, slow);

  it('cleans up only the broken entry, leaving its folder and a healthy worktree', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const healthy = await addWorktree(fixture, 'healthy', 'healthy');
    const [oid, healthyOid] = [await git(review, ['rev-parse', 'HEAD']), await git(healthy, ['rev-parse', 'HEAD'])];
    const [reported, reportedHealthy] = [await reportedPath(fixture, 'review'), await reportedPath(fixture, 'healthy')];
    await pointGitFile(review, path.join(fixture.root, 'gone', '.git', 'worktrees', 'review'));

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, healthy, healthyOid, false, false, { cleanupOnly: true })).toEqual({ status: 'stale' });
    // Asked to delete the branch too, which still has its checkout and work in the folder.
    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, true, { cleanupOnly: true });

    expect(result).toMatchObject({ status: 'partial', branch: 'review', message: expect.stringContaining(reported) });
    expect(await exists(path.join(review, 'file.txt'))).toBe(true);
    expect(await exists(path.join(review, '.git'))).toBe(true);
    const listed = await git(fixture.work, ['worktree', 'list', '--porcelain']);
    expect(listed).not.toContain(reported);
    expect(listed).toContain(reportedHealthy);
    expect(await git(healthy, ['status', '--porcelain'])).toBe('');
    expect(await git(fixture.work, ['branch', '--list', 'review'])).toContain('review');
  }, slow);

  it('keeps the entry when the link works again by the time it would be dropped', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    const gitFile = await readFile(path.join(review, '.git'), 'utf8');
    await pointGitFile(review, path.join(fixture.root, 'gone', '.git', 'worktrees', 'review'));

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, false, {
      cleanupOnly: true,
      // Repaired elsewhere after the cleanup was decided.
      beforeDelete: async () => {
        await rm(path.join(review, '.git'));
        await writeFile(path.join(review, '.git'), gitFile);
      },
    });

    expect(result).toEqual({ status: 'stale' });
    expect(await git(review, ['status', '--porcelain'])).toBe('');
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).toContain(await reportedPath(fixture, 'review'));
  }, slow);

  it('repairs and cleans up nothing for a healthy worktree or a path that is not this repository\'s', async () => {
    const fixture = await managementRepository();
    const healthy = await addWorktree(fixture, 'healthy', 'healthy');
    const stranger = await standaloneRepository();
    const foreign = path.join(path.dirname(stranger.work), 'foreign');
    await git(stranger.work, ['worktree', 'add', '-b', 'foreign', foreign]);
    const foreignOid = await git(foreign, ['rev-parse', 'HEAD']);
    const brokenPointer = path.join(fixture.root, 'gone', '.git', 'worktrees', 'foreign');
    await pointGitFile(foreign, brokenPointer);
    const healthyGitFile = await readFile(path.join(healthy, '.git'), 'utf8');

    expect(await fixture.operations.repairWorktree(fixture.repositoryId, healthy)).toEqual({ status: 'not-broken' });
    expect(await fixture.operations.repairWorktree(fixture.repositoryId, fixture.work)).toEqual({ status: 'not-broken' });
    expect(await fixture.operations.repairWorktree(fixture.repositoryId, foreign)).toEqual({ status: 'missing' });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, foreign, foreignOid, false, false, { cleanupOnly: true })).toEqual({ status: 'missing' });

    expect(await readFile(path.join(healthy, '.git'), 'utf8')).toBe(healthyGitFile);
    expect(await readFile(path.join(foreign, '.git'), 'utf8')).toContain(brokenPointer);
    expect(await git(stranger.work, ['worktree', 'list', '--porcelain'])).toContain('foreign');
  }, slow);

  it('repairs from this repository without following the .git file into the repository it names', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const stranger = await standaloneRepository();
    const theirs = path.join(path.dirname(stranger.work), 'theirs');
    await git(stranger.work, ['worktree', 'add', '-b', 'theirs', theirs]);
    const theirRecord = path.join(stranger.work, '.git', 'worktrees', 'theirs');
    const theirLink = await readFile(path.join(theirRecord, 'gitdir'), 'utf8');
    await pointGitFile(review, theirRecord);

    expect((await fixture.operations.worktreeDetails(fixture.repositoryId, review)).brokenLink).toEqual({ kind: 'unlinked', pointsTo: theirRecord, pointsToMissing: false });
    expect(await fixture.operations.repairWorktree(fixture.repositoryId, review)).toEqual({ status: 'repaired' });

    expect(await readFile(path.join(theirRecord, 'gitdir'), 'utf8')).toBe(theirLink);
    expect(await git(theirs, ['status', '--porcelain'])).toBe('');
    expect(await git(review, ['status', '--porcelain'])).toBe('');
  }, slow);

  it('tells when the folder holds nothing but its .git file and empty folders, without following links', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    await mkdir(path.join(review, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(review, 'src', 'nested', 'kept.txt'), 'work\n');
    await pointGitFile(review, path.join(fixture.root, 'gone', '.git', 'worktrees', 'review'));
    const onlyGitFile = async () => (await fixture.operations.worktreeDetails(fixture.repositoryId, review)).onlyGitFile ?? false;

    expect(await onlyGitFile()).toBe(false);
    await rm(path.join(review, 'file.txt'));
    // A file deep inside still counts.
    expect(await onlyGitFile()).toBe(false);
    await rm(path.join(review, 'src', 'nested', 'kept.txt'));
    expect(await onlyGitFile()).toBe(true);
    await emptyFolder(review);
    expect(await onlyGitFile()).toBe(true);

    // A junction or link is content even when what it leads to is empty, and is never walked into.
    const outside = path.join(fixture.root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(review, 'link'), 'junction');
    expect(await onlyGitFile()).toBe(false);
    expect(await exists(outside)).toBe(true);
  }, slow);

  it('leaves a folder another repository took over to that repository: no repair, directly or through a sibling, and only this entry cleaned up', async () => {
    const fixture = await managementRepository();
    const taken = await addWorktree(fixture, 'taken', 'taken');
    const sibling = await addWorktree(fixture, 'sibling', 'sibling');
    const oid = await git(taken, ['rev-parse', 'HEAD']);
    // Its folder was deleted by hand, so this repository kept its record, and another repository then put a worktree there.
    await rm(taken, { recursive: true, force: true });
    const stranger = await standaloneRepository();
    await git(stranger.work, ['worktree', 'add', '-b', 'theirs', taken]);
    const theirGitFile = await readFile(path.join(taken, '.git'), 'utf8');
    await pointGitFile(sibling, path.join(fixture.root, 'gone', '.git', 'worktrees', 'sibling'));

    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, taken);
    expect(details).toMatchObject({ available: false, brokenLink: { kind: 'taken', by: 'worktree' } });
    expect(await realPath((details.brokenLink as { owner: string }).owner)).toBe(await realPath(path.join(stranger.work, '.git')));

    expect(await fixture.operations.repairWorktree(fixture.repositoryId, taken)).toEqual({ status: 'taken' });
    expect(await fixture.operations.repairWorktree(fixture.repositoryId, sibling)).toEqual({ status: 'repaired' });
    expect(await readFile(path.join(taken, '.git'), 'utf8')).toBe(theirGitFile);
    expect(await git(taken, ['status', '--porcelain'])).toBe('');

    // Nothing is left for the user to delete: the folder is the other repository's worktree.
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, taken, oid, false, false, { cleanupOnly: true })).toMatchObject({ status: 'removed' });
    expect((await fixture.operations.worktrees(fixture.repositoryId)).some((worktree) => worktree.branch === 'taken')).toBe(false);
    expect(await readFile(path.join(taken, '.git'), 'utf8')).toBe(theirGitFile);
    expect(await git(taken, ['status', '--porcelain'])).toBe('');
    expect(await git(stranger.work, ['worktree', 'list', '--porcelain'])).toContain('branch refs/heads/theirs');
  }, slow);

  it('treats a folder whose .git is a repository of its own as taken, and never runs Git in it', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    await rm(review, { recursive: true, force: true });
    await git(fixture.root, ['init', '-q', '-b', 'main', review]);
    await writeFile(path.join(review, 'theirs.txt'), 'not this worktree\n');
    const run = vi.spyOn(fixture.gitProcess, 'run');
    const repositoryPath = fixture.repositories.get(fixture.repositoryId).path;

    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, review);
    expect(details).toMatchObject({ available: false, untrackedCount: 0, brokenLink: { kind: 'taken', by: 'repository', owner: path.join(review, '.git') } });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, true)).toEqual({ status: 'broken-link' });
    expect(await fixture.operations.repairWorktree(fixture.repositoryId, review)).toEqual({ status: 'taken' });
    expect(run.mock.calls.filter(([cwd]) => cwd !== repositoryPath)).toEqual([]);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid, false, false, { cleanupOnly: true })).toMatchObject({ status: 'removed' });
    expect(await exists(path.join(review, 'theirs.txt'))).toBe(true);
    expect(await git(review, ['status', '--porcelain'])).toBe('?? theirs.txt');
  }, slow);

  it('reads a .git file as Git does, so one without "gitdir: " at its start names nothing, and repairs it', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const gitFile = await readFile(path.join(review, '.git'), 'utf8');
    await rm(path.join(review, '.git'));
    await writeFile(path.join(review, '.git'), gitFile.replace('gitdir: ', 'gitdir:'));

    expect((await fixture.operations.worktreeDetails(fixture.repositoryId, review)).brokenLink).toEqual({ kind: 'unlinked', pointsTo: null, pointsToMissing: false });
    expect(await fixture.operations.repairWorktree(fixture.repositoryId, review)).toEqual({ status: 'repaired' });
    expect(await readFile(path.join(review, '.git'), 'utf8')).toMatch(/^gitdir: /);
    expect(await git(review, ['status', '--porcelain'])).toBe('');
  }, slow);

  // Windows creates symbolic links only with extra privileges.
  it.skipIf(process.platform === 'win32')('lists every worktree even when a .git file or a record leads into a place that cannot be examined', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const healthy = await addWorktree(fixture, 'healthy', 'healthy');
    const [loopA, loopB] = [path.join(fixture.root, 'loop-a'), path.join(fixture.root, 'loop-b')];
    await symlink(loopB, loopA);
    await symlink(loopA, loopB);
    await pointGitFile(review, path.join(loopA, 'worktrees', 'review'));
    // A record of this repository whose folder is behind the loop too.
    await mkdir(path.join(fixture.work, '.git', 'worktrees', 'odd'));
    await writeFile(path.join(fixture.work, '.git', 'worktrees', 'odd', 'gitdir'), `${path.join(loopA, 'odd', '.git')}\n`);

    // A .git file nobody may read, where the account running the tests is not allowed everything.
    const locked = process.getuid?.() === 0 ? null : await addWorktree(fixture, 'locked', 'locked');
    if (locked) await chmod(path.join(locked, '.git'), 0o000);

    const snapshot = await fixture.operations.localRefsSnapshot(fixture.repositoryId).finally(async () => { if (locked) await chmod(path.join(locked, '.git'), 0o644); });
    // review, healthy, locked, and the odd record, which Git lists as missing.
    expect(snapshot.worktrees.filter((worktree) => !worktree.main)).toHaveLength(locked ? 4 : 3);
    expect(snapshot.worktrees.every((worktree) => worktree.brokenLink === undefined)).toBe(true);
    // Not shown as broken without proof: read as before, as a worktree Git can't read.
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, review)).toMatchObject({ available: true, unreadable: expect.any(String) });
    expect((await fixture.operations.worktreeDetails(fixture.repositoryId, healthy)).brokenLink).toBeUndefined();
  }, slow);

  it('says no work would be lost only when the record loses nothing either, and names a HEAD on no branch', async () => {
    const fixture = await managementRepository();
    const [clean, staged, detached] = [await addWorktree(fixture, 'clean', 'clean'), await addWorktree(fixture, 'staged', 'staged'), await addWorktree(fixture, 'detached', 'detached')];
    await writeFile(path.join(staged, 'staged.txt'), 'staged\n');
    await git(staged, ['add', 'staged.txt']);
    await git(detached, ['switch', '-q', '--detach']);
    await writeFile(path.join(detached, 'only-here.txt'), 'only here\n');
    await git(detached, ['add', 'only-here.txt']);
    await git(detached, ['commit', '-q', '-m', 'Only on this HEAD']);
    for (const worktree of [clean, staged, detached]) {
      await pointGitFile(worktree, path.join(fixture.root, 'gone', '.git', 'worktrees', path.basename(worktree)));
      await emptyFolder(worktree);
    }
    const details = (worktree: string) => fixture.operations.worktreeDetails(fixture.repositoryId, worktree);

    expect(await details(clean)).toMatchObject({ onlyGitFile: true, nothingLost: true });
    expect((await details(clean)).unreachableHead).toBeUndefined();
    await writeFile(path.join(fixture.work, '.git', 'worktrees', 'clean', 'MERGE_HEAD'), `${await git(fixture.work, ['rev-parse', 'HEAD'])}\n`);
    expect((await details(clean)).nothingLost).toBeUndefined();

    expect(await details(staged)).toMatchObject({ onlyGitFile: true });
    expect((await details(staged)).nothingLost).toBeUndefined();

    const lost = await details(detached);
    expect(lost.nothingLost).toBeUndefined();
    expect(lost.unreachableHead).toMatchObject({ subject: 'Only on this HEAD', oid: lost.oid });
  }, slow);

  it('says Git could not read a worktree rather than inventing a conflict, and keeps it from a plain removal', async () => {
    const fixture = await managementRepository({ worktreeDeletion: 'git' });
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(review, ['rev-parse', 'HEAD']);
    await writeFile(path.join(fixture.work, '.git', 'worktrees', 'review', 'index'), 'not an index');

    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, review);
    // The conflict an older client relied on stays, beside the field a newer one reads first.
    expect(details).toMatchObject({ available: true, conflictCount: 1, stagedCount: 0, unreadable: expect.stringMatching(/index/i) });
    expect(details.brokenLink).toBeUndefined();
    expect(details.submodules).toBeUndefined();

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, oid)).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/index/i) });
    expect(await exists(path.join(review, 'file.txt'))).toBe(true);
  }, slow);
});
