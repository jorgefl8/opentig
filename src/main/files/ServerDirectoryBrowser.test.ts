import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { browseServerDirectories } from './ServerDirectoryBrowser';
import { GitProcess } from '../git/GitProcess';

const fixtures: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'opentig-directory-browser-'));
  fixtures.push(path);
  return path;
}

describe('server directory browser', () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports an inaccessible folder without exposing filesystem error details', async () => {
    const path = await fixture();
    await chmod(path, 0);
    try { await expect(browseServerDirectories(path)).rejects.toThrow('You do not have permission to browse this folder.'); }
    finally { await chmod(path, 0o700); }
  });
  it('lists only immediate directories in natural order, including hidden folders', async () => {
    const path = await fixture();
    await Promise.all(['project10', 'project2', '.hidden'].map((name) => mkdir(join(path, name))));
    await mkdir(join(path, 'project2', 'nested'));
    await writeFile(join(path, 'README.md'), 'not a directory');
    expect(await browseServerDirectories(path)).toMatchObject({
      path,
      parentPath: dirname(path),
      repository: null,
      directories: ['.hidden', 'project2', 'project10'].map((name) => ({ name, path: join(path, name), repository: null })),
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
    expect((await browseServerDirectories(path)).directories).toEqual([{ name: 'linked-repository', path: join(path, 'linked-repository'), repository: null }]);
  });

  it('defaults to the server home and expands the home shortcut', async () => {
    const listing = await browseServerDirectories();
    expect(listing.path).toBe(homedir());
    expect(listing.locations).toContainEqual({ name: 'Home', path: homedir(), kind: 'home' });
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

  it('recognizes real repositories, unborn branches and linked worktrees without changing Git data', async () => {
    const path = await fixture();
    const git = new GitProcess();
    const repository = join(path, 'repo with spaces');
    await mkdir(repository);
    const run = (cwd: string, args: string[]) => git.run(cwd, args, { operation: 'fixture' });
    await run(repository, ['init', '-b', 'main']);
    const unborn = await browseServerDirectories(path, git);
    expect(unborn.directories).toEqual([{ name: 'repo with spaces', path: repository, repository: { branch: 'main' } }]);
    await run(repository, ['-c', 'user.name=Sample', '-c', 'user.email=sample@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
    const worktree = join(path, 'linked worktree');
    await run(repository, ['worktree', 'add', '-b', 'feature/preview', worktree]);
    expect((await browseServerDirectories(worktree, git)).repository).toEqual({ branch: 'feature/preview' });
    expect((await browseServerDirectories(path, git)).directories).toContainEqual({ name: 'linked worktree', path: worktree, repository: { branch: 'feature/preview' } });
    await run(repository, ['checkout', '--detach']);
    expect((await browseServerDirectories(repository, git)).repository).toEqual({ branch: null });
    await mkdir(join(repository, 'src'));
    expect((await browseServerDirectories(join(repository, 'src'), git)).repository).toBeNull();
    expect((await run(repository, ['status', '--porcelain'])).stdout.toString()).toBe('');
  });

  it('does not mark invalid .git folders or bare repositories as openable worktrees', async () => {
    const path = await fixture();
    await mkdir(join(path, 'broken', '.git'), { recursive: true });
    const git = new GitProcess();
    await git.run(path, ['init', '--bare', 'bare.git'], { operation: 'fixture' });
    const listing = await browseServerDirectories(path, git);
    expect(listing.directories.every(folder => folder.repository === null)).toBe(true);
  });

  it('keeps folders browsable when Git inspection fails and returns readable path errors', async () => {
    const path = await fixture();
    await mkdir(join(path, 'broken', '.git'), { recursive: true });
    const failedGit = { run: async () => { throw new Error('private process output'); } } as unknown as GitProcess;
    expect((await browseServerDirectories(path, failedGit)).directories[0]?.repository).toBeNull();
    await expect(browseServerDirectories(join(path, 'missing'))).rejects.toThrow('That folder was not found. Check the path and try again.');
    await writeFile(join(path, 'file'), 'file');
    await expect(browseServerDirectories(join(path, 'file'))).rejects.toThrow('This path points to a file. Choose a folder instead.');
  });
});
