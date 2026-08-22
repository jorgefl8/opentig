/* global clearTimeout, fetch, setTimeout */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyServerBuild } from '../packages/server/scripts/verify-build.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedServer = path.join(repositoryRoot, 'out', 'OpenTig-win32-x64', 'resources', 'opentig-server');

await verifyServerBuild(packagedServer);
const smokeDirectory = await mkdtemp(path.join(tmpdir(), 'opentig-packaged-server-'));
let server;
let socket;
try {
  const entry = pathToFileURL(path.join(packagedServer, 'server.mjs')).href;
  const { runOpenTigServer } = await import(entry);
  const desktopSecret = 'packaged-smoke-desktop-secret';
  server = await runOpenTigServer({
    settingsPath: path.join(smokeDirectory, 'settings.json'),
    aiLogPath: path.join(smokeDirectory, 'ai-log.jsonl'),
    platform: 'win32',
    trash: { available: true, trashItem: async () => undefined },
    appVersion: 'packaged-smoke',
    auth: {
      descriptor: () => ({ authenticationRequired: true, pairingAvailable: false }),
      consumeDesktopSecret: (value) => value === desktopSecret,
    },
    port: 0,
  });
  const [health, ready, client] = await Promise.all([
    fetch(`${server.origin}/healthz`),
    fetch(`${server.origin}/readyz`),
    fetch(`${server.origin}/`),
  ]);
  if (!health.ok || (await health.json()).status !== 'ok') throw new Error('Packaged server health check failed.');
  if (!ready.ok || (await ready.json()).status !== 'ready') throw new Error('Packaged server readiness check failed.');
  if (!client.ok || !(await client.text()).includes('<div id="root"></div>')) throw new Error('Packaged server client check failed.');

  const authenticated = await fetch(`${server.origin}/api/auth/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ secret: desktopSecret }),
  });
  const cookie = authenticated.headers.get('set-cookie')?.split(';', 1)[0];
  if (authenticated.status !== 204 || !cookie) throw new Error('Packaged server desktop authentication failed.');
  const { default: WebSocket } = await import(pathToFileURL(path.join(packagedServer, 'node_modules', 'ws', 'index.js')).href);
  socket = new WebSocket(`${server.origin.replace(/^http/, 'ws')}/ws`, { headers: { Cookie: cookie, Origin: server.origin } });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Packaged server WebSocket smoke timed out.')), 5_000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'request', id: 'smoke', command: 'app:bootstrap', args: [] })));
    socket.once('message', (data) => {
      clearTimeout(timeout);
      try {
        const message = JSON.parse(data.toString());
        if (message.type !== 'result' || message.id !== 'smoke' || message.result?.ok !== true) throw new Error('Invalid command response.');
        resolve();
      } catch (error) { reject(error); }
    });
    socket.once('error', reject);
  });
} finally {
  socket?.terminate();
  await server?.close();
  await rm(smokeDirectory, { recursive: true, force: true });
}
process.stdout.write('PACKAGED_SERVER_BUILD_OK\n');
