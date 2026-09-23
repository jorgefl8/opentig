import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { browseServerDirectories } from './ServerDirectoryBrowser';

const fixtures: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'opentig-directory-browser-'));
  fixtures.push(path);
  return path;
}

describe('server directory browser', () => {
  it('lists only immediate directories in natural order, including hidden folders', async () => {
    const path = await fixture();
    await Promise.all(['project10', 'project2', '.hidden'].map((name) => mkdir(join(path, name))));
    await mkdir(join(path, 'project2', 'nested'));
    await writeFile(join(path, 'README.md'), 'not a directory');
    expect(await browseServerDirectories(path)).toEqual({
      path,
      parentPath: dirname(path),
      directories: ['.hidden', 'project2', 'project10'].map((name) => ({ name, path: join(path, name) })),
    });
  });

  it.skipIf(process.platform === 'win32')('follows directory symlinks and skips files and broken links', async () => {
    const path = await fixture();
    const target = await fixture();
    await mkdir(join(target, 'repository'));
    await writeFile(join(target, 'file'), 'file');
    await symlink(join(target, 'repository'), join(path, 'linked-repository'));
    await symlink(join(target, 'file'), join(path, 'linked-file'));
    await symlink(join(target, 'missing'), join(path, 'broken'));
    expect((await browseServerDirectories(path)).directories).toEqual([{ name: 'linked-repository', path: join(path, 'linked-repository') }]);
  });

  it('defaults to the server home and expands the home shortcut', async () => {
    expect((await browseServerDirectories()).path).toBe(homedir());
    expect((await browseServerDirectories('~')).path).toBe(homedir());
  });

  it('stops navigating up at the filesystem root', async () => {
    expect((await browseServerDirectories(parse(homedir()).root)).parentPath).toBeNull();
  });

  it('rejects relative, missing, and non-directory paths', async () => {
    const path = await fixture();
    await writeFile(join(path, 'file'), 'file');
    await expect(browseServerDirectories('relative/path')).rejects.toThrow('absolute folder path');
    await expect(browseServerDirectories(join(path, 'missing'))).rejects.toThrow();
    await expect(browseServerDirectories(join(path, 'file'))).rejects.toThrow();
  });
});
