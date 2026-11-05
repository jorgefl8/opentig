import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteWorktreeFolder } from './worktreeDeletion';
import { addWorktree, exists, git, managementRepository } from './test-support/repository-fixtures';

const removeAll = (target: string) => rm(target, { recursive: true, force: true });
const busy = (target: string) => Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${target}'`), { code: 'EBUSY', path: target });

async function linkedWorktree() {
  const fixture = await managementRepository({ worktreeDeletion: 'git' });
  const review = await addWorktree(fixture, 'review', 'review');
  return { fixture, review, gitFile: await readFile(path.join(review, '.git'), 'utf8') };
}

describe('deleteWorktreeFolder', () => {
  it('deletes every file, then .git, then the folder', async () => {
    const { review } = await linkedWorktree();
    await mkdir(path.join(review, 'nested', 'deeper'), { recursive: true });
    await writeFile(path.join(review, 'nested', 'deeper', 'file.txt'), 'nested\n');
    const order: string[] = [];

    expect(await deleteWorktreeFolder(review, { remove: async (target) => { order.push(path.basename(target)); await removeAll(target); } })).toEqual({ deleted: true });

    expect(order.at(-1)).toBe('.git');
    expect(await exists(review)).toBe(false);
  });

  it('touches nothing that is not a linked worktree', async () => {
    const { fixture } = await linkedWorktree();
    const plain = path.join(fixture.root, 'plain');
    await mkdir(plain);
    await writeFile(path.join(plain, 'keep.txt'), 'keep\n');
    const remove = async () => { throw new Error('Nothing may be deleted.'); };

    expect(await deleteWorktreeFolder(fixture.work, { remove })).toEqual({ deleted: false, notLinked: true });
    expect(await deleteWorktreeFolder(plain, { remove })).toEqual({ deleted: false, notLinked: true });
    expect(await deleteWorktreeFolder(path.join(fixture.root, 'missing'), { remove })).toEqual({ deleted: false, notLinked: true });
    expect(await exists(path.join(fixture.work, 'file.txt'))).toBe(true);
    expect(await exists(path.join(plain, 'keep.txt'))).toBe(true);
  });

  it('does not follow a worktree folder that is itself a link', async () => {
    const { fixture, review } = await linkedWorktree();
    const alias = path.join(fixture.root, 'review-alias');
    await symlink(review, alias, process.platform === 'win32' ? 'junction' : 'dir');

    expect(await deleteWorktreeFolder(alias, { remove: async () => { throw new Error('Nothing may be deleted.'); } })).toEqual({ deleted: false, notLinked: true });
    expect(await exists(path.join(review, 'file.txt'))).toBe(true);
  });

  it('stops at the first entry it cannot delete and keeps .git', async () => {
    const { fixture, review, gitFile } = await linkedWorktree();
    await writeFile(path.join(review, 'a-held.txt'), 'held open\n');

    const result = await deleteWorktreeFolder(review, { remove: async (target) => {
      if (path.basename(target) === 'a-held.txt') throw busy(target);
      await removeAll(target);
    } });

    expect(result).toMatchObject({ deleted: false, blockedPath: path.join(review, 'a-held.txt'), removedSomething: false, gitFileIntact: true });
    expect(await readFile(path.join(review, '.git'), 'utf8')).toBe(gitFile);
    expect(await exists(path.join(review, 'file.txt'))).toBe(true);
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain('prunable');
  });

  it('names the file inside a folder that failed, and says files may be gone', async () => {
    const { review } = await linkedWorktree();
    const trace = path.join(review, '.next', 'trace');
    await mkdir(path.dirname(trace));
    await writeFile(trace, 'held open\n');

    const result = await deleteWorktreeFolder(review, { remove: async (target) => {
      if (path.basename(target) === '.next') throw busy(trace);
      await removeAll(target);
    } });

    expect(result).toMatchObject({ deleted: false, blockedPath: trace, removedSomething: true, gitFileIntact: true });
    expect(await exists(path.join(review, '.git'))).toBe(true);
  });

  it('falls back to the entry when the error has no path', async () => {
    const { review } = await linkedWorktree();

    const result = await deleteWorktreeFolder(review, { remove: async () => { throw new Error('Refused.'); } });

    expect(result).toMatchObject({ deleted: false, blockedPath: path.join(review, 'file.txt'), removedSomething: false, gitFileIntact: true });
  });

  it('puts .git back when the folder gains a file before it can be deleted', async () => {
    const { fixture, review, gitFile } = await linkedWorktree();

    const result = await deleteWorktreeFolder(review, { remove: async (target) => {
      if (path.basename(target) === '.git') await writeFile(path.join(review, 'late.log'), 'written meanwhile\n');
      await removeAll(target);
    } });

    expect(result).toMatchObject({ deleted: false, blockedPath: review, removedSomething: true, gitFileIntact: true });
    expect(await readFile(path.join(review, '.git'), 'utf8')).toBe(gitFile);
    expect(await git(review, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('review');
    expect(await git(fixture.work, ['worktree', 'list', '--porcelain'])).not.toContain('prunable');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports when .git cannot be put back', async () => {
    const { review } = await linkedWorktree();
    try {
      const result = await deleteWorktreeFolder(review, { remove: async (target) => {
        await removeAll(target);
        if (path.basename(target) === '.git') {
          await writeFile(path.join(review, 'late.log'), 'written meanwhile\n');
          await chmod(review, 0o555);
        }
      } });

      expect(result).toMatchObject({ deleted: false, gitFileIntact: false });
      expect(await exists(path.join(review, '.git'))).toBe(false);
    } finally {
      await chmod(review, 0o755);
    }
  });

  it('unlinks a link to an outside folder without deleting what it points to', async () => {
    const { fixture, review } = await linkedWorktree();
    const outside = path.join(fixture.root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'keep\n');
    await symlink(outside, path.join(review, 'link'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(await deleteWorktreeFolder(review)).toEqual({ deleted: true });

    expect(await exists(review)).toBe(false);
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep\n');
  });

  it('deletes read-only files', async () => {
    const { review } = await linkedWorktree();
    await mkdir(path.join(review, 'build'));
    await writeFile(path.join(review, 'build', 'locked.bin'), 'read only\n');
    await chmod(path.join(review, 'build', 'locked.bin'), 0o444);
    await chmod(path.join(review, 'file.txt'), 0o444);

    expect(await deleteWorktreeFolder(review)).toEqual({ deleted: true });

    expect(await exists(review)).toBe(false);
  });
});
