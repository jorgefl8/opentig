import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyServerBuild } from '../packages/server/scripts/verify-build.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv.includes('--dev') ? 'dev' : 'production';
const productName = profile === 'dev' ? 'OpenTig Dev' : 'OpenTig';
const packagedRoot = path.join(repositoryRoot, 'out', `${productName}-${process.platform}-${process.arch}`);
const resources = process.platform === 'darwin' ? path.join(`${productName}.app`, 'Contents', 'Resources') : 'resources';
const packagedServer = path.join(packagedRoot, resources, 'opentig-server');

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
    platform: process.platform,
    profile,
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
  const html = await client.text();
  if (!client.ok || !html.includes('<div id="root">')) throw new Error('Packaged server client check failed.');
  if (profile === 'dev' && (!html.includes('data-opentig-profile="dev"') || !html.includes('<title>OpenTig Dev</title>'))) throw new Error('Packaged Dev client identity missing.');
  if (server.runtime.services.settings.preferences.doubleControlShortcutEnabled !== (profile !== 'dev')) throw new Error('Packaged shortcut default incorrect.');

  const authenticated = await fetch(`${server.origin}/api/auth/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ secret: desktopSecret }),
  });
  const cookie = authenticated.headers.get('set-cookie')?.split(';', 1)[0];
  if (authenticated.status !== 204 || !cookie) throw new Error('Packaged server desktop authentication failed.');
  if (!cookie.startsWith(profile === 'dev' ? 'opentig_dev_session=' : 'opentig_session=')) throw new Error('Packaged session profile incorrect.');
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
