/* global AbortSignal, clearTimeout, fetch, setTimeout */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const loadModule = createRequire(import.meta.url);
const electron = loadModule('electron');

if (typeof electron === 'string') {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [scriptPath], { env: environment, stdio: 'inherit' });
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

async function verifyPackagedUtility({ utilityProcess }) {
  const resources = path.join(repositoryRoot, 'out', 'OpenTig-win32-x64', 'resources');
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
          platform: 'win32',
          host: '127.0.0.1',
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
    const response = await fetch(`${ready.origin}/readyz`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok || (await response.json()).status !== 'ready') throw new Error('Packaged utility readiness check failed.');
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.postMessage({ type: 'shutdown' });
    if (await Promise.race([exited, delay(5_000).then(() => 'timeout')]) === 'timeout') throw new Error('Packaged utility ignored graceful shutdown.');
    process.stdout.write('PACKAGED_UTILITY_PROCESS_SMOKE_OK\n');
  } finally {
    child?.kill();
    await rm(directory, { recursive: true, force: true });
  }
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
