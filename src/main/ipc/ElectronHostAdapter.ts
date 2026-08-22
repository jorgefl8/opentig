import { clipboard, dialog, shell } from 'electron';
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
      systemTrash: true,
      nativePicker: true,
      fileClipboard: true,
      revealInFileManager: true,
    },
    preferencesChanged: (preferences) => onPreferencesChanged?.(preferences),
    setTitleBarTheme: (dark) => applyWindowTitleBarTheme(window, dark),
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (text) => clipboard.writeText(text),
    readClipboardFilePaths: () => readClipboardFilePaths(clipboard),
    readClipboardImagePng: () => {
      const image = clipboard.readImage();
      return image.isEmpty() ? null : image.toPNG();
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
    openExternal: (url) => shell.openExternal(url),
    trashItem: (target) => shell.trashItem(target),
    revealItem: (target) => shell.showItemInFolder(target),
  };
}
