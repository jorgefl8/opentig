import { lstat } from 'node:fs/promises';
import { ipcMain } from 'electron';
import type { IpcResult, RepositoryInfo } from '../../shared/contracts';
import { IPC } from '../../shared/contracts';
import { GitOperationError, serializeError } from '../../shared/errors';
import type { RepositoryService } from '../git/RepositoryService';
import type { CommandRegistry } from '../runtime/CommandRegistry';
import type { OpenTigHost } from '../runtime/OpenTigHost';
import { FILE_CLIPBOARD_SESSION_STATE } from '../runtime/registerServerCommands';
import { booleanArg, stringArg, textArg } from '../runtime/validators';
import { DESKTOP_SESSION_ID } from './registerServerIpcAdapter';

export function registerDesktopHandlers(
  registry: CommandRegistry,
  repositories: RepositoryService,
  host: OpenTigHost,
): () => void {
  const channels: string[] = [];
  const handle = <T>(
    channel: string,
    operation: string,
    handler: (...args: unknown[]) => Promise<T> | T,
  ) => {
    channels.push(channel);
    ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
      try { return { ok: true, value: await handler(...args) }; }
      catch (error) { return { ok: false, error: serializeError(error, operation) }; }
    });
  };

  handle(IPC.titleBarTheme, 'title-bar-theme', (dark) => {
    host.setTitleBarTheme(booleanArg(dark, 'title-bar-theme'));
  });
  handle(IPC.clipboardReadText, 'clipboard-read-text', () => host.readClipboardText());
  handle(IPC.clipboardWriteText, 'clipboard-write-text', (text) => {
    registry.clearSessionState(DESKTOP_SESSION_ID, FILE_CLIPBOARD_SESSION_STATE);
    host.writeClipboardText(textArg(text, 'clipboard-write-text', 8 * 1024 * 1024));
  });
  handle(IPC.shellOpenExternal, 'open-external', async (url) => {
    const value = stringArg(url, 'open-external', 2_048);
    let parsed: URL;
    try { parsed = new URL(value); } catch {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'open-external', message: 'Invalid URL.' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'mailto:') {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'open-external', message: 'Only web or mail links can be opened.' });
    }
    await host.openExternal(parsed.toString());
  });

  channels.push(IPC.repositorySelect);
  ipcMain.handle(IPC.repositorySelect, async (): Promise<IpcResult<RepositoryInfo | null>> => {
    try {
      const selectedPath = await host.selectDirectory('Open Git repository');
      if (!selectedPath) return { ok: true, value: null };
      return registry.execute(DESKTOP_SESSION_ID, IPC.repositoryOpenPath, [selectedPath]);
    } catch (error) {
      return { ok: false, error: serializeError(error, 'select-repository') };
    }
  });

  handle(IPC.repositoryRevealEntry, 'reveal-entry', async (id, filePath) => {
    const repositoryId = stringArg(id, 'reveal-entry', 64);
    const relativePath = stringArg(filePath, 'reveal-entry');
    const target = repositories.resolvePath(repositoryId, relativePath);
    await lstat(target);
    host.revealItem(target);
  });

  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}
