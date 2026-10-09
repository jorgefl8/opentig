import { clipboard, dialog, nativeImage, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import type { Preferences } from '../../shared/contracts';
import { readClipboardFilePaths } from '../files/ClipboardFileTransfer';
import type { OpenTigHost } from '../runtime/OpenTigHost';
import { applyWindowTitleBarTheme } from '../window/WindowTitleBar';

export function createElectronHostAdapter(
  window: BrowserWindow,
  onPreferencesChanged?: (preferences: Preferences) => void,
): OpenTigHost {
  return {
    capabilities: {
      nativePicker: true,
      fileClipboard: true,
      revealInFileManager: true,
    },
    preferencesChanged: (preferences) => onPreferencesChanged?.(preferences),
    setTitleBarTheme: (dark) => applyWindowTitleBarTheme(window, dark),
    readClipboardFilePaths: () => readClipboardFilePaths(clipboard),
    readClipboardImagePng: async () => {
      const items = await clipboard.read();
      for (const type of ['image/png', 'image/jpeg'] as const) {
        for (const item of items) {
          if (!item.types.includes(type)) continue;
          const payload = await item.getType(type);
          const image = nativeImage.createFromBuffer(Buffer.from(await payload.arrayBuffer()));
          if (!image.isEmpty()) return image.toPNG();
        }
      }
      return null;
    },
    selectDirectory: async (title) => {
      const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title });
      return selection.canceled ? null : selection.filePaths[0] ?? null;
    },
    confirm: async (options) => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: options.title,
        message: options.message,
        detail: options.detail,
        buttons: [options.confirmLabel, 'Cancel'],
        defaultId: options.defaultAction === 'confirm' ? 0 : 1,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    },
    revealItem: (target) => shell.showItemInFolder(target),
  };
}
