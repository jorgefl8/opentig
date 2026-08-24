import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import process from 'node:process';
import { renderUnicodeCompact } from 'uqr';
import { normalizeRuntimePlatform } from '../../../src/main/runtime/create-runtime';
import { openRuntimeRepositoryPath } from '../../../src/main/runtime/registerServerCommands';
import { redactSensitiveText } from '../../../src/shared/redaction';
import { DEFAULT_SERVER_PORT_SCAN_COUNT } from '../../../src/shared/server-config';
import { openSystemBrowser } from './browser';
import { CliUsageError, cliHelp, parseCliArguments, type OpenTigCliConfig } from './cli-config';
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

const SHUTDOWN_TIMEOUT_MS = 8_000;

export interface CliIo {
  out(value: string): void;
  error(value: string): void;
}

const consoleIo: CliIo = {
  out: (value) => process.stdout.write(`${value}\n`),
  error: (value) => process.stderr.write(`${value}\n`),
};

export async function runCli(args: readonly string[], environment: NodeJS.ProcessEnv = process.env, io: CliIo = consoleIo): Promise<number> {
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
    if (config.command === 'pair') return await pairRunningServer(config, io);
    return await startCliServer(config, io);
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
    io.error(`OpenTig: ${message}`);
    if (error instanceof CliUsageError) io.error('Run "opentig --help" for usage.');
    return error instanceof CliUsageError ? error.exitCode : 1;
  }
}

async function startCliServer(config: OpenTigCliConfig, io: CliIo): Promise<number> {
  await assertGitAvailable();
  const paths = resolveCliPaths(config.home);
  await prepareCliHome(paths);
  await refuseActiveRuntime(paths.runtimeState);
  const adminToken = await loadOrCreateAdminToken(paths.adminToken);
  const instanceId = newInstanceId();
  const log = new CliServerLog(paths.serverLog);
  let server: RunningOpenTigServer | null = null;
  try {
    server = await startWithPortFallback({
      appVersion: OPEN_TIG_APP_VERSION,
      auth: { consumeDesktopSecret: () => false },
      settingsPath: paths.settings,
      aiLogPath: paths.aiLog,
      serverDataPath: paths.serverData,
      platform: normalizeRuntimePlatform(process.platform),
      host: config.host,
      mode: 'web-access',
      logger: log.logger,
      admin: { token: adminToken, instanceId },
    }, config.port, config.portExplicit);

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
    await tryOpenInitialRepository(server, config.cwd, io);

    const origin = publicOrigin(config.host, server.port);
    const pairing = rewritePairingOrigin(server.createPairingLink(), origin);
    io.out(`OpenTig ${server.appVersion} is ready.`);
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

    return await waitForShutdown(server, async () => {
      await clearRuntimeState(paths.runtimeState, instanceId);
      await log.close();
    }, io);
  } catch (error) {
    if (server) await server.close().catch(() => undefined);
    await clearRuntimeState(paths.runtimeState, instanceId).catch(() => undefined);
    await log.close();
    throw error;
  }
}

async function pairRunningServer(config: OpenTigCliConfig, io: CliIo): Promise<number> {
  const paths = resolveCliPaths(config.home);
  const state = await readRuntimeState(paths.runtimeState);
  if (!isProcessRunning(state.pid)) throw new Error('OpenTig runtime state is stale; its process is not running.');
  const origin = publicOrigin(state.host, state.port);
  const adminOrigin = localAdminOrigin(state);
  const ready = await fetch(`${adminOrigin}/readyz`, { signal: AbortSignal.timeout(3_000) });
  if (!ready.ok) throw new Error('The running OpenTig server is not ready.');
  const identity = await ready.json() as Partial<OpenTigRuntimeState> & { status?: unknown };
  if (identity.status !== 'ready'
    || identity.protocolVersion !== state.protocolVersion
    || identity.appVersion !== state.appVersion) {
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

export async function startWithPortFallback(
  baseConfig: Omit<OpenTigServerConfig, 'port'>,
  preferredPort: number,
  explicitPort: boolean,
): Promise<RunningOpenTigServer> {
  const attempts = explicitPort ? 1 : DEFAULT_SERVER_PORT_SCAN_COUNT;
  let lastConflict: unknown;
  for (let offset = 0; offset < attempts && preferredPort + offset <= 65_535; offset += 1) {
    try {
      return await runOpenTigServer({ ...baseConfig, port: preferredPort + offset });
    } catch (error) {
      if (!isAddressInUse(error)) throw error;
      lastConflict = error;
    }
  }
  if (explicitPort) throw new Error(`Port ${preferredPort} is already in use.`, { cause: lastConflict });
  throw new Error(`No available port was found in ${preferredPort}-${Math.min(65_535, preferredPort + attempts - 1)}.`, { cause: lastConflict });
}

export function publicOrigin(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  return `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}`;
}

async function tryOpenInitialRepository(server: RunningOpenTigServer, cwd: string, io: CliIo): Promise<void> {
  try {
    const details = await stat(cwd);
    if (!details.isDirectory()) throw new Error('path is not a directory');
    await openRuntimeRepositoryPath(server.runtime.services, cwd);
  } catch {
    io.error(`Working directory was not opened because it is missing or is not a Git worktree: ${cwd}`);
  }
}

async function refuseActiveRuntime(runtimeStatePath: string): Promise<void> {
  try {
    const state = await readRuntimeState(runtimeStatePath);
    if (isProcessRunning(state.pid)) throw new Error(`OpenTig is already running for this home (PID ${state.pid}). Use "opentig pair" to add a device.`);
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
  io.out(`One-time pairing link (expires ${pairing.expiresAt}):`);
  io.out(pairing.url);
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
