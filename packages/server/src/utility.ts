import path from 'node:path';
import process from 'node:process';
import {
  OPEN_TIG_UTILITY_PROTOCOL_VERSION,
  type OpenTigUtilityChildMessage,
  type OpenTigUtilityConfig,
  type OpenTigUtilityParentMessage,
} from '../../../src/shared/server-process';
import { redactSensitiveText } from '../../../src/shared/redaction';
import { OneTimeBootstrapAuthSource } from './auth';
import { runOpenTigServer, type RunningOpenTigServer } from './server';

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: OpenTigUtilityChildMessage): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error('OpenTig utility requires an Electron parent port.');

let server: RunningOpenTigServer | null = null;
let bootstrapReceived = false;
let shutdownStarted = false;
const bootstrapTimeout = setTimeout(() => failAndExit('BOOTSTRAP_TIMEOUT', 'Server bootstrap was not received.'), 15_000);
bootstrapTimeout.unref();

parentPort.on('message', ({ data }) => {
  const message = data as Partial<OpenTigUtilityParentMessage> | null;
  if (!bootstrapReceived) {
    bootstrapReceived = true;
    clearTimeout(bootstrapTimeout);
    void start(message);
    return;
  }
  if (message?.type === 'shutdown') void shutdown(0);
  else if (message?.type === 'bootstrap') void failAndExit('DUPLICATE_BOOTSTRAP', 'Server bootstrap may only be sent once.');
});

async function start(message: Partial<OpenTigUtilityParentMessage> | null): Promise<void> {
  try {
    const config = validateBootstrap(message);
    server = await runOpenTigServer({
      appVersion: config.appVersion,
      auth: new OneTimeBootstrapAuthSource({ desktopSecret: config.desktopSecret }),
      settingsPath: config.settingsPath,
      aiLogPath: config.aiLogPath,
      serverDataPath: config.serverDataPath,
      clientRoot: config.clientRoot,
      ...(config.trashModulePath ? { trashModulePath: config.trashModulePath } : {}),
      platform: config.platform,
      host: config.host,
      port: config.port,
      mode: 'desktop',
      logger: (level, value) => console[level](`[server] ${redactSensitiveText(value)}`),
    });
    parentPort!.postMessage({
      type: 'ready',
      host: server.host,
      port: server.port,
      origin: server.origin,
      protocolVersion: server.protocolVersion,
      appVersion: server.appVersion,
    });
  } catch (error) {
    failAndExit(errorCode(error), publicError(error));
  }
}

async function shutdown(exitCode: number): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try {
    await server?.close();
    parentPort!.postMessage({ type: 'stopped' });
  } catch (error) {
    console.error(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }
}

function failAndExit(code: string, message: string): void {
  if (shutdownStarted) return;
  parentPort!.postMessage({ type: 'error', code, message: redactSensitiveText(message) });
  void shutdown(1);
}

function validateBootstrap(message: Partial<OpenTigUtilityParentMessage> | null): OpenTigUtilityConfig {
  if (message?.type !== 'bootstrap' || message.protocolVersion !== OPEN_TIG_UTILITY_PROTOCOL_VERSION) {
    throw codedError('INVALID_BOOTSTRAP', 'Invalid server bootstrap message.');
  }
  const config = message.config as Partial<OpenTigUtilityConfig> | undefined;
  if (!config || typeof config !== 'object') throw codedError('INVALID_BOOTSTRAP', 'Invalid server configuration.');
  if (typeof config.appVersion !== 'string' || !config.appVersion || config.appVersion.length > 128) throw invalid('app version');
  if (typeof config.desktopSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(config.desktopSecret)) throw invalid('desktop secret');
  for (const [label, value] of [
    ['settings path', config.settingsPath],
    ['AI log path', config.aiLogPath],
    ['server data path', config.serverDataPath],
    ['client root', config.clientRoot],
  ] as const) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw invalid(label);
  }
  if (config.trashModulePath !== undefined && (typeof config.trashModulePath !== 'string' || !path.isAbsolute(config.trashModulePath))) {
    throw invalid('Trash module path');
  }
  if (!['win32', 'darwin', 'linux', 'other'].includes(String(config.platform))) throw invalid('platform');
  if (config.host !== '127.0.0.1') throw invalid('host');
  if (!Number.isInteger(config.port) || Number(config.port) < 1 || Number(config.port) > 65_535) throw invalid('port');
  return config as OpenTigUtilityConfig;
}

function invalid(label: string): Error {
  return codedError('INVALID_BOOTSTRAP', `Invalid ${label}.`);
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'SERVER_START_FAILED';
}

function publicError(error: unknown): string {
  if (errorCode(error) === 'EADDRINUSE') return 'The requested server port is already in use.';
  return error instanceof Error ? error.message : 'OpenTig server failed to start.';
}
