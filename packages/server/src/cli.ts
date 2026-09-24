import { execFile } from 'node:child_process';
import process from 'node:process';
import { renderUnicodeCompact } from 'uqr';
import { normalizeRuntimePlatform } from '../../../src/main/runtime/create-runtime';
import { redactSensitiveText } from '../../../src/shared/redaction';
import { openSystemBrowser } from './browser';
import { CliUsageError, cliHelp, parseCliArguments, type OpenTigCliConfig } from './cli-config';
import { manageCliService } from './cli-service';
import { createServiceUpdater } from './service-updater';
import {
  clearRuntimeState,
  loadOrCreateAdminToken,
  newInstanceId,
  prepareCliHome,
  readAdminToken,
  readRuntimeState,
  resolveCliPaths,
  writeRuntimeState,
  type OpenTigRuntimeState,
} from './cli-home';
import { CliServerLog } from './cli-log';
import { runOpenTigServer, type OpenTigServerConfig, type RunningOpenTigServer } from './server';
import { OPEN_TIG_APP_VERSION } from './version';
import { applicationName, type ApplicationProfile } from '../../../src/shared/application-profile';

const SHUTDOWN_TIMEOUT_MS = 8_000;

export interface CliIo {
  out(value: string): void;
  error(value: string): void;
}

const consoleIo: CliIo = {
  out: (value) => process.stdout.write(`${value}\n`),
  error: (value) => process.stderr.write(`${value}\n`),
};

export async function runCli(args: readonly string[], environment: NodeJS.ProcessEnv = process.env, io: CliIo = consoleIo, profile: ApplicationProfile = 'production'): Promise<number> {
  try {
    assertNodeVersion();
    const config = parseCliArguments(args, environment);
    if (config.command === 'help') {
      io.out(cliHelp(OPEN_TIG_APP_VERSION));
      return 0;
    }
    if (config.command === 'version') {
      io.out(OPEN_TIG_APP_VERSION);
      return 0;
    }
    if (config.command === 'service') return await manageCliService(config, io);
    if (config.command === 'pair') return await pairRunningServer(config, io, profile);
    return await startCliServer(config, io, profile);
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
    io.error(`OpenTig: ${message}`);
    if (error instanceof CliUsageError) io.error('Run "opentig --help" for usage.');
    return error instanceof CliUsageError ? error.exitCode : 1;
  }
}

async function startCliServer(config: OpenTigCliConfig, io: CliIo, profile: ApplicationProfile): Promise<number> {
  await assertGitAvailable();
  const paths = resolveCliPaths(config.home);
  await prepareCliHome(paths);
  await refuseActiveRuntime(paths.runtimeState, profile);
  const adminToken = await loadOrCreateAdminToken(paths.adminToken);
  const instanceId = newInstanceId();
  const log = new CliServerLog(paths.serverLog);
  const updates = await createServiceUpdater(config.home, OPEN_TIG_APP_VERSION, profile, config);
  let server: RunningOpenTigServer | null = null;
  try {
    server = await startOnConfiguredPort({
      appVersion: OPEN_TIG_APP_VERSION,
      updates,
      profile,
      auth: { consumeDesktopSecret: () => false },
      settingsPath: paths.settings,
      aiLogPath: paths.aiLog,
      serverDataPath: paths.serverData,
      platform: normalizeRuntimePlatform(process.platform),
      host: config.host,
      mode: 'web-access',
      logger: log.logger,
      admin: { token: adminToken, instanceId },
    }, config.port);

    await writeRuntimeState(paths.runtimeState, {
      pid: process.pid,
      host: config.host,
      port: server.port,
      protocolVersion: server.protocolVersion,
      appVersion: server.appVersion,
      instanceId,
      startedAt: new Date().toISOString(),
    });
    log.logger('info', `OpenTig CLI ready on ${publicOrigin(config.host, server.port)}.`);
    const origin = publicOrigin(config.host, server.port);
    const pairing = rewritePairingOrigin(server.createPairingLink(), origin);
    io.out(`${applicationName(profile)} ${server.appVersion} is ready.`);
    if (profile === 'dev') io.out(`Dev data directory: ${paths.home}`);
    io.out(`Connection URL: ${origin}`);
    printPairing(pairing, io, config.command === 'serve');
    if (!isLoopbackHost(config.host)) {
      io.error('WARNING: This listener grants owner-level access as your OS user. Use only a trusted LAN/VPN or an HTTPS/SSH tunnel; never expose it directly to the public Internet.');
      if (config.host === '0.0.0.0' || config.host === '::') {
        io.error('Replace the loopback host in the printed link with a trusted address of this machine for another device.');
      }
    }
    if (config.openBrowser) {
      await openSystemBrowser(pairing.url).catch(() => {
        io.error('Could not open the system browser. Open the one-time pairing link shown above manually.');
      });
    }

    updates.start();
    return await waitForShutdown(server, async () => {
      await updates.stop();
      await clearRuntimeState(paths.runtimeState, instanceId);
      await log.close();
    }, io);
  } catch (error) {
    await updates.stop();
    if (server) await server.close().catch(() => undefined);
    await clearRuntimeState(paths.runtimeState, instanceId).catch(() => undefined);
    await log.close();
    throw error;
  }
}

