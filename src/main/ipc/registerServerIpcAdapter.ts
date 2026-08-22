import { ipcMain } from 'electron';
import type { CommandRegistry } from '../runtime/CommandRegistry';

export const DESKTOP_SESSION_ID = 'desktop';

/** Temporary transport adapter retained until Plan 002 replaces server IPC. */
export function registerServerIpcAdapter(
  registry: CommandRegistry,
  sessionId = DESKTOP_SESSION_ID,
): () => void {
  const channels = registry.registeredCommands();
  for (const channel of channels) {
    ipcMain.handle(channel, (_event, ...args) => registry.execute(sessionId, channel, args));
  }
  return () => {
    registry.clearSession(sessionId);
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
