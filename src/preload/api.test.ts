import type { IpcRenderer } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IPC, type OpenTigCapabilities, type RepositoryInfo } from '../shared/contracts';
import { createApi } from './api';

function createRenderer() {
  const invoke = vi.fn();
  const renderer = {
    invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as IpcRenderer;
  return { renderer, invoke };
}

describe('preload API ownership additions', () => {
  it('requests serializable runtime capabilities', async () => {
    const { renderer, invoke } = createRenderer();
    const capabilities: OpenTigCapabilities = {
      runtimeMode: 'desktop',
      platform: 'win32',
      systemTrash: true,
      nativePicker: true,
      fileClipboard: true,
      revealInFileManager: true,
      githubCli: {
        installed: true,
        availability: 'ready',
        authStatus: 'authenticated',
        checkedAt: '2026-08-22T00:00:00.000Z',
      },
      aiProviders: [],
    };
    invoke.mockResolvedValueOnce({ ok: true, value: capabilities });

    await expect(createApi(renderer, vi.fn()).app.capabilities()).resolves.toEqual(capabilities);
    expect(invoke).toHaveBeenCalledWith(IPC.capabilities);
  });

  it('opens a typed server path without changing native selection', async () => {
    const { renderer, invoke } = createRenderer();
    const repository: RepositoryInfo = {
      id: 'repo-id',
      name: 'main',
      repositoryName: 'repo',
      path: 'C:\\repo',
      commonDir: 'C:\\repo\\.git',
    };
    invoke
      .mockResolvedValueOnce({ ok: true, value: repository })
      .mockResolvedValueOnce({ ok: true, value: repository });
    const api = createApi(renderer, vi.fn());

    await expect(api.repository.openPath('C:\\repo')).resolves.toEqual(repository);
    await expect(api.repository.select()).resolves.toEqual(repository);
    expect(invoke).toHaveBeenNthCalledWith(1, IPC.repositoryOpenPath, 'C:\\repo');
    expect(invoke).toHaveBeenNthCalledWith(2, IPC.repositorySelect);
  });
});
