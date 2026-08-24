import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearRuntimeState, loadOrCreateAdminToken, prepareCliHome, readRuntimeState, resolveCliPaths, writeRuntimeState } from './cli-home';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('OpenTig CLI home', () => {
  it('creates private paths, credential, and credential-free atomic runtime state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'opentig-cli-home-'));
    directories.push(directory);
    const paths = resolveCliPaths(path.join(directory, 'home'));
    await prepareCliHome(paths);
    const token = await loadOrCreateAdminToken(paths.adminToken);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await loadOrCreateAdminToken(paths.adminToken)).toBe(token);

    const state = {
      pid: 123, host: '127.0.0.1', port: 6767, protocolVersion: 1,
      appVersion: '0.1.0', instanceId: 'a'.repeat(32), startedAt: new Date().toISOString(),
    };
    await writeRuntimeState(paths.runtimeState, state);
    expect(await readRuntimeState(paths.runtimeState)).toEqual({ version: 1, ...state });
    expect(await readFile(paths.runtimeState, 'utf8')).not.toContain(token);
    if (process.platform !== 'win32') {
      expect((await stat(paths.home)).mode & 0o777).toBe(0o700);
      expect((await stat(paths.runtimeState)).mode & 0o777).toBe(0o600);
    }

    await clearRuntimeState(paths.runtimeState, 'b'.repeat(32));
    await expect(readRuntimeState(paths.runtimeState)).resolves.toMatchObject({ instanceId: 'a'.repeat(32) });
    await clearRuntimeState(paths.runtimeState, 'a'.repeat(32));
    await expect(readRuntimeState(paths.runtimeState)).rejects.toThrow('No running');
  });

  it('rejects corrupt runtime state and credentials', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'opentig-cli-corrupt-'));
    directories.push(directory);
    const paths = resolveCliPaths(directory);
    await prepareCliHome(paths);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(paths.runtimeState, '{}'));
    await expect(readRuntimeState(paths.runtimeState)).rejects.toThrow('invalid');
  });
});
