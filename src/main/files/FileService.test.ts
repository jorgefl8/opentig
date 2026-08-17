import { execFile } from 'node:child_process';
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileTreeEntry } from '../../shared/git-types';
import { GitProcess } from '../git/GitProcess';
import { RepositoryService } from '../git/RepositoryService';
import { SettingsStore } from '../persistence/SettingsStore';
import { FileService } from './FileService';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

describe('FileService', () => {
  it('includes physical root and nested empty directories but excludes Git metadata', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'empty-root'));
    await mkdir(path.join(fixture.work, 'nested', 'empty-leaf'), { recursive: true });

    const tree = await fixture.files.list(fixture.repositoryId);

    expect(findTreeEntry(tree, 'empty-root')).toMatchObject({ type: 'directory', children: [] });
    expect(findTreeEntry(tree, 'nested')).toMatchObject({ type: 'directory' });
    expect(findTreeEntry(tree, 'nested/empty-leaf')).toMatchObject({ type: 'directory', children: [] });
    expect(findTreeEntry(tree, '.git')).toBeNull();
  });

  it('returns only physical files with metadata and marks ignored dotenv files', async () => {
    const fixture = await createFixture();
    await unlink(path.join(fixture.work, 'tracked.txt'));
    await mkdir(path.join(fixture.work, 'folder'));
    await writeFile(path.join(fixture.work, 'folder', 'nested.txt'), 'nested\n');
    await writeFile(path.join(fixture.work, 'untracked.txt'), 'untracked\n');
    await writeFile(path.join(fixture.work, '.env.test'), 'SECRET=test\n');

    const tree = await fixture.files.list(fixture.repositoryId);
    const entries = flatten(tree);

    expect(entries.has('tracked.txt')).toBe(false);
    expect(entries.get('untracked.txt')).toMatchObject({ type: 'file', size: 10 });
    expect(entries.get('untracked.txt')?.mtimeMs).toBeGreaterThan(0);
    expect(entries.get('folder/nested.txt')).toMatchObject({ type: 'file', size: 7 });
    expect(entries.get('.env.test')).toMatchObject({ type: 'file', ignored: true });
    expect(tree[0]).toMatchObject({ type: 'directory', path: 'folder' });
  });

  it('includes git-ignored files and collapses fully-ignored directories', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, '.gitignore'), '.venv/\n.planning/*\nempty-cache/\n');
    await mkdir(path.join(fixture.work, '.venv', 'lib'), { recursive: true });
    await writeFile(path.join(fixture.work, '.venv', 'lib', 'pkg.py'), 'x\n');
    await mkdir(path.join(fixture.work, '.planning'));
    await mkdir(path.join(fixture.work, 'empty-cache'));
    // A tracked sibling keeps .planning visible; its untracked `a` stays ignored.
    await writeFile(path.join(fixture.work, '.planning', 'PROJECT.md'), '# p\n');
    await git(fixture.work, ['add', '.gitignore']);
    await git(fixture.work, ['add', '-f', '.planning/PROJECT.md']);
    await git(fixture.work, ['commit', '-m', 'planning']);
    await writeFile(path.join(fixture.work, '.planning', 'a'), '');

    const tree = await fixture.files.list(fixture.repositoryId);
    const venv = tree.find((entry) => entry.path === '.venv');
    const planning = tree.find((entry) => entry.path === '.planning');
    const emptyCache = tree.find((entry) => entry.path === 'empty-cache');
    const ignoredFile = planning?.type === 'directory' ? planning.children.find((entry) => entry.path === '.planning/a') : undefined;

    // A fully-ignored directory is a single collapsed, ignored node (no 3000-file fan-out).
    expect(venv).toMatchObject({ type: 'directory', ignored: true, children: [] });
    // A stray ignored file inside a tracked folder shows individually, marked ignored.
    expect(planning).toMatchObject({ type: 'directory' });
    expect(planning).not.toHaveProperty('ignored');
    expect(ignoredFile).toMatchObject({ type: 'file', ignored: true });
    expect(emptyCache).toMatchObject({ type: 'directory', ignored: true, children: [] });
  });

  it('reads one level of a collapsed ignored directory on demand', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, '.gitignore'), '.venv/\n');
    await mkdir(path.join(fixture.work, '.venv', 'lib'), { recursive: true });
    await writeFile(path.join(fixture.work, '.venv', 'pyvenv.cfg'), 'home = /usr\n');
    await writeFile(path.join(fixture.work, '.venv', 'lib', 'pkg.py'), 'x\n');

    const level = await fixture.files.listDirectory(fixture.repositoryId, '.venv');

    // Directories come first and stay collapsed so each level is paid for once.
    expect(level).toMatchObject([
      { path: '.venv/lib', type: 'directory', ignored: true, children: [] },
      { path: '.venv/pyvenv.cfg', type: 'file', ignored: true, size: 12 },
    ]);
    expect(await fixture.files.listDirectory(fixture.repositoryId, '.venv/lib')).toMatchObject([
      { path: '.venv/lib/pkg.py', type: 'file', ignored: true },
    ]);
  });

  it('returns an empty level for missing directories and rejects paths outside the worktree', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'folder'));

    expect(await fixture.files.listDirectory(fixture.repositoryId, 'gone')).toEqual([]);
    expect(await fixture.files.listDirectory(fixture.repositoryId, 'tracked.txt')).toEqual([]);
    // A non-ignored folder is already in the tree, so its level carries no ignored flag.
    expect(await fixture.files.listDirectory(fixture.repositoryId, 'folder')).toEqual([]);
    await expect(fixture.files.listDirectory(fixture.repositoryId, '../outside')).rejects.toThrow('outside the worktree');
  });

  it('includes mtime metadata in normal and size-limited reads', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, 'small.txt'), 'small\n');
    await writeFile(path.join(fixture.work, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 65));

    const small = await fixture.files.read(fixture.repositoryId, 'small.txt');
    const large = await fixture.files.read(fixture.repositoryId, 'large.txt');

    expect(small).toMatchObject({ content: 'small\n', tooLarge: false, size: 6 });
    expect(small.mtimeMs).toBeGreaterThan(0);
    expect(large).toMatchObject({ content: '', tooLarge: true, size: 1024 * 1024 + 1 });
    expect(large.mtimeMs).toBeGreaterThan(0);
  });

  it('atomically saves text files and rejects a stale draft', async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.work, 'notes.txt');
    await writeFile(target, '# Original\n');

    const saved = await fixture.files.write(fixture.repositoryId, 'notes.txt', '# Saved\n', '# Original\n');
    expect(saved).toMatchObject({ status: 'saved', path: 'notes.txt', size: 8 });
    expect(await readFile(target, 'utf8')).toBe('# Saved\n');

    await writeFile(target, '# External\n');
    const conflict = await fixture.files.write(fixture.repositoryId, 'notes.txt', '# Draft\n', '# Saved\n');
    expect(conflict).toEqual({ status: 'conflict' });
    expect(await readFile(target, 'utf8')).toBe('# External\n');
  });

  it('returns exact image bytes and current metadata', async () => {
    const fixture = await createFixture();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const target = path.join(fixture.work, 'image.png');
    await writeFile(target, bytes);

    const result = await fixture.files.readImage(fixture.repositoryId, 'image.png');

    expect(result).toMatchObject({
      status: 'ready',
      path: 'image.png',
      mimeType: 'image/png',
      size: bytes.length,
    });
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(result.status === 'ready' ? [...result.data] : []).toEqual([...bytes]);
  });

  it.each([
    ['photo.jpg', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
    ['animation.gif', [...Buffer.from('GIF89a')], 'image/gif'],
    ['graphic.webp', [...Buffer.from('RIFF'), 12, 0, 0, 0, ...Buffer.from('WEBP')], 'image/webp'],
    ['photo.avif', [0, 0, 0, 24, ...Buffer.from('ftypavif'), 0, 0, 0, 0, ...Buffer.from('mif1')], 'image/avif'],
    ['bitmap.bmp', [...Buffer.from('BM'), 0, 0], 'image/bmp'],
    ['icon.ico', [0, 0, 1, 0, 1, 0], 'image/x-icon'],
    ['pointer.cur', [0, 0, 2, 0, 1, 0], 'image/x-icon'],
    ['animation.apng', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/apng'],
  ])('recognizes %s by signature', async (name, bytes, mimeType) => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, name), Buffer.from(bytes as number[]));

    const result = await fixture.files.readImage(fixture.repositoryId, name);

    expect(result).toMatchObject({ status: 'ready', mimeType });
  });

  it('rejects a misleading extension and reflects external replacements', async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.work, 'changed.png');
    await writeFile(target, '<html>not an image</html>');
    await expect(fixture.files.readImage(fixture.repositoryId, 'changed.png')).resolves.toMatchObject({ status: 'unsupported' });

    const replacement = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 10, 20]);
    await writeFile(target, replacement);
    const refreshed = await fixture.files.readImage(fixture.repositoryId, 'changed.png');
    expect(refreshed).toMatchObject({ status: 'ready', mimeType: 'image/jpeg', size: replacement.length });
    expect(refreshed.status === 'ready' ? [...refreshed.data] : []).toEqual([...replacement]);
  });

  it('returns metadata but no bytes when an image exceeds 32 MiB', async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.work, 'large.png');
    await writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await truncate(target, 32 * 1024 * 1024 + 1);

    const result = await fixture.files.readImage(fixture.repositoryId, 'large.png');

    expect(result).toMatchObject({
      status: 'too-large',
      mimeType: 'image/png',
      size: 32 * 1024 * 1024 + 1,
      limit: 32 * 1024 * 1024,
    });
    expect('data' in result).toBe(false);
  });

  it('keeps missing-file failures distinct from unsupported formats', async () => {
    const fixture = await createFixture();
    await expect(fixture.files.readImage(fixture.repositoryId, 'missing.png')).rejects.toThrow();
  });

  it('rejects image symlinks that leave the worktree', async () => {
    const fixture = await createFixture();
    const external = path.join(path.dirname(fixture.work), 'external.png');
    const linked = path.join(fixture.work, 'linked.png');
    await writeFile(external, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    try {
      await symlink(external, linked, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    await expect(fixture.files.readImage(fixture.repositoryId, 'linked.png')).rejects.toThrow('outside the worktree');
  });

  it('pastes external files and folders with collision-safe names', async () => {
    const fixture = await createFixture();
    const destination = path.join(fixture.work, 'assets');
    const externalFile = path.join(fixture.root, 'logo.txt');
    const externalFolder = path.join(fixture.root, 'icons');
    await mkdir(destination);
    await mkdir(externalFolder);
    await writeFile(externalFile, 'logo\n');
    await writeFile(path.join(externalFolder, 'nested.txt'), 'nested\n');

    const first = await fixture.files.pastePaths(fixture.repositoryId, [externalFile, externalFolder], 'assets');
    const second = await fixture.files.pastePaths(fixture.repositoryId, [externalFile], 'assets');

    expect(first).toEqual(['assets/logo.txt', 'assets/icons']);
    expect(second).toEqual(['assets/logo copy.txt']);
    expect(await readFile(path.join(destination, 'logo.txt'), 'utf8')).toBe('logo\n');
    expect(await readFile(path.join(destination, 'logo copy.txt'), 'utf8')).toBe('logo\n');
    expect(await readFile(path.join(destination, 'icons', 'nested.txt'), 'utf8')).toBe('nested\n');
  });

  it('pastes clipboard image bytes as a uniquely named PNG', async () => {
    const fixture = await createFixture();
    const destination = path.join(fixture.work, 'images');
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await mkdir(destination);
    await writeFile(path.join(destination, 'pasted-image.png'), 'existing');

    const created = await fixture.files.pasteImage(fixture.repositoryId, 'images', png);

    expect(created).toBe('images/pasted-image copy.png');
    expect([...await readFile(path.join(destination, 'pasted-image copy.png'))]).toEqual([...png]);
  });

  it('moves entries between folders and reports destination conflicts', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'source'));
    await mkdir(path.join(fixture.work, 'destination'));
    await writeFile(path.join(fixture.work, 'source', 'move.txt'), 'move\n');

    const moved = await fixture.files.move(fixture.repositoryId, 'source/move.txt', 'destination');
    expect(moved).toEqual({ status: 'moved', from: 'source/move.txt', to: 'destination/move.txt' });
    expect(await readFile(path.join(fixture.work, 'destination', 'move.txt'), 'utf8')).toBe('move\n');

    await writeFile(path.join(fixture.work, 'source', 'move.txt'), 'second\n');
    await expect(fixture.files.move(fixture.repositoryId, 'source/move.txt', 'destination')).resolves.toEqual({
      status: 'conflict',
      path: 'destination/move.txt',
    });
  });

  it('moves cut clipboard paths and removes the originals', async () => {
    const fixture = await createFixture();
    const source = path.join(fixture.work, 'cut-me.txt');
    await mkdir(path.join(fixture.work, 'destination'));
    await writeFile(source, 'cut\n');

    const created = await fixture.files.movePaths(fixture.repositoryId, [source], 'destination');

    expect(created).toEqual(['destination/cut-me.txt']);
    expect(await readFile(path.join(fixture.work, 'destination', 'cut-me.txt'), 'utf8')).toBe('cut\n');
    await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite an existing destination when pasting a cut item', async () => {
    const fixture = await createFixture();
    const source = path.join(fixture.work, 'cut-me.txt');
    await mkdir(path.join(fixture.work, 'destination'));
    await writeFile(source, 'source\n');
    await writeFile(path.join(fixture.work, 'destination', 'cut-me.txt'), 'existing\n');

    await expect(fixture.files.movePaths(fixture.repositoryId, [source], 'destination')).rejects.toThrow('already exists');
    expect(await readFile(source, 'utf8')).toBe('source\n');
    expect(await readFile(path.join(fixture.work, 'destination', 'cut-me.txt'), 'utf8')).toBe('existing\n');
  });

  it('moves a batch atomically and returns source/destination pairs', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'source')); await mkdir(path.join(fixture.work, 'destination'));
    await writeFile(path.join(fixture.work, 'source', 'a.txt'), 'a'); await writeFile(path.join(fixture.work, 'source', 'b.txt'), 'b');
    await expect(fixture.files.moveEntries(fixture.repositoryId, ['source/a.txt', 'source/b.txt'], 'destination')).resolves.toEqual({
      moved: [{ from: 'source/a.txt', to: 'destination/a.txt' }, { from: 'source/b.txt', to: 'destination/b.txt' }], conflicts: [],
    });
  });

  it('collapses parent-child selections and preflights all move conflicts', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'parent')); await writeFile(path.join(fixture.work, 'parent', 'child.txt'), 'child'); await mkdir(path.join(fixture.work, 'target'));
    expect((await fixture.files.moveEntries(fixture.repositoryId, ['parent', 'parent/child.txt'], 'target')).moved).toEqual([{ from: 'parent', to: 'target/parent' }]);
    await mkdir(path.join(fixture.work, 'other')); await writeFile(path.join(fixture.work, 'other', 'a.txt'), 'a'); await writeFile(path.join(fixture.work, 'other', 'b.txt'), 'b');
    await writeFile(path.join(fixture.work, 'target', 'b.txt'), 'occupied');
    expect(await fixture.files.moveEntries(fixture.repositoryId, ['other/a.txt', 'other/b.txt'], 'target')).toEqual({ moved: [], conflicts: ['target/b.txt'] });
    expect(await readFile(path.join(fixture.work, 'other', 'a.txt'), 'utf8')).toBe('a');
  });

  it('snapshots and exclusively restores binary files', async () => {
    const fixture = await createFixture();
    const bytes = Buffer.from([0, 255, 4, 8]);
    await writeFile(path.join(fixture.work, 'binary.bin'), bytes); await chmod(path.join(fixture.work, 'binary.bin'), 0o640);
    const snapshot = await fixture.files.snapshot(fixture.repositoryId, 'binary.bin', 100);
    expect(snapshot?.bytes).toEqual(bytes);
    await rm(path.join(fixture.work, 'binary.bin')); await fixture.files.restoreSnapshots(fixture.repositoryId, [snapshot!]);
    expect(await readFile(path.join(fixture.work, 'binary.bin'))).toEqual(bytes);
    if (process.platform !== 'win32') expect((await lstat(path.join(fixture.work, 'binary.bin'))).mode & 0o777).toBe(0o640);
    await expect(fixture.files.restoreSnapshots(fixture.repositoryId, [snapshot!])).rejects.toThrow('already exists');
  });

  it('rejects non-regular and oversized snapshots', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'folder')); await writeFile(path.join(fixture.work, 'large.bin'), '12345');
    expect(await fixture.files.snapshot(fixture.repositoryId, 'folder', 100)).toBeNull();
    expect(await fixture.files.snapshot(fixture.repositoryId, 'large.bin', 4)).toBeNull();
  });

  it('rejects copying or moving a folder into itself', async () => {
    const fixture = await createFixture();
    const folder = path.join(fixture.work, 'folder');
    const nested = path.join(folder, 'nested');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(folder, 'file.txt'), 'content\n');

    await expect(fixture.files.pastePaths(fixture.repositoryId, [folder], 'folder/nested')).rejects.toThrow('into itself');
    await expect(fixture.files.move(fixture.repositoryId, 'folder', 'folder/nested')).rejects.toThrow('into itself');
  });

  it('renames an entry within its folder and reports conflicts', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, 'old.txt'), 'content\n');

    const renamed = await fixture.files.rename(fixture.repositoryId, 'old.txt', 'new.txt');
    expect(renamed).toEqual({ status: 'renamed', from: 'old.txt', to: 'new.txt' });
    expect(await readFile(path.join(fixture.work, 'new.txt'), 'utf8')).toBe('content\n');
    await expect(readFile(path.join(fixture.work, 'old.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(path.join(fixture.work, 'taken.txt'), 'taken\n');
    await expect(fixture.files.rename(fixture.repositoryId, 'new.txt', 'taken.txt')).resolves.toEqual({
      status: 'conflict',
      path: 'taken.txt',
    });
    await expect(fixture.files.rename(fixture.repositoryId, 'new.txt', 'a/b.txt')).rejects.toThrow('name is invalid');
  });

  it('creates files and folders and reports conflicts', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'folder'));

    const file = await fixture.files.create(fixture.repositoryId, 'folder', 'created.txt', 'file');
    expect(file).toEqual({ status: 'created', path: 'folder/created.txt', kind: 'file' });
    expect(await readFile(path.join(fixture.work, 'folder', 'created.txt'), 'utf8')).toBe('');

    const directory = await fixture.files.create(fixture.repositoryId, '', 'nested', 'directory');
    expect(directory).toEqual({ status: 'created', path: 'nested', kind: 'directory' });
    expect(findTreeEntry(await fixture.files.list(fixture.repositoryId), 'nested')).toMatchObject({ type: 'directory', children: [] });

    await expect(fixture.files.create(fixture.repositoryId, 'folder', 'created.txt', 'file')).resolves.toEqual({
      status: 'conflict',
      path: 'folder/created.txt',
    });
    await expect(fixture.files.create(fixture.repositoryId, 'folder', 'bad/name.txt', 'file')).rejects.toThrow('name is invalid');
  });

  it('applies a snapshot batch atomically and leaves every file untouched when one changed', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, 'one.txt'), 'one\n');
    await writeFile(path.join(fixture.work, 'two.txt'), 'two\n');
    const before = [
      (await fixture.files.snapshot(fixture.repositoryId, 'one.txt', 1024))!,
      (await fixture.files.snapshot(fixture.repositoryId, 'two.txt', 1024))!,
    ];
    const after = before.map((item, index) => ({ ...item, bytes: Buffer.from(`replaced-${index}\n`, 'utf8') }));

    await fixture.files.replaceSnapshots(fixture.repositoryId, before, after);
    expect(await readFile(path.join(fixture.work, 'one.txt'), 'utf8')).toBe('replaced-0\n');
    expect(await readFile(path.join(fixture.work, 'two.txt'), 'utf8')).toBe('replaced-1\n');

    // A file that moved on disk since the snapshot aborts the whole batch.
    await writeFile(path.join(fixture.work, 'two.txt'), 'external\n');
    await expect(fixture.files.replaceSnapshots(fixture.repositoryId, after, before)).rejects.toThrow('changed before');
    expect(await readFile(path.join(fixture.work, 'one.txt'), 'utf8')).toBe('replaced-0\n');
    expect(await readFile(path.join(fixture.work, 'two.txt'), 'utf8')).toBe('external\n');
  });

  it('rejects a replacement batch whose sides do not line up', async () => {
    const fixture = await createFixture();
    const snapshot = (await fixture.files.snapshot(fixture.repositoryId, 'tracked.txt', 1024))!;
    const other = { ...snapshot, path: 'other.txt' };
    await expect(fixture.files.replaceSnapshots(fixture.repositoryId, [snapshot], [])).rejects.toThrow('batch is invalid');
    await expect(fixture.files.replaceSnapshots(fixture.repositoryId, [snapshot], [other])).rejects.toThrow('batch is invalid');
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'justgit-files-'));
  directories.push(root);
  const work = path.join(root, 'work');
  await git(root, ['init', '-b', 'main', work]);
  await git(work, ['config', 'user.name', 'JustGit Test']);
  await git(work, ['config', 'user.email', 'justgit@example.invalid']);
  await writeFile(path.join(work, '.gitignore'), '.env*\n');
  await writeFile(path.join(work, 'tracked.txt'), 'tracked\n');
  await git(work, ['add', '.']);
  await git(work, ['commit', '-m', 'Initial commit']);

  const settings = new SettingsStore(path.join(root, 'settings.json'));
  await settings.load();
  const process = new GitProcess();
  const repositories = new RepositoryService(process, settings);
  const files = new FileService(process, repositories);
  const repository = await repositories.openPath(work);
  return { root, work, files, repositoryId: repository.id };
}

function flatten(entries: FileTreeEntry[], result = new Map<string, Extract<FileTreeEntry, { type: 'file' }>>()) {
  for (const entry of entries) {
    if (entry.type === 'file') result.set(entry.path, entry);
    else flatten(entry.children, result);
  }
  return result;
}

function findTreeEntry(entries: FileTreeEntry[], targetPath: string): FileTreeEntry | null {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    if (entry.type === 'directory') {
      const nested = findTreeEntry(entry.children, targetPath);
      if (nested) return nested;
    }
  }
  return null;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}
