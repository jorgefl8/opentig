import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readWorktreeRecords, worktreeLink, writeGitFile, type WorktreeLinkContext } from './worktreeLink';
import { addWorktree, managementRepository } from './test-support/repository-fixtures';

const folders: string[] = [];
afterEach(() => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

async function where(target: string): Promise<string> {
  return realpath(target).catch(() => path.resolve(target));
}

function context(commonDir: string): WorktreeLinkContext {
  return {
    commonDir,
    samePath: async (left, right) => (await where(left)).toLowerCase() === (await where(right)).toLowerCase(),
    linkedByPath: async () => false,
  };
}

describe('worktreeLink', () => {
  it('trusts a record only when it names this .git by path as well as by file identity', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    await rm(path.join(review, '.git'));
    await writeFile(path.join(review, '.git'), `gitdir: ${path.join(fixture.root, 'gone', '.git', 'worktrees', 'review')}\n`);
    // Another folder whose .git is the very same file, as a file system whose identifiers repeat would make it look.
    const other = path.join(fixture.root, 'other');
    await mkdir(other);
    await link(path.join(review, '.git'), path.join(other, '.git'));
    const commonDir = path.join(fixture.work, '.git');
    const records = await readWorktreeRecords(commonDir);

    expect(await worktreeLink(review, records, context(commonDir))).toMatchObject({ state: 'broken' });
    // Same identity, but the record names review's path: no claim, so its record can never be cleaned up from here.
    expect(await worktreeLink(other, records, context(commonDir))).toEqual({ state: 'none' });
  }, process.platform === 'win32' ? 60_000 : 20_000);

  // Windows steps back from a link by name, so a relative path is written by name there.
  it.skipIf(process.platform === 'win32')('writes a relative .git file from the folder\'s real location, so it leads to the record', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opentig-git-file-')));
    folders.push(root);
    const real = path.join(root, 'trees', 'deeper', 'review');
    const record = path.join(root, 'repository', '.git', 'worktrees', 'review');
    await mkdir(real, { recursive: true });
    await mkdir(record, { recursive: true });
    const linked = path.join(root, 'review');
    await symlink(real, linked, 'dir');
    await writeFile(path.join(real, '.git'), 'gitdir: nowhere\n');

    await writeGitFile(linked, { dir: record, gitFile: path.join(linked, '.git'), relative: true, identity: null });

    const pointer = (await readFile(path.join(real, '.git'), 'utf8')).replace(/^gitdir: /, '').trim();
    expect(path.isAbsolute(pointer)).toBe(false);
    expect(path.resolve(real, pointer)).toBe(record);
  });
});
