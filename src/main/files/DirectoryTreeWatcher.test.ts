import { watch, type FSWatcher } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '../../shared/contracts';
import { DirectoryTreeWatcher } from './DirectoryTreeWatcher';
import { RepositoryWatcher } from './RepositoryWatcher';

const roots: string[] = [];
const closers: Array<() => void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tree(...folders: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'opentig-watch-'));
  roots.push(root);
  for (const folder of folders) await mkdir(path.join(root, folder), { recursive: true });
  return root;
}

const run = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<void> {
  await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('DirectoryTreeWatcher', () => {
  it('watches the folders it is allowed to, follows a folder made later, and reports what is written in it', async () => {
    const root = await tree('src/lib', 'dist/assets');
    const changes: string[] = [];
    const watcher = new DirectoryTreeWatcher({ root, include: (relative) => !relative.startsWith('dist'), onChange: (relative) => changes.push(relative), onFailure: vi.fn() });
    closers.push(() => watcher.close());
    await watcher.add();
    expect(watcher.covers('src/lib')).toBe(true);
    expect(watcher.covers('dist')).toBe(false);
    expect(watcher.size).toBe(3);

    await writeFile(path.join(root, 'src/lib/a.txt'), 'a');
    await vi.waitFor(() => expect(changes).toContain('src/lib/a.txt'));
    await mkdir(path.join(root, 'src/new'));
    await vi.waitFor(() => expect(watcher.covers('src/new')).toBe(true));
    await writeFile(path.join(root, 'src/new/b.txt'), 'b');
    await vi.waitFor(() => expect(changes).toContain('src/new/b.txt'));
    await rm(path.join(root, 'src/new'), { recursive: true });
    await vi.waitFor(() => expect(watcher.covers('src/new')).toBe(false));
  });

  it('stops at the system’s limit on watches and says so once', async () => {
    const root = await tree('a', 'b', 'c');
    let allowed = 2;
    const onFailure = vi.fn();
    const watcher = new DirectoryTreeWatcher({
      root, include: () => true, onChange: vi.fn(), onFailure,
      watch: (directory, listener) => { if (allowed-- <= 0) throw errorWithCode('ENOSPC'); return watch(directory, listener); },
    });
    closers.push(() => watcher.close());
    await watcher.add();
    expect(watcher.size).toBe(2);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'limit', code: 'ENOSPC' }));
  });
});

