import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { packagedPaths } from './packaged-paths.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const loadModule = createRequire(import.meta.url);
const electron = loadModule('electron');

if (typeof electron === 'string') {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [scriptPath, ...process.argv.slice(2)], { env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const { app } = electron;
  app.whenReady()
    .then(async () => {
      await verifyPackagedUtility(electron);
      app.exit(0);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      app.exit(1);
    });
}

async function verifyPackagedUtility(electron) {
  const { resources } = packagedPaths();
  const { uIOhook } = loadModule(path.join(resources, 'app.asar.unpacked', 'node_modules', 'uiohook-napi'));
  if (typeof uIOhook?.start !== 'function') throw new Error('Packaged native keyboard module did not load.');
  await verifyPackagedUtilityHost(electron, '127.0.0.1');
  await verifyPackagedUtilityHost(electron, '0.0.0.0');
  process.stdout.write('PACKAGED_UTILITY_PROCESS_SMOKE_OK\n');
}

async function verifyPackagedUtilityHost({ utilityProcess }, host) {
  const { resources, profile } = packagedPaths();
  const serverRoot = path.join(resources, 'opentig-server');
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-packaged-utility-'));
  const port = await reservePort();
  let child;

  try {
    child = utilityProcess.fork(path.join(serverRoot, 'utility.mjs'), [], {
      cwd: repositoryRoot,
      env: { ...process.env },
      stdio: 'pipe',
      serviceName: 'OpenTig Server Smoke',
    });
    const stderr = [];
    child.stderr?.on('data', (chunk) => stderr.push(chunk.toString()));
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Packaged utility timed out. ${stderr.join('').slice(-500)}`)), 15_000);
      child.once('spawn', () => child.postMessage({
        type: 'bootstrap',
        protocolVersion: 1,
        config: {
          appVersion: 'packaged-utility-smoke',
          desktopSecret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          settingsPath: path.join(directory, 'settings.json'),
          aiLogPath: path.join(directory, 'ai-log.jsonl'),
          serverDataPath: path.join(directory, 'server'),
          clientRoot: path.join(serverRoot, 'client'),
          trashModulePath: path.join(resources, 'app.asar.unpacked', 'node_modules', 'trash', 'index.js'),
          platform: process.platform,
          profile,
          host,
          port,
        },
      }));
      child.on('message', (message) => {
        if (message?.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(`Packaged utility failed: ${message.code} ${message.message}`));
        } else if (message?.type === 'ready') {
          clearTimeout(timeout);
          resolve(message);
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Packaged utility exited before ready with code ${code}. ${stderr.join('').slice(-500)}`));
      });
    });
    if (ready.host !== host) throw new Error(`Packaged utility returned unexpected host ${ready.host}.`);
    const response = await fetch(`http://127.0.0.1:${ready.port}/readyz`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok || (await response.json()).status !== 'ready') throw new Error('Packaged utility readiness check failed.');
    const status = await control(child, 'status');
    if (status.action !== 'status' || status.connectedSessionCount !== 0) throw new Error('Packaged utility status control failed.');
    const pairing = await control(child, 'create-pairing-link');
    const pairingToken = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('token');
    if (pairing.action !== 'create-pairing-link' || !pairingToken || !/^[A-Za-z0-9_-]{43}$/.test(pairingToken)) {
      throw new Error('Packaged utility pairing control failed.');
    }
    const origin = `http://127.0.0.1:${ready.port}`;
    const authenticated = await fetch(`${origin}/api/auth/desktop`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
      signal: AbortSignal.timeout(5_000),
    });
    const cookie = authenticated.headers.get('set-cookie')?.split(';', 1)[0];
    if (authenticated.status !== 204 || !cookie?.startsWith(profile === 'dev' ? 'opentig_dev_session=' : 'opentig_session=')) {
      throw new Error('Packaged utility desktop bootstrap failed.');
    }
    // Session revocation now uses authenticated HTTP, not the old utility control action.
    const revoked = await fetch(`${origin}/api/auth/revoke-all`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    if (revoked.status !== 204) throw new Error('Packaged utility session revocation failed.');
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.postMessage({ type: 'shutdown' });
    if (await Promise.race([exited, delay(5_000).then(() => 'timeout')]) === 'timeout') throw new Error('Packaged utility ignored graceful shutdown.');
  } finally {
    child?.kill();
    await rm(directory, { recursive: true, force: true });
  }
}

function control(child, action) {
  const requestId = `smoke-${action}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Packaged utility ${action} control timed out.`)), 5_000);
    const onMessage = (message) => {
      if (message?.type !== 'control-result' || message.requestId !== requestId) return;
      clearTimeout(timeout);
      child.off('message', onMessage);
      if (!message.ok) reject(new Error(`Packaged utility ${action} control failed: ${message.message}`));
      else resolve(message.result);
    };
    child.on('message', onMessage);
    child.postMessage({ type: 'control', requestId, action });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selected = address && typeof address === 'object' ? address.port : null;
      server.close((error) => error ? reject(error) : selected ? resolve(selected) : reject(new Error('Could not reserve a smoke-test port.')));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
