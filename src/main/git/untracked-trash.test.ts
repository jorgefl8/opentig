import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from './test-support/repository-fixtures';
import { GitProcess } from './GitProcess';
import { planUntrackedTrash, readUntrackedTrashLayout, removeEmptyParents } from './untracked-trash';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function write(root: string, file: string, content = 'x\n') {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}

async function tree(root: string, folder = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, folder), { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const relative = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const inner = await tree(root, relative);
      result.push(...(inner.length ? inner : [`${relative}/`]));
    } else result.push(relative);
  }
  return result.sort();
}

describe('planUntrackedTrash', () => {
  const layout = { untrackedRoots: ['build/', 'src/new.ts', 'cache/'], ignored: ['cache/.env', 'node_modules/'] };
  const untracked = ['build/a.js', 'build/deep/b.js', 'src/new.ts', 'cache/x/one.js', 'cache/two.js'];

  it('trashes a fully selected untracked folder as one item', () => {
    const plan = planUntrackedTrash({ selected: ['build/a.js', 'build/deep/b.js'], untracked, layout });
    expect(plan.targets).toEqual(['build']);
    expect([...plan.directories]).toEqual(['build']);
  });

  it('keeps folders with unselected, tracked or ignored content and trashes the largest safe parts', () => {
    expect(planUntrackedTrash({ selected: ['build/deep/b.js'], untracked, layout }).targets).toEqual(['build/deep']);
    expect(planUntrackedTrash({ selected: ['src/new.ts'], untracked, layout }).targets).toEqual(['src/new.ts']);
    expect(planUntrackedTrash({ selected: ['cache/x/one.js', 'cache/two.js'], untracked, layout }).targets).toEqual(['cache/two.js', 'cache/x']);
  });
});

describe('discarding untracked folders', () => {
  it('trashes whole folders, leaves ignored files and removes the folders it emptied', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-untracked-'));
    directories.push(root);
    await git(root, ['init', '-q']);
    await write(root, '.gitignore', '.env\n*.tsbuildinfo\n');
    await write(root, 'src/kept.ts');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'user.name=Sample', '-c', 'user.email=sample@example.com', 'commit', '-qm', 'init']);
    for (const file of ['out/a.js', 'out/deep/b.js', '.next/server/chunks/c.js', '.next/server/d.js', '.next/static/e.css', '.next/standalone/node_modules/f.js', 'src/new.ts']) await write(root, file);
    await write(root, '.next/standalone/.env', 'SECRET=1\n');
    await write(root, '.next/cache/.tsbuildinfo');

    const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
    const plan = planUntrackedTrash({ selected: untracked, untracked, layout: await readUntrackedTrashLayout(new GitProcess(), root) });
    expect(plan.targets).toEqual(['out', '.next/server', '.next/static', 'src/new.ts', '.next/standalone/node_modules']);

    for (const target of plan.targets) await rm(path.join(root, target), { recursive: true });
    await removeEmptyParents(root, plan.targets);
    expect(await tree(root)).toEqual(['.gitignore', '.next/cache/.tsbuildinfo', '.next/standalone/.env', 'src/kept.ts']);
  });

  it('removes the empty folders left above files trashed one by one', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-untracked-'));
    directories.push(root);
    await write(root, 'a/b/c/one.txt');
    await write(root, 'a/keep.txt');
    await rm(path.join(root, 'a/b/c/one.txt'));
    await removeEmptyParents(root, ['a/b/c/one.txt']);
    expect(await tree(root)).toEqual(['a/keep.txt']);
  });
});