describe('RepositoryWatcher', () => {
  const repository = (root: string) => ({ id: 'repository', path: root, commonDir: path.join(root, '.git'), name: 'sample', repositoryName: 'sample' }) as RepositoryInfo;

  it('on Linux leaves out ignored folders and Git bookkeeping, and reports a change once it is watching', async () => {
    const root = await tree('src', 'dist/chunks', 'node_modules/pkg', '.git/refs/heads', '.git/objects/ab', '.git/logs');
    const onChange = vi.fn();
    const onState = vi.fn();
    const watcher = new RepositoryWatcher(onChange, () => false, { platform: 'linux', onState, listIgnoredDirectories: async () => ['dist/'] });
    closers.push(() => watcher.stop());
    const started = performance.now();
    watcher.start(repository(root));
    // Nothing is walked before start returns. Setting up is not trouble, and nothing counts as covered yet.
    expect(performance.now() - started).toBeLessThan(50);
    expect(watcher.state('repository')).toBe('starting');
    expect(watcher.covers('repository', 'src/a.ts')).toBeNull();
    // Once in place it is always announced, with the id of this watch.
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('repository', 'watching', expect.any(String)));
    const watchId = onState.mock.lastCall![2] as string;
    expect(watcher.status('repository')).toEqual({ state: 'watching', watchId });
    expect(watcher.covers('repository', 'src/a.ts')).toBe(watchId);
    expect(watcher.covers('repository', 'dist/chunks/a.js')).toBeNull();
    expect(watcher.covers('repository', 'node_modules/pkg/index.js')).toBeNull();

    onChange.mockClear();
    await writeFile(path.join(root, '.git/refs/heads/main'), 'abc\n');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('repository', 'refs'));
    onChange.mockClear();
    await writeFile(path.join(root, 'src/a.ts'), 'a');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('repository', 'worktree'));
  });

  it('on Linux watches a folder again after a checkout empties and refills it', async () => {
    const root = await tree('dir');
    await git(root, 'init', '-q', '-b', 'main');
    await writeFile(path.join(root, 'dir/x.txt'), 'x');
    await git(root, 'add', '.');
    await git(root, 'commit', '-q', '-m', 'main');
    await git(root, 'switch', '-q', '-c', 'other');
    await git(root, 'rm', '-q', 'dir/x.txt');
    await mkdir(path.join(root, 'dir'), { recursive: true });
    await writeFile(path.join(root, 'dir/y.txt'), 'y');
    await git(root, 'add', '.');
    await git(root, 'commit', '-q', '-m', 'other');
    await git(root, 'switch', '-q', 'main');
    const onChange = vi.fn();
    const watcher = new RepositoryWatcher(onChange, () => false, { platform: 'linux' });
    closers.push(() => watcher.stop());
    watcher.start(repository(root));
    await vi.waitFor(() => expect(watcher.state('repository')).toBe('watching'));
    // Git removes the folder with its last file and makes it again for the other branch's.
    await git(root, 'switch', '-q', 'other');
    await new Promise((resolve) => setTimeout(resolve, 600));
    onChange.mockClear();
    await writeFile(path.join(root, 'dir/y.txt'), 'edited');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('repository', 'worktree'), { timeout: 3_000 });
  });

  it('tells the clients of a repository when its watch moves to another one, and gives each watch its own id', async () => {
    const first = await tree('src');
    const second = await tree('lib');
    const onState = vi.fn();
    const watcher = new RepositoryWatcher(vi.fn(), () => false, { platform: 'linux', onState });
    closers.push(() => watcher.stop());
    watcher.start(repository(first));
    await vi.waitFor(() => expect(watcher.state('repository')).toBe('watching'));
    const firstId = watcher.status('repository').watchId;
    watcher.start({ ...repository(second), id: 'other' });
    // The first repository's changes now go unreported, and its clients hear so at once.
    expect(onState).toHaveBeenCalledWith('repository', 'stopped', null);
    expect(watcher.covers('repository', 'src/a.ts')).toBeNull();
    await vi.waitFor(() => expect(onState).toHaveBeenLastCalledWith('other', 'watching', expect.any(String)));
    watcher.start(repository(first));
    await vi.waitFor(() => expect(watcher.state('repository')).toBe('watching'));
    // Watched again, but whatever happened meanwhile went unreported: it is a new watch.
    expect(watcher.status('repository').watchId).not.toBe(firstId);
  });

  it('reports a changed lock file of the worktree, and covers only what it would report', async () => {
    const root = await tree('src', 'node_modules/pkg', '.git/refs');
    await writeFile(path.join(root, 'yarn.lock'), 'one');
    const onChange = vi.fn();
    const watcher = new RepositoryWatcher(onChange, () => false, { platform: 'linux' });
    closers.push(() => watcher.stop());
    watcher.start(repository(root));
    await vi.waitFor(() => expect(watcher.state('repository')).toBe('watching'));
    expect(watcher.covers('repository', 'yarn.lock')).not.toBeNull();
    expect(watcher.covers('repository', '.git/HEAD')).toBeNull();
    expect(watcher.covers('repository', 'node_modules/pkg/index.js')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
    onChange.mockClear();
    await writeFile(path.join(root, 'yarn.lock'), 'two');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('repository', 'worktree'));
  });

  it('on Linux follows the repository’s own excludes: a folder they stop ignoring is watched', async () => {
    const root = await tree('src', 'generated');
    await git(root, 'init', '-q', '-b', 'main');
    await writeFile(path.join(root, '.git/info/exclude'), 'generated/\n');
    await writeFile(path.join(root, 'generated/a.txt'), 'a');
    const listIgnoredDirectories = async () => {
      const { stdout } = await run('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory'], { cwd: root });
      return stdout.split('\0').filter((entry) => entry.endsWith('/'));
    };
    const watcher = new RepositoryWatcher(vi.fn(), () => false, { platform: 'linux', listIgnoredDirectories });
    closers.push(() => watcher.stop());
    watcher.start(repository(root));
    await vi.waitFor(() => expect(watcher.state('repository')).toBe('watching'));
    expect(watcher.covers('repository', 'generated/a.txt')).toBeNull();
    await writeFile(path.join(root, '.git/info/exclude'), '');
    await vi.waitFor(() => expect(watcher.covers('repository', 'generated/a.txt')).not.toBeNull(), { timeout: 3_000 });
  });

  it('reports a watch cut short by the system’s limit as degraded, in the server log and to clients', async () => {
    const root = await tree('src', 'docs', 'test');
    let allowed = 2;
    const logger = vi.fn();
    const onState = vi.fn();
    const watcher = new RepositoryWatcher(vi.fn(), () => false, {
      platform: 'linux', logger, onState,
      watchDirectory: (directory, listener) => { if (allowed-- <= 0) throw errorWithCode('ENOSPC'); return watch(directory, listener); },
    });
    closers.push(() => watcher.stop());
    watcher.start(repository(root));
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('repository', 'degraded', null));
    expect(logger).toHaveBeenCalledWith('warn', expect.stringContaining('fs.inotify.max_user_watches'));
    expect(watcher.state('repository')).toBe('degraded');
    // Nothing is taken as reported while some folders are not watched.
    expect(watcher.covers('repository', 'README.md')).toBeNull();
  });

  it('starts a failed native watch again, and reports it stopped once restarting does not help', async () => {
    const root = await tree('src');
    const logger = vi.fn();
    const onState = vi.fn();
    const watcher = new RepositoryWatcher(vi.fn(), () => false, { platform: 'darwin', logger, onState, retryDelayMs: 0 });
    closers.push(() => watcher.stop());
    watcher.start(repository(root));
    const fail = () => (watcher as unknown as { watchers: FSWatcher[] }).watchers[0]?.emit('error', errorWithCode('EIO'));
    const ids = new Set([onState.mock.lastCall![2]]);
    for (let attempt = 0; attempt < 3; attempt++) {
      fail();
      // Changes go unreported until it is back, and then it is a new watch.
      expect(onState).toHaveBeenLastCalledWith('repository', 'degraded', null);
      await vi.waitFor(() => expect(onState).toHaveBeenLastCalledWith('repository', 'watching', expect.any(String)));
      ids.add(onState.mock.lastCall![2]);
    }
    expect(ids.size).toBe(4);
    fail();
    expect(onState).toHaveBeenLastCalledWith('repository', 'stopped', null);
    expect(logger).toHaveBeenLastCalledWith('error', expect.stringContaining('Stopped watching "'));
    expect(watcher.covers('repository', 'src/a.ts')).toBeNull();
    // Opening it again starts over, and tells clients it is watched again.
    watcher.start(repository(root));
    expect(onState).toHaveBeenLastCalledWith('repository', 'watching', expect.any(String));
  });
});
