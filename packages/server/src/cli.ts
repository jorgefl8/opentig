import { formatDateTime } from '../../../src/shared/date-format';
import process from 'node:process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { renderUnicodeCompact } from 'uqr';
import { normalizeRuntimePlatform } from '../../../src/main/runtime/create-runtime';
import { CliError, cliCommand, diagnostic, operationError } from './cli-errors';
import { assertListenerAvailable, cliNetwork, listenerError } from './cli-network';
import { loadStartupNetwork } from './network-settings';
import { assertGitAvailable, isProcessRunning, probeRuntime, publicOrigin } from './cli-runtime';
import { recordCliFailure, startupReporter } from './cli-startup';
export { publicOrigin } from './cli-runtime';
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
  let config: OpenTigCliConfig | undefined;
  let reporter: Awaited<ReturnType<typeof startupReporter>> = null;
  try {
    config = parseCliArguments(args, environment);
    if (config.command === 'help') {
      io.out(cliHelp(OPEN_TIG_APP_VERSION));
      return 0;
    }
    if (config.command === 'version') {
      io.out(OPEN_TIG_APP_VERSION);
      return 0;
    }
    if (config.command === 'serve' || config.command === 'start') reporter = await startupReporter(config.home);
    assertNodeVersion();
    if (config.command === 'service') return await manageCliService(config, io);
    if (config.command === 'reset-access') {
      await rm(path.join(resolveCliPaths(config.home).serverData, 'web-access.json'), { force: true });
      io.out('Web access settings reset. Restart this OpenTig instance to enable browser access on its startup address and port. Paired devices are preserved.');
      io.out(`Managed service: ${cliCommand(config.home, 'service', 'restart')}`);
      io.out(`Foreground server: stop it in its terminal, then run ${cliCommand(config.home, 'serve')}`);
      return 0;
    }
    if (config.command === 'pair') return await pairRunningServer(config, io, profile);
    return await startCliServer(config, io, profile, reporter);
  } catch (error) {
    const failure = error instanceof CliUsageError || !config ? error
      : operationError(error, config.home, config.command === 'service' ? `run service ${config.serviceAction}` : `run ${config.command}`);
    if (config && !(error instanceof CliUsageError)) {
      await reporter?.failed(failure).catch(() => undefined);
      await recordCliFailure(config.home, failure).catch(() => undefined);
    }
    io.error(`OpenTig: ${diagnostic(failure)}`);
    if (error instanceof CliUsageError) io.error('Run "opentig --help" for usage.');
    return error instanceof CliUsageError ? error.exitCode : 1;
  }
}

async function startCliServer(config: OpenTigCliConfig, io: CliIo, profile: ApplicationProfile, reporter: Awaited<ReturnType<typeof startupReporter>>): Promise<number> {
  await assertGitAvailable();
  const paths = resolveCliPaths(config.home);
  await prepareCliHome(paths);
  await refuseActiveRuntime(config, profile);
  const network = await cliNetwork(config);
  await assertListenerAvailable(config, network, config.command);
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
      recoveryCommand: profile === 'dev' ? 'node packages/server/dist/dev.mjs reset-access' : 'opentig reset-access',
      onNetworkChanged: async (network) => {
        const state = await readRuntimeState(paths.runtimeState);
        await writeRuntimeState(paths.runtimeState, { ...state, host: network.listenerHost, port: network.listenerPort });
      },
    }, config.port, config);

    await writeRuntimeState(paths.runtimeState, {
      pid: process.pid,
      host: server.host,
      port: server.port,
      protocolVersion: server.protocolVersion,
      appVersion: server.appVersion,
      instanceId,
      startedAt: new Date().toISOString(),
    });
    await reporter?.ready(instanceId);
    log.logger('info', `OpenTig CLI ready on ${publicOrigin(server.host, server.port)}.`);
    const origin = publicOrigin(server.host, server.port);
    const pairing = server.getStatus().browserAccessEnabled ? rewritePairingOrigin(server.createPairingLink(), origin) : null;
    io.out(`${applicationName(profile)} ${server.appVersion} is ready.`);
    if (profile === 'dev') io.out(`Dev data directory: ${paths.home}`);
    io.out(`Connection URL: ${origin}`);
    if (pairing) printPairing(pairing, io, config.command === 'serve');
    else io.out('Web access is paused. Use reset-access locally and restart to restore it.');
    if (!isLoopbackHost(server.host)) {
      io.error('WARNING: This listener grants owner-level access as your OS user. Use only a trusted LAN/VPN or an HTTPS/SSH tunnel; never expose it directly to the public Internet.');
      if (server.host === '0.0.0.0' || server.host === '::') {
        io.error('Replace the loopback host in the printed link with a trusted address of this machine for another device.');
      }
    }
    if (config.openBrowser && pairing) {
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
    await updates.stop().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
    await clearRuntimeState(paths.runtimeState, instanceId).catch(() => undefined);
    await log.close();
    throw error;
  }
}

