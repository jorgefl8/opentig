import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { ipcMain } from 'electron';
import type { IpcResult } from '../../shared/contracts';
import {
  OPEN_TIG_DESKTOP_IPC,
  type OpenTigPairingLink,
  type OpenTigWebAccessStatus,
} from '../../shared/desktop-api';
import { serializeError } from '../../shared/errors';
import type { OpenTigHost } from '../runtime/OpenTigHost';
import { booleanArg, stringArg } from '../runtime/validators';

export function registerDesktopHandlers(
  host: OpenTigHost,
  onDoubleControlShortcutChanged?: (enabled: boolean) => void,
  webAccess?: {
    getStatus(): Promise<OpenTigWebAccessStatus>;
    setEnabled(enabled: boolean): Promise<OpenTigWebAccessStatus>;
    setExternalOrigin(origin: string | null): Promise<OpenTigWebAccessStatus>;
    createPairingLink(endpoint: string): Promise<OpenTigPairingLink>;
  },
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

  handle(OPEN_TIG_DESKTOP_IPC.repositoryRevealEntry, 'reveal-entry', async (value) => {
    const target = stringArg(value, 'reveal-entry', 32_768);
    if (!path.isAbsolute(target)) throw new Error('Reveal requires an absolute path.');
    await lstat(target);
    host.revealItem(target);
  });

  handle(OPEN_TIG_DESKTOP_IPC.webAccessStatus, 'web-access-status', () => requireWebAccess(webAccess).getStatus());
  handle(OPEN_TIG_DESKTOP_IPC.webAccessSetEnabled, 'web-access-set-enabled', (enabled) => (
    requireWebAccess(webAccess).setEnabled(booleanArg(enabled, 'web-access-set-enabled'))
  ));
  handle(OPEN_TIG_DESKTOP_IPC.webAccessSetExternalOrigin, 'web-access-set-external-origin', (origin) => (
    requireWebAccess(webAccess).setExternalOrigin(origin === null ? null : stringArg(origin, 'web-access-set-external-origin', 2_048))
  ));
  handle(OPEN_TIG_DESKTOP_IPC.webAccessCreatePairingLink, 'web-access-create-pairing-link', (endpoint) => (
    requireWebAccess(webAccess).createPairingLink(stringArg(endpoint, 'web-access-create-pairing-link', 2_048))
  ));
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}

function requireWebAccess<T>(value: T | undefined): T {
  if (!value) throw new Error('Web Access controls are unavailable.');
  return value;
}
