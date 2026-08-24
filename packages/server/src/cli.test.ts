import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publicOrigin, runCli, startOnConfiguredPort } from './cli';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('OpenTig CLI runtime helpers', () => {
  it('prints usable loopback URLs for wildcard listeners', () => {
    expect(publicOrigin('0.0.0.0', 6767)).toBe('http://127.0.0.1:6767');
    expect(publicOrigin('::', 6767)).toBe('http://[::1]:6767');
    expect(publicOrigin('192.168.1.5', 7000)).toBe('http://192.168.1.5:7000');
  });

  it('fails clearly instead of changing the configured port after a conflict', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('Test listener did not expose a port.');
    const directory = await mkdtemp(path.join(tmpdir(), 'opentig-cli-port-'));
    directories.push(directory);
    const clientRoot = path.join(directory, 'client');
    await mkdir(clientRoot);
    await writeFile(path.join(clientRoot, 'index.html'), '<!doctype html>');
    const base = {
      appVersion: 'test', auth: { consumeDesktopSecret: () => false },
      settingsPath: path.join(directory, 'settings.json'), aiLogPath: path.join(directory, 'ai-log.jsonl'),
      serverDataPath: path.join(directory, 'server'), clientRoot, platform: 'win32' as const,
      host: '127.0.0.1', trash: { available: true, trashItem: async () => undefined },
    };
    await expect(startOnConfiguredPort(base, address.port)).rejects.toThrow(`Port ${address.port}`);
    await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
  });

  it('refuses pair when no runtime state exists', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'opentig-cli-pair-'));
    directories.push(directory);
    const errors: string[] = [];
    await expect(runCli(['pair', '--home', directory], {}, { out: () => undefined, error: (value) => errors.push(value) })).resolves.toBe(1);
    expect(errors.join('\n')).toContain('No running OpenTig server');
  });
});
