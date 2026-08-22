import { fileURLToPath } from 'node:url';
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
  close(): Promise<void>;
}

/**
 * Single construction boundary shared by future CLI and utility-process
 * adapters. HTTP/WebSocket ownership is added in Step 2; current desktop boot
 * remains untouched as rollback path.
 */
export async function runOpenTigServer(config: OpenTigServerConfig): Promise<RunningOpenTigServer> {
  let transport: OpenTigServer | null = null;
  const runtime = await createOpenTigRuntime({
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
  const registry = new CommandRegistry();
  registerServerCommands(registry, runtime.services, headlessHost);
  const clientRoot = config.clientRoot ?? resolveServerClientRoot();
  transport = new OpenTigServer({
    runtime,
    registry,
    clientRoot,
    auth: new OpenTigSessionAuth(config.auth, config.secureCookies),
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
  try {
    const address = await transport.start();
    return { runtime, clientRoot, ...address, close: () => transport!.stop() };
  } catch (error) {
    await transport.stop();
    throw error;
  }
}

/** Assets resolve beside bundled server entry, never from process.cwd(). */
export function resolveServerClientRoot(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('./client/', moduleUrl));
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
