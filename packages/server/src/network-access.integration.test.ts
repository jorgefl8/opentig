import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkSettings } from './network-settings';
import { runOpenTigServer, type OpenTigServerConfig, type RunningOpenTigServer } from './server';

const directories: string[] = [];
const servers: RunningOpenTigServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-network-access-'));
  directories.push(directory);
  const config: OpenTigServerConfig = {
    appVersion: 'test', auth: { consumeDesktopSecret: () => false },
    mode: 'web-access', host: '127.0.0.1', port: 0, platform: 'linux',
    settingsPath: path.join(directory, 'settings.json'), aiLogPath: path.join(directory, 'ai.jsonl'),
    serverDataPath: path.join(directory, 'server'),
  };
  const server = await runOpenTigServer(config);
  servers.push(server);
  const origin = server.origin;
  const token = new URLSearchParams(new URL(server.createPairingLink().url).hash.slice(1)).get('token');
  const paired = await fetch(`${origin}/api/auth/pair`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, clientName: 'Network settings test' }),
  });
  expect(paired.status).toBe(204);
  const cookie = paired.headers.get('set-cookie')!.split(';')[0]!;
  const request = (patch: unknown, target = server.getWebAccessStatus().localEndpoint!) => fetch(`${target}/api/auth/web-access`, {
    method: 'POST', headers: { Origin: target, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  return { server, config, cookie, request, directory };
}

describe('owner web access configuration', () => {
  it('requires an authenticated owner and the correct origin, and validates the whole patch before writing', async () => {
    const { server, cookie, request, directory } = await fixture();
    const endpoint = `${server.origin}/api/auth/web-access`;
    expect((await fetch(endpoint, { method: 'POST', headers: { Origin: server.origin }, body: '{}' })).status).toBe(401);
    expect((await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://other.example', Cookie: cookie }, body: '{}' })).status).toBe(403);
    for (const patch of [{ listenerPort: 0 }, { listenerPort: 65536 }, { listenerHost: 'example.com' }, { webAccessEnabled: 'yes' }, { publicOrigin: 'https://example.com/path' }, { unknown: true }]) {
      expect((await request(patch)).status).toBe(400);
    }
    await expect(readFile(path.join(directory, 'server/web-access.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(server.getWebAccessStatus()).toMatchObject({ webAccessEnabled: true, listeningOnLan: false });
  });

  it('changes LAN access without replacing the runtime, persists the domain, and preserves paired sessions across restart', async () => {
    const { server, config, request, cookie } = await fixture();
    const runtime = server.runtime;
    const port = server.port;
    const enabled = await request({ lanAccessEnabled: true });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ listeningOnLan: true, listenerHost: '0.0.0.0', actualPort: port });
    expect(server.runtime).toBe(runtime);
    expect((await request({ publicOrigin: 'https://git.example.com' })).status).toBe(200);
    const origin = server.getWebAccessStatus().localEndpoint!;
    const link = await fetch(`${origin}/api/auth/pairing-link`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: JSON.stringify({ endpoint: 'https://git.example.com' }),
    });
    expect(link.status).toBe(200);
    expect((await link.json()).url).toMatch(/^https:\/\/git\.example\.com\/pair#token=/);
    await server.close();
    const restarted = await runOpenTigServer(config);
    servers.push(restarted);
    expect(restarted.getWebAccessStatus()).toMatchObject({ listeningOnLan: true, actualPort: port, publicOrigin: 'https://git.example.com' });
    expect((await fetch(`${restarted.getWebAccessStatus().localEndpoint}/api/auth/web-access`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await restarted.updateWebAccess({ lanAccessEnabled: false })).listeningOnLan).toBe(false);
  });

  it('returns the network response before the old HTTP connection closes and restores the previous listener on a port conflict', async () => {
    const { server, request } = await fixture();
    const oldPort = server.port;
    const occupied = createServer();
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const port = (occupied.address() as { port: number }).port;
    try {
      const rejected = await request({ listenerPort: port });
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).error).toContain('previous listener has been restored');
      expect(server.port).toBe(oldPort);
      expect((await fetch(`${server.origin}/readyz`)).status).toBe(200);
    } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
    const applied = await request({ listenerPort: port });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ actualPort: port });
    expect((await fetch(`${server.origin}/readyz`)).status).toBe(200);
  });

  it('restores the listener if persistence fails and serializes changes from different clients', async () => {
    const { server, request } = await fixture();
    vi.spyOn(NetworkSettings.prototype, 'save').mockRejectedValueOnce(new Error('Could not save settings.'));
    expect((await request({ lanAccessEnabled: true })).status).toBe(400);
    expect(server.getWebAccessStatus()).toMatchObject({ listeningOnLan: false, webAccessEnabled: true });
    const results = await Promise.all([request({ publicOrigin: 'https://git.example.com' }), request({ lanAccessEnabled: true })]);
    expect(results.map(response => response.status)).toEqual([200, 200]);
    expect(server.getWebAccessStatus()).toMatchObject({ publicOrigin: 'https://git.example.com', listeningOnLan: true });
  });

  it('persists paused access without revoking paired devices, and restores their cookies after enabling', async () => {
    const { server, request, cookie, config } = await fixture();
    const response = await request({ webAccessEnabled: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ webAccessEnabled: false });
    const origin = server.origin;
    expect((await fetch(`${origin}/api/auth/web-access`, { headers: { Cookie: cookie } })).status).toBe(401);
    await server.close();
    const restarted = await runOpenTigServer(config);
    servers.push(restarted);
    expect(restarted.getStatus().browserAccessEnabled).toBe(false);
    await restarted.updateWebAccess({ webAccessEnabled: true });
    expect((await fetch(`${restarted.origin}/api/auth/web-access`, { headers: { Cookie: cookie } })).status).toBe(200);
  });
});