async function pairRunningServer(config: OpenTigCliConfig, io: CliIo, profile: ApplicationProfile): Promise<number> {
  const paths = resolveCliPaths(config.home);
  const state = await readRuntimeState(paths.runtimeState);
  if (!isProcessRunning(state.pid)) throw new Error('OpenTig runtime state is stale; its process is not running.');
  const origin = publicOrigin(state.host, state.port);
  const adminOrigin = localAdminOrigin(state);
  const ready = await fetch(`${adminOrigin}/readyz`, { signal: AbortSignal.timeout(3_000) });
  if (!ready.ok) throw new Error('The running OpenTig server is not ready.');
  const identity = await ready.json() as Partial<OpenTigRuntimeState> & { status?: unknown; profile?: unknown };
  if (identity.status !== 'ready'
    || identity.protocolVersion !== state.protocolVersion
    || identity.appVersion !== state.appVersion
    || (profile === 'dev' && identity.profile !== 'dev')) {
    throw new Error('OpenTig runtime state does not match the running server.');
  }
  const adminToken = await readAdminToken(paths.adminToken).catch(() => {
    throw new Error('OpenTig local admin credential is missing or unreadable.');
  });
  const response = await fetch(`${adminOrigin}/api/admin/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OpenTig-Admin': adminToken },
    body: JSON.stringify({ instanceId: state.instanceId, publicOrigin: origin }),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error('The running server refused the local pairing request.');
  const pairing = validatePairing(await response.json(), origin);
  printPairing(pairing, io, true);
  return 0;
}

export async function startOnConfiguredPort(
  baseConfig: Omit<OpenTigServerConfig, 'port'>,
  port: number,
): Promise<RunningOpenTigServer> {
  try {
    return await runOpenTigServer({ ...baseConfig, port });
  } catch (error) {
    if (isAddressInUse(error)) throw new Error(`Port ${port} is already in use. Stop that process or select another port with --port.`, { cause: error });
    throw error;
  }
}

export function publicOrigin(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  return `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}`;
}

async function refuseActiveRuntime(runtimeStatePath: string, profile: ApplicationProfile): Promise<void> {
  try {
    const state = await readRuntimeState(runtimeStatePath);
    if (isProcessRunning(state.pid)) throw new Error(`OpenTig is already running for this home (PID ${state.pid}). Use "${profile === 'dev' ? 'npm run pair:web:dev' : 'opentig pair'}" to add a device.`);
    await clearRuntimeState(runtimeStatePath, state.instanceId);
  } catch (error) {
    if (error instanceof Error && error.message === 'No running OpenTig server was found for this home.') return;
    throw error;
  }
}

function waitForShutdown(server: RunningOpenTigServer, afterClose: () => Promise<void>, io: CliIo): Promise<number> {
  return new Promise((resolve) => {
    let stopping = false;
    const handle = (signal: 'SIGINT' | 'SIGTERM') => {
      const exitCode = signal === 'SIGINT' ? 130 : 143;
      if (stopping) process.exit(exitCode);
      stopping = true;
      io.error(`Received ${signal}; shutting down OpenTig...`);
      const timeout = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
      void server.close().then(afterClose).then(() => {
        clearTimeout(timeout);
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onTerminate);
        resolve(exitCode);
      }, () => {
        clearTimeout(timeout);
        resolve(1);
      });
    };
    const onInterrupt = () => handle('SIGINT');
    const onTerminate = () => handle('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
  });
}

function printPairing(pairing: { url: string; expiresAt: string }, io: CliIo, includeQr: boolean): void {
  const token = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('token');
  io.out(`One-time pairing link (expires ${pairing.expiresAt}):`);
  io.out(pairing.url);
  if (token) {
    io.out('Pairing code (paste at /pair on this OpenTig server):');
    io.out(token);
  }
  if (includeQr) io.out(renderUnicodeCompact(pairing.url, { border: 2 }));
}

function rewritePairingOrigin(pairing: { url: string; expiresAt: string }, origin: string): { url: string; expiresAt: string } {
  const source = new URL(pairing.url);
  const url = new URL('/pair', origin);
  url.hash = source.hash;
  return validatePairing({ url: url.href, expiresAt: pairing.expiresAt }, origin);
}

function validatePairing(value: unknown, origin: string): { url: string; expiresAt: string } {
  const pairing = value as { url?: unknown; expiresAt?: unknown } | null;
  if (!pairing || typeof pairing.url !== 'string' || typeof pairing.expiresAt !== 'string') throw new Error('The server returned an invalid pairing link.');
  const url = new URL(pairing.url);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  const expiresAt = Date.parse(pairing.expiresAt);
  if (url.origin !== origin || url.pathname !== '/pair' || url.search || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || expiresAt <= Date.now() || expiresAt > Date.now() + 15 * 60 * 1_000) {
    throw new Error('The server returned an invalid pairing link.');
  }
  return { url: url.href, expiresAt: pairing.expiresAt };
}

function localAdminOrigin(state: OpenTigRuntimeState): string {
  return publicOrigin(state.host, state.port);
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host.toLowerCase() === 'localhost';
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function assertNodeVersion(): void {
  const major = Number(process.versions.node.split('.', 1)[0]);
  if (!Number.isSafeInteger(major) || major < 24) throw new Error('Node.js 24 or later is required.');
}

function assertGitAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim().startsWith('git version ')) reject(new Error('Git is required and was not found on PATH.'));
      else resolve();
    });
  });
}
