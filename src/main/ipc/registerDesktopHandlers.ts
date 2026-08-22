import { lstat } from 'node:fs/promises';
import { ipcMain } from 'electron';
import type { IpcResult } from '../../shared/contracts';
import { OPEN_TIG_DESKTOP_IPC } from '../../shared/desktop-api';
import { serializeError } from '../../shared/errors';
import type { RepositoryService } from '../git/RepositoryService';
import type { OpenTigHost } from '../runtime/OpenTigHost';
import { booleanArg, stringArg } from '../runtime/validators';

export function registerDesktopHandlers(
  repositories: RepositoryService,
  host: OpenTigHost,
  onDoubleControlShortcutChanged?: (enabled: boolean) => void,
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

  handle(OPEN_TIG_DESKTOP_IPC.preferencesChanged, 'desktop-preferences-changed', (preferences) => {
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      throw new Error('Invalid desktop preferences.');
    }
    const enabled = booleanArg(
      (preferences as Record<string, unknown>).doubleControlShortcutEnabled,
      'desktop-preferences-changed',
    );
    onDoubleControlShortcutChanged?.(enabled);
  });
  handle(OPEN_TIG_DESKTOP_IPC.titleBarTheme, 'title-bar-theme', (dark) => {
    host.setTitleBarTheme(booleanArg(dark, 'title-bar-theme'));
  });
  handle(OPEN_TIG_DESKTOP_IPC.clipboardReadFilePaths, 'clipboard-read-file-paths', () => host.readClipboardFilePaths());
  handle(OPEN_TIG_DESKTOP_IPC.clipboardReadImagePng, 'clipboard-read-image-png', () => host.readClipboardImagePng());

  handle(OPEN_TIG_DESKTOP_IPC.repositorySelect, 'select-repository', (title) => host.selectDirectory(
    title === undefined ? 'Open Git repository' : stringArg(title, 'select-repository', 256),
  ));
  handle(OPEN_TIG_DESKTOP_IPC.repositorySelectRelocation, 'select-repository-relocation', async (repositoryName, previousPath) => {
    const name = stringArg(repositoryName, 'select-repository-relocation', 512);
    const oldPath = stringArg(previousPath, 'select-repository-relocation', 32_768);
    const locate = await host.confirm({
      title: 'Repository unavailable',
      message: `OpenTig could not open ${name}.`,
      detail: `${oldPath}\n\nIf the repository moved, locate its new folder. Its project assignment, open tabs, and expanded folders will be preserved.`,
      confirmLabel: 'Locate repository',
      defaultAction: 'confirm',
    });
    return locate ? host.selectDirectory(`Locate ${name}`) : null;
  });

  handle(OPEN_TIG_DESKTOP_IPC.repositoryRevealEntry, 'reveal-entry', async (id, filePath) => {
    const repositoryId = stringArg(id, 'reveal-entry', 64);
    const relativePath = stringArg(filePath, 'reveal-entry');
    const target = repositories.resolvePath(repositoryId, relativePath);
    await lstat(target);
    host.revealItem(target);
  });

  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}
