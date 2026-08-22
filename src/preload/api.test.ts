import type { IpcRenderer } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_TIG_DESKTOP_IPC } from '../shared/desktop-api';
import { createDesktopApi } from './api';

function renderer() {
  const invoke = vi.fn(async () => ({ ok: true, value: undefined }));
  return { invoke, value: { invoke } as unknown as IpcRenderer };
}

describe('preload desktop API', () => {
  it('exposes only the narrow desktop surface', async () => {
    const ipc = renderer();
    const setZoom = vi.fn();
    const api = createDesktopApi(ipc.value, setZoom);

    expect(Object.keys(api).sort()).toEqual(['app', 'clipboard', 'repository']);
    expect(Object.keys(api.repository).sort()).toEqual(['revealEntry', 'select', 'selectRelocation']);
    expect('commits' in api).toBe(false);
    expect('github' in api).toBe(false);

    api.app.setZoomFactor(2);
    await api.app.setTitleBarTheme(true);
    await api.repository.revealEntry('C:\\repo\\file.txt');
    expect(setZoom).toHaveBeenCalledWith(1.3);
    expect(ipc.invoke).toHaveBeenCalledWith(OPEN_TIG_DESKTOP_IPC.titleBarTheme, true);
    expect(ipc.invoke).toHaveBeenCalledWith(OPEN_TIG_DESKTOP_IPC.repositoryRevealEntry, 'C:\\repo\\file.txt');
  });
});
