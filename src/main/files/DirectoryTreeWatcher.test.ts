import { watch, type FSWatcher } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    // Nothing is walked before start returns.
    expect(performance.now() - started).toBeLessThan(50);
    expect(watcher.covers('repository', 'src/a.ts')).toBe(false);
    // Once in place, it says so with a change, in case one was missed meanwhile; becoming ready is no trouble to report.
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('repository', 'worktree'));
    expect(onState).not.toHaveBeenCalled();
    expect(watcher.state('repository')).toBe('watching');
    expect(watcher.covers('repository', 'src/a.ts')).toBe(true);
    expect(watcher.covers('repository', 'dist/chunks/a.js')).toBe(false);
    expect(watcher.covers('repository', 'node_modules/pkg/index.js')).toBe(false);

    onChange.mockClear();
    await writeFile(path.join(root, '.git/refs/heads/main'), 'abc\n');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('repository', 'refs'));
    onChange.mockClear();
    await writeFile(path.join(root, 'src/a.ts'), 'a');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('repository', 'worktree'));
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
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('repository', 'degraded'));
    expect(logger).toHaveBeenCalledWith('warn', expect.stringContaining('fs.inotify.max_user_watches'));
    expect(watcher.state('repository')).toBe('degraded');
    // Nothing is taken as reported while some folders are not watched.
    expect(watcher.covers('repository', 'README.md')).toBe(false);
  });

  it('starts a failed native watch again, and reports it stopped once restarting does not help', async () => {
    const root = await tree('src');
    const logger = vi.fn();
    const onState = vi.fn();
    const watcher = new RepositoryWatcher(vi.fn(), () => false, { platform: 'darwin', logger, onState, retryDelayMs: 0 });
    closers.push(() => watcher.stop());
    watcher.start(repository(root));
    const fail = () => (watcher as unknown as { watchers: FSWatcher[] }).watchers[0]?.emit('error', errorWithCode('EIO'));
    for (let attempt = 0; attempt < 3; attempt++) {
      fail();
      await vi.waitFor(() => expect((watcher as unknown as { watchers: FSWatcher[] }).watchers.length).toBe(1));
    }
    expect(onState).not.toHaveBeenCalled();
    fail();
    expect(onState).toHaveBeenCalledExactlyOnceWith('repository', 'stopped');
    expect(logger).toHaveBeenLastCalledWith('error', expect.stringContaining('Stopped watching "'));
    expect(watcher.covers('repository', 'src/a.ts')).toBe(false);
    // Opening it again starts over, and tells clients it is watched again.
    watcher.start(repository(root));
    expect(onState).toHaveBeenLastCalledWith('repository', 'watching');
  });
});
