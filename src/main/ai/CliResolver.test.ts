import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliEnvironment, type CliHost } from './CliEnvironment';
import { CliResolver, executableExtensions, knownCliDirectories } from './CliResolver';

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-discovery-')); roots.push(home);
  const host: CliHost = { platform: process.platform, home, env: { PATH: path.join(home, 'bin') } };
  const read = vi.fn(async () => ({}));
  const resolver = new CliResolver(new CliEnvironment(host, read));
  const executable = async (directory = 'bin', name = 'opencode') => {
    const dir = path.join(home, directory); await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
    await writeFile(file, '', { mode: 0o755 }); return file;
  };
  return { home, host, resolver, read, executable };
}

describe('CliResolver', () => {
  it('refreshes automatically on the first check, caches the result and refreshes on Check again', async () => {
    const f = await fixture();
    const inherited = await f.executable();
    const refreshed = await f.executable('custom');
    f.read.mockResolvedValue({ PATH: path.dirname(refreshed) });
    expect(await f.resolver.resolveAll('opencode')).toEqual([inherited, refreshed]);
    expect(f.read).toHaveBeenCalledTimes(1);
    await f.resolver.resolveAll('opencode');
    expect(f.read).toHaveBeenCalledTimes(1);
    await f.resolver.resolveAll('opencode', true);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.host.env.PATH).toBe(path.dirname(inherited));
  });

  it('discovers a post-start installation in the user location on Check again', async () => {
    const f = await fixture();
    expect(await f.resolver.resolve('opencode')).toBeNull();
    const file = await f.executable('.opencode/bin');
    expect(await f.resolver.resolve('opencode')).toBeNull();
    const candidates = await f.resolver.resolveAll('opencode', true);
    expect(candidates).toEqual([file]); candidates.length = 0;
    expect(await f.resolver.resolve('opencode')).toBe(file);
  });
  it('expires negative results after 30 seconds', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['Date'] });
    expect(await f.resolver.resolve('opencode')).toBeNull();
    const file = await f.executable(); vi.advanceTimersByTime(30_001);
    expect(await f.resolver.resolve('opencode')).toBe(file);
  });
  it('enumerates every directory in order and both aliases', async () => {
    const f = await fixture();
    const first = await f.executable(), alias = await f.executable('bin', 'opencode2'), second = await f.executable('second');
    f.host.env.PATH += path.delimiter + path.dirname(second);
    expect(await f.resolver.resolveAll('opencode')).toEqual([first, alias, second]);
  });
  it('rejects directories, non-executable files and relative PATH entries', async () => {
    const f = await fixture(); const file = await f.executable();
    await rm(file); await mkdir(file);
    expect(await f.resolver.resolve('opencode')).toBeNull();
    await rm(file, { recursive: true }); await writeFile(file, '');
    if (process.platform !== 'win32') {
      await chmod(file, 0o644); expect(await f.resolver.resolve('opencode', true)).toBeNull();
    }
    f.host.env.PATH = '.::bin'; expect(await f.resolver.resolve('opencode', true)).toBeNull();
  });
  it('revalidates cached launchers after removal', async () => {
    const f = await fixture(); const file = await f.executable();
    expect(await f.resolver.resolve('opencode')).toBe(file); await rm(file);
    expect(await f.resolver.resolve('opencode')).toBeNull();
  });
  it.skipIf(process.platform === 'win32')('deduplicates symlinks but preserves the stable launcher path', async () => {
    const f = await fixture(); const file = await f.executable();
    await symlink(file, path.join(f.home, 'bin', 'opencode2'));
    expect(await f.resolver.resolveAll('opencode')).toEqual([file]);
  });
  it('ignores a legacy disabled refresh, preserves configured paths and invalidates when paths change', async () => {
    const f = await fixture(); const file = await f.executable();
    const preferences = { aiExecutablePaths: { opencode: path.join(f.home, 'missing') }, aiShellEnvironment: false };
    const resolver = new CliResolver(new CliEnvironment(f.host, f.read), () => preferences);
    expect(await resolver.discover('opencode')).toMatchObject([{ source: 'configured', problem: 'not-found' }]);
    preferences.aiExecutablePaths.opencode = '';
    expect(await resolver.resolve('opencode')).toBe(file);
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it('prioritizes refreshed PATH before known locations and shares the environment query', async () => {
    const f = await fixture(); const custom = await f.executable('custom'); const known = await f.executable('.opencode/bin');
    const read = vi.fn(async () => ({ PATH: path.dirname(custom) }));
    const resolver = new CliResolver(new CliEnvironment(f.host, read));
    const [result] = await Promise.all([resolver.resolveAll('opencode', true), resolver.resolveAll('grok', true)]);
    expect(result).toEqual([custom, known]); expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(['linux', 'darwin', 'win32'] as const)('derives known directories from relocated homes on %s', (platform) => {
    const p = platform === 'win32' ? path.win32 : path.posix;
    for (const home of platform === 'win32' ? ['D:\\Accounts\\Alpha', 'E:\\People\\Beta'] : ['/accounts/alpha', '/data/users/beta']) {
      expect(knownCliDirectories('opencode', home, platform, {})).toContain(p.join(home, '.opencode', 'bin'));
      expect(knownCliDirectories('grok', home, platform, {})).toContain(p.join(home, '.grok', 'bin'));
    }
    if (platform === 'win32') expect(knownCliDirectories('codex', 'D:\\Home', platform, { LOCALAPPDATA: 'E:\\Local', APPDATA: 'E:\\Roaming' })).toEqual(expect.arrayContaining(['E:\\Local\\Programs\\OpenAI\\Codex\\bin', 'E:\\Roaming\\npm']));
  });
  it('limits Windows extensions to supported formats in PATHEXT order', () => {
    expect(executableExtensions('win32', { PATHEXT: '.CMD;.PS1;.EXE;.JS;.COM;.BAT;.CMD' })).toEqual(['.cmd', '.exe', '.com', '.bat']);
  });
});
