/* global fetch */
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
try {
  const entry = pathToFileURL(path.join(packagedServer, 'server.mjs')).href;
  const { runOpenTigServer } = await import(entry);
  server = await runOpenTigServer({
    settingsPath: path.join(smokeDirectory, 'settings.json'),
    aiLogPath: path.join(smokeDirectory, 'ai-log.jsonl'),
    platform: 'win32',
    trash: { available: true, trashItem: async () => undefined },
    appVersion: 'packaged-smoke',
    auth: {
      descriptor: () => ({ authenticationRequired: true, pairingAvailable: false }),
      consumeDesktopSecret: () => false,
      consumePairingToken: () => false,
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
} finally {
  await server?.close();
  await rm(smokeDirectory, { recursive: true, force: true });
}
process.stdout.write('PACKAGED_SERVER_BUILD_OK\n');
