import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { OneTimeBootstrapAuthSource } from './auth';
import { resolveServerClientRoot, runOpenTigServer } from './server';

describe('private server workspace', () => {
  it('resolves client assets beside built module rather than CWD', () => {
    const moduleUrl = new URL('file:///C:/opentig/server.mjs').href;
    expect(path.resolve(resolveServerClientRoot(moduleUrl))).toBe(path.join(path.dirname(fileURLToPath(moduleUrl)), 'client'));
  });

  it('constructs one headless runtime behind the server factory', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'opentig-server-runtime-'));
    try {
      const server = await runOpenTigServer({
        settingsPath: path.join(directory, 'settings.json'),
        aiLogPath: path.join(directory, 'ai-log.jsonl'),
        platform: 'win32',
        trash: { available: true, trashItem: vi.fn(async () => undefined) },
        onEvent: vi.fn(),
        clientRoot: path.join(directory, 'client'),
        appVersion: 'test',
        auth: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }),
        port: 0,
      });

      expect(server.runtime.services.runtimeMode).toBe('headless');
      expect(server.clientRoot).toBe(path.join(directory, 'client'));
      await server.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
