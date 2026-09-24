import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { latestCliRelease, ServiceUpdater, verifyTarball, type CliRelease } from './service-updater';
import { runUpdateTransaction } from './service-update-worker';
import { newerVersion, packageDirectory } from './service-installation';

const release: CliRelease = { version: '0.1.3', url: 'https://github.com/jorgefl8/opentig/releases/tag/v0.1.3', notes: 'Fixes by @someone', tarball: 'https://registry.npmjs.org/@opentig/cli/-/cli-0.1.3.tgz', integrity: `sha512-${'A'.repeat(86)}==` };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('managed service updates', () => {
  it('checks once and coalesces overlapping downloads and install clicks', async () => {
    let finish!: () => void;
    const stage = vi.fn((_release, progress) => { progress(45); return new Promise<void>((resolve) => { finish = resolve; }); });
    const install = vi.fn(async () => undefined);
    const updater = new ServiceUpdater('0.1.2', { release: async () => release, stage, install });
    expect((await updater.check()).phase).toBe('available');
    expect((await updater.download()).progress).toBe(45);
    await updater.download(); expect(stage).toHaveBeenCalledTimes(1);
    finish(); await Promise.resolve();
    expect((await updater.getStatus()).phase).toBe('ready');
    await Promise.all([updater.install(), updater.install()]);
    expect(install).toHaveBeenCalledTimes(1);
    expect((await updater.getStatus()).phase).toBe('installing');
    await updater.stop();
  });
  it('does not offer downgrades, prereleases or updates for unmanaged instances', async () => {
    const updater = new ServiceUpdater('0.1.4', { release: async () => release, stage: vi.fn(), install: vi.fn() });
    expect((await updater.check()).phase).toBe('idle');
    await updater.stop();
    const unavailable = new ServiceUpdater('0.1.2', null);
    expect((await unavailable.install()).phase).toBe('unavailable');
    expect(newerVersion('0.1.3-beta', '0.1.2')).toBe(false);
    expect(newerVersion('0.1.10', '0.1.9')).toBe(true);
    expect(() => packageDirectory('/tmp/test', { schema: 1, version: '../../escape', layout: 'npm', host: '127.0.0.1', port: 6767, node: '/usr/bin/node' })).toThrow();
  });
  it('reports preparation and worker launch failures without claiming installation', async () => {
    const updater = new ServiceUpdater('0.1.2', { release: async () => release, stage: async () => { throw new Error('network'); }, install: vi.fn() });
    await updater.check(); await updater.download(); await updater.stop();
    expect((await updater.getStatus()).phase).toBe('error');
    const worker = new ServiceUpdater('0.1.2', { release: async () => release, stage: async () => undefined, install: async () => { throw new Error('systemd'); } });
    await worker.check(); await worker.download(); await Promise.resolve();
    await worker.install(); await Promise.resolve();
    expect((await worker.getStatus()).phase).toBe('error');
    await worker.stop();
  });
  it('checks at startup and every five minutes independently of browser tabs', async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => null);
    const updater = new ServiceUpdater('0.1.2', { release: check, stage: vi.fn(), install: vi.fn() });
    updater.start(); await vi.advanceTimersByTimeAsync(10_000); expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000); expect(check).toHaveBeenCalledTimes(2);
    await updater.stop(); await vi.advanceTimersByTimeAsync(300_000); expect(check).toHaveBeenCalledTimes(2);
  });
  it('keeps rollback errors visible until explicitly retried', async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => release);
    const updater = new ServiceUpdater('0.1.2', { release: check, stage: vi.fn(), install: vi.fn() }, true);
    updater.start(); await vi.advanceTimersByTimeAsync(300_000);
    expect(check).not.toHaveBeenCalled(); expect((await updater.getStatus()).message).toContain('restored');
    expect((await updater.check()).phase).toBe('available'); await updater.stop();
  });
  it('waits for npm availability and rejects a substituted tarball URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('api.github.com')
      ? Response.json({ tag_name: 'v0.1.3', body: 'Notes' }) : new Response('', { status: 404 })));
    expect(await latestCliRelease()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('api.github.com')
      ? Response.json({ tag_name: 'v0.1.3', body: 'Notes' })
      : Response.json({ name: '@opentig/cli', version: '0.1.3', dist: { tarball: 'https://other.invalid/pkg.tgz', integrity: release.integrity } })));
    await expect(latestCliRelease()).rejects.toThrow('metadata');
  });
  it('verifies SHA-512 before installation', () => {
    const bytes = Buffer.from('package');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    expect(() => verifyTarball(bytes, integrity)).not.toThrow();
    expect(() => verifyTarball(Buffer.from('changed'), integrity)).toThrow('integrity');
  });
});
describe('external update worker', () => {
  it('keeps the new version only after readiness succeeds', async () => {
    const calls: string[] = [];
    expect(await runUpdateTransaction({ activate: async () => { calls.push('new'); }, restart: async () => { calls.push('restart'); }, healthy: async () => true, restore: async () => { calls.push('old'); } })).toBe(true);
    expect(calls).toEqual(['new', 'restart']);
  });
  it.each(['activation', 'restart', 'health'])('restores the previous installation after a %s failure', async (failure) => {
    const calls: string[] = [];
    let restarted = false;
    const success = await runUpdateTransaction({
      activate: async () => { calls.push('new'); if (failure === 'activation') throw new Error('write'); },
      restart: async () => { calls.push('restart'); if (!restarted) { restarted = true; if (failure === 'restart') throw new Error('start'); } },
      healthy: async () => false,
      restore: async () => { calls.push('old'); },
    });
    expect(success).toBe(false); expect(calls.slice(-2)).toEqual(['old', 'restart']);
  });
});
