import type { IpcRenderer } from 'electron';
import type { IpcResult } from '../shared/contracts';
import { OPEN_TIG_DESKTOP_IPC, type OpenTigDesktopApi } from '../shared/desktop-api';

/** Narrow Electron-only bridge. Domain work is never exposed through preload. */
export function createDesktopApi(
  ipcRenderer: IpcRenderer,
  setZoomFactor: (factor: number) => void,
): OpenTigDesktopApi {
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const result = await ipcRenderer.invoke(channel, ...args) as IpcResult<T>;
    if (result.ok) return result.value;
    const error = new Error(result.error.message) as Error & { detail?: typeof result.error };
    error.detail = result.error;
    throw error;
  };

  return {
    app: {
      preferencesChanged: (preferences) => invoke(OPEN_TIG_DESKTOP_IPC.preferencesChanged, preferences),
      setZoomFactor: (factor) => setZoomFactor(Math.max(0.8, Math.min(1.3, Number(factor) || 1))),
      setTitleBarTheme: (dark) => invoke(OPEN_TIG_DESKTOP_IPC.titleBarTheme, dark),
    },
    clipboard: {
      readFilePaths: () => invoke(OPEN_TIG_DESKTOP_IPC.clipboardReadFilePaths),
      readImagePng: () => invoke(OPEN_TIG_DESKTOP_IPC.clipboardReadImagePng),
    },
    repository: {
      select: (title) => title === undefined
        ? invoke(OPEN_TIG_DESKTOP_IPC.repositorySelect)
        : invoke(OPEN_TIG_DESKTOP_IPC.repositorySelect, title),
      selectRelocation: (repositoryName, previousPath) => invoke(
        OPEN_TIG_DESKTOP_IPC.repositorySelectRelocation,
        repositoryName,
        previousPath,
      ),
      revealEntry: (target) => invoke(OPEN_TIG_DESKTOP_IPC.repositoryRevealEntry, target),
    },
  };
}
