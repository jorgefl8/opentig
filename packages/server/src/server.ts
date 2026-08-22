import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CommandRegistry } from '../../../src/main/runtime/CommandRegistry';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import {
  createOpenTigRuntime,
  type CreateOpenTigRuntimeOptions,
} from '../../../src/main/runtime/create-runtime';
import type { OpenTigHost } from '../../../src/main/runtime/OpenTigHost';
import { registerServerCommands } from '../../../src/main/runtime/registerServerCommands';
import { OPEN_TIG_PROTOCOL_VERSION } from '../../../src/shared/server-protocol';
import { OpenTigSessionAuth, type OpenTigBootstrapAuthSource } from './auth';
import { OpenTigServer, type OpenTigServerAddress } from './OpenTigServer';
import type { OpenTigServerLogger, OpenTigServerMode } from './http';

export interface OpenTigServerConfig extends Omit<CreateOpenTigRuntimeOptions, 'runtimeMode' | 'onEvent'> {
  appVersion: string;
  auth: OpenTigBootstrapAuthSource;
  serverDataPath?: string;
  clientRoot?: string;
  host?: string;
  port?: number;
  mode?: OpenTigServerMode;
  secureCookies?: boolean;
  allowedOrigins?: readonly string[];
  logger?: OpenTigServerLogger;
  onEvent?: CreateOpenTigRuntimeOptions['onEvent'];
  commandTimeoutMs?: number;
  connectionLimit?: number;
  heartbeatMs?: number;
  requestRateLimit?: number;
  requestRateWindowMs?: number;
}

export interface RunningOpenTigServer extends OpenTigServerAddress {
  readonly runtime: OpenTigRuntime;
  readonly clientRoot: string;
  createPairingLink(): { url: string; expiresAt: string };
  close(): Promise<void>;
}

/**
 * Single construction boundary shared by future CLI and utility-process
 * adapters. HTTP/WebSocket and persistent owner authentication live here;
 * current desktop boot remains untouched as rollback path.
 */
export async function runOpenTigServer(config: OpenTigServerConfig): Promise<RunningOpenTigServer> {
  let transport: OpenTigServer | null = null;
  const auth = await OpenTigSessionAuth.open({
    source: config.auth,
    dataDirectory: config.serverDataPath ?? path.join(path.dirname(config.settingsPath), 'server'),
    ...(config.secureCookies === undefined ? {} : { secureCookies: config.secureCookies }),
  });
  let runtime: OpenTigRuntime;
  try {
    runtime = await createOpenTigRuntime({
      settingsPath: config.settingsPath,
      aiLogPath: config.aiLogPath,
      runtimeMode: 'headless',
      platform: config.platform,
      ...(config.trash ? { trash: config.trash } : {}),
      onEvent: (event) => {
        config.onEvent?.(event);
        transport?.publish(event);
      },
    });
  } catch (error) {
    await auth.close();
    throw error;
  }
  const registry = new CommandRegistry();
  const clientRoot = config.clientRoot ?? resolveServerClientRoot();
  try {
    registerServerCommands(registry, runtime.services, headlessHost);
    transport = new OpenTigServer({
      runtime,
      registry,
      clientRoot,
      auth,
      identity: { protocolVersion: OPEN_TIG_PROTOCOL_VERSION, appVersion: config.appVersion },
      ...(config.host === undefined ? {} : { host: config.host }),
      ...(config.port === undefined ? {} : { port: config.port }),
      ...(config.mode === undefined ? {} : { mode: config.mode }),
      ...(config.allowedOrigins === undefined ? {} : { allowedOrigins: config.allowedOrigins }),
      ...(config.logger === undefined ? {} : { logger: config.logger }),
      ...(config.commandTimeoutMs === undefined ? {} : { commandTimeoutMs: config.commandTimeoutMs }),
      ...(config.connectionLimit === undefined ? {} : { connectionLimit: config.connectionLimit }),
      ...(config.heartbeatMs === undefined ? {} : { heartbeatMs: config.heartbeatMs }),
      ...(config.requestRateLimit === undefined ? {} : { requestRateLimit: config.requestRateLimit }),
      ...(config.requestRateWindowMs === undefined ? {} : { requestRateWindowMs: config.requestRateWindowMs }),
    });
    const address = await transport.start();
    return {
      runtime,
      clientRoot,
      ...address,
      createPairingLink: () => pairingLink(address.origin, transport!.createPairingToken()),
      close: () => transport!.stop(),
    };
  } catch (error) {
    if (transport) await transport.stop();
    else await Promise.all([auth.close(), runtime.close()]);
    throw error;
  }
}

/** Assets resolve beside bundled server entry, never from process.cwd(). */
export function resolveServerClientRoot(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('./client/', moduleUrl));
}

function pairingLink(origin: string, pairing: { token: string; expiresAt: string }): { url: string; expiresAt: string } {
  const url = new URL('/pair', origin);
  url.hash = new URLSearchParams({ token: pairing.token }).toString();
  return { url: url.href, expiresAt: pairing.expiresAt };
}

const headlessHost: OpenTigHost = {
  capabilities: { nativePicker: false, fileClipboard: false, revealInFileManager: false },
  preferencesChanged: () => undefined,
  setTitleBarTheme: () => undefined,
  readClipboardFilePaths: async () => [],
  readClipboardImagePng: () => null,
  selectDirectory: async () => null,
  confirm: async () => false,
  revealItem: () => undefined,
};