async function pairRunningServer(config: OpenTigCliConfig, io: CliIo, profile: ApplicationProfile): Promise<number> {
  const paths = resolveCliPaths(config.home);
  const state = await readRuntimeState(paths.runtimeState);
  if (!isProcessRunning(state.pid)) throw new CliError('RUNTIME_STALE', 'OpenTig runtime state is stale; its process is not running.', [`Start ${cliCommand(config.home, 'serve')} or restart its managed service.`]);
  const origin = publicOrigin(state.host, state.port);
  const adminOrigin = publicOrigin(state.host, state.port);
  const ready = await fetch(`${adminOrigin}/readyz`, { signal: AbortSignal.timeout(3_000) });
  if (!ready.ok) throw new CliError('SERVER_NOT_READY', 'The running OpenTig server is not ready.', [`Check ${cliCommand(config.home, 'service', 'status')} and retry when startup completes.`]);
  const identity = await ready.json() as Partial<OpenTigRuntimeState> & { status?: unknown; profile?: unknown };
  if (identity.status !== 'ready'
    || identity.protocolVersion !== state.protocolVersion
    || identity.appVersion !== state.appVersion
    || (profile === 'dev' && identity.profile !== 'dev')) {
    throw new CliError('RUNTIME_MISMATCH', 'OpenTig runtime state does not match the running server.', [`Inspect ${cliCommand(config.home, 'service', 'status')} before restarting this instance.`]);
  }
  const adminToken = await readAdminToken(paths.adminToken).catch(() => {
    throw new CliError('ADMIN_CREDENTIAL_INVALID', 'OpenTig local admin credential is missing or unreadable.', [`Check the private credential and permissions in ${paths.serverData}. Do not copy credentials from another instance.`]);
  });
  const response = await fetch(`${adminOrigin}/api/admin/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OpenTig-Admin': adminToken },
    body: JSON.stringify({ instanceId: state.instanceId, publicOrigin: origin }),
    signal: AbortSignal.timeout(3_000),
  });
  if (response.status === 403) throw new CliError('WEB_ACCESS_DISABLED', 'Web access is paused; no pairing link was created.', [`Enable browser access in Settings → Web access, or run ${cliCommand(config.home, 'reset-access')} and restart this instance.`, 'Resetting access restores startup listener settings and preserves paired browsers.']);
  if (!response.ok) throw new CliError('PAIRING_REFUSED', 'The running server refused the local pairing request.', [`Check ${cliCommand(config.home, 'service', 'status')} and the selected home before retrying.`]);
  let pairing: { url: string; expiresAt: string };
  try { pairing = validatePairing(await response.json(), origin); }
  catch (cause) { throw new CliError('PAIRING_INVALID', 'The server returned an invalid pairing link.', [`No link was printed. Inspect ${cliCommand(config.home, 'service', 'status')} and the server log before retrying.`], { cause }); }
  printPairing(pairing, io, true);
  return 0;
}

export async function startOnConfiguredPort(
  baseConfig: Omit<OpenTigServerConfig, 'port'>,
  port: number,
  cliConfig?: OpenTigCliConfig,
): Promise<RunningOpenTigServer> {
  try {
    return await runOpenTigServer({ ...baseConfig, port });
  } catch (error) {
    const config = cliConfig ?? { home: path.dirname(baseConfig.settingsPath), host: baseConfig.host ?? '127.0.0.1', port };
    const { network, savedListener } = await loadStartupNetwork({ ...baseConfig, port });
    throw listenerError(error, config, { ...network, savedListener }, cliConfig?.command ?? 'serve');
  }
}

async function refuseActiveRuntime(config: OpenTigCliConfig, profile: ApplicationProfile): Promise<void> {
  const paths = resolveCliPaths(config.home);
  try {
    const state = await readRuntimeState(paths.runtimeState);
    if (isProcessRunning(state.pid)) {
      await probeRuntime(config.home, state);
      throw new CliError('HOME_ACTIVE', 'OpenTig is already running for this home.', [
        `Pair a browser with ${profile === 'dev' ? 'npm run pair:web:dev' : cliCommand(config.home, 'pair')}`,
        'To switch a foreground instance to a service, stop it in its terminal first.',
      ]);
    }
    await clearRuntimeState(paths.runtimeState, state.instanceId);
  } catch (error) {
    if (error instanceof CliError && error.code === 'RUNTIME_MISSING') return;
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
  io.out(`One-time pairing link (expires ${formatDateTime(pairing.expiresAt, { seconds: true })}):`);
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
  if (!pairing || typeof pairing.url !== 'string' || typeof pairing.expiresAt !== 'string') throw new CliError('PAIRING_INVALID', 'The server returned an invalid pairing link.', ['No link was printed. Check the selected instance and server logs before retrying.']);
  const url = new URL(pairing.url);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  const expiresAt = Date.parse(pairing.expiresAt);
  if (url.origin !== origin || url.username || url.password || url.pathname !== '/pair' || url.search || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 15 * 60 * 1_000) {
    throw new CliError('PAIRING_INVALID', 'The server returned an invalid pairing link.', ['No link was printed. Check the selected instance and server logs before retrying.']);
  }
  return { url: url.href, expiresAt: pairing.expiresAt };
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host.toLowerCase() === 'localhost';
}

function assertNodeVersion(): void {
  const major = Number(process.versions.node.split('.', 1)[0]);
  if (!Number.isSafeInteger(major) || major < 24) throw new CliError('NODE_UNSUPPORTED', 'Node.js 24 or later is required.', ['Install a supported Node.js version, then retry from that terminal.']);
}
