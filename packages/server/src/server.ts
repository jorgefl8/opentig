import { fileURLToPath } from 'node:url';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import {
  createOpenTigRuntime,
  type CreateOpenTigRuntimeOptions,
} from '../../../src/main/runtime/create-runtime';

export interface OpenTigServerConfig extends Omit<CreateOpenTigRuntimeOptions, 'runtimeMode'> {
  clientRoot?: string;
}

export interface RunningOpenTigServer {
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
  const runtime = await createOpenTigRuntime({
    settingsPath: config.settingsPath,
    aiLogPath: config.aiLogPath,
    runtimeMode: 'headless',
    platform: config.platform,
    ...(config.trash ? { trash: config.trash } : {}),
    onEvent: config.onEvent,
  });
  return {
    runtime,
    clientRoot: config.clientRoot ?? resolveServerClientRoot(),
    close: () => runtime.close(),
  };
}

/** Assets resolve beside bundled server entry, never from process.cwd(). */
export function resolveServerClientRoot(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('./client/', moduleUrl));
}
