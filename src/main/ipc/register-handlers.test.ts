import type { IpcResult, RepositoryInfo } from '../../shared/contracts';
import { IPC } from '../../shared/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  return {
    handlers,
    clipboard: {
      readText: vi.fn(),
      writeText: vi.fn(),
    },
    dialog: {
      showMessageBox: vi.fn(),
      showOpenDialog: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
      showItemInFolder: vi.fn(),
      trashItem: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  clipboard: electron.clipboard,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  shell: electron.shell,
}));

import { registerHandlers } from './register-handlers';

type Services = Parameters<typeof registerHandlers>[0];

const repository: RepositoryInfo = {
  id: 'repo-id',
  name: 'main',
  repositoryName: 'repo',
  path: 'C:\\repo',
  commonDir: 'C:\\repo\\.git',
};

function services() {
  const repositories = {
    openPath: vi.fn(async () => repository),
    openRecent: vi.fn(async () => repository),
    recent: vi.fn(() => ({ ...repository, lastOpenedAt: '2026-08-22T00:00:00.000Z' })),
    relocateRecent: vi.fn(async () => repository),
    validatePaths: vi.fn((_repositoryId: string, paths: string[]) => paths),
    status: vi.fn(async () => ({
      changes: [{
        path: 'tracked.txt', kind: 'modified', indexStatus: ' ', worktreeStatus: 'M',
        staged: false, unstaged: true, conflict: false, submodule: '',
      }],
    })),
  };
  const operations = { discard: vi.fn(async () => undefined) };
  const watcher = { start: vi.fn() };
  const github = {
    status: vi.fn(async () => ({
      installed: true,
      availability: 'ready' as const,
      authStatus: 'authenticated' as const,
      checkedAt: '2026-08-22T00:00:00.000Z',
    })),
  };
  const ai = {
    statuses: vi.fn(async () => [{
      id: 'codex' as const,
      label: 'Codex',
      availability: 'ready' as const,
      installed: true,
      authStatus: 'authenticated' as const,
      models: [],
      checkedAt: '2026-08-22T00:00:00.000Z',
    }]),
  };
  const events = { activeRepositoryChanged: vi.fn(), repositoryChanged: vi.fn() };
  return {
    repositories,
    watcher,
    github,
    ai,
    events,
    operations,
    value: {
      runtimeMode: 'desktop',
      platform: 'win32',
      repositories,
      watcher,
      github,
      ai,
      events,
      operations,
    } as unknown as Services,
  };
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler({}, ...args) as Promise<IpcResult<T>>;
}

describe('server IPC ownership additions', () => {
  beforeEach(() => electron.handlers.clear());

  it('registers every request channel exactly once', () => {
    const removeHandlers = registerHandlers(services().value);

    expect([...electron.handlers.keys()].sort()).toEqual(
      Object.values(IPC).filter((channel) => channel !== IPC.repositoryChanged).sort(),
    );
    removeHandlers();
  });

  it('opens an explicit repository path and starts its watcher', async () => {
    const fixture = services();
    registerHandlers(fixture.value);

    await expect(invoke<RepositoryInfo>(IPC.repositoryOpenPath, 'C:\\repo')).resolves.toEqual({
      ok: true,
      value: repository,
    });
    expect(fixture.repositories.openPath).toHaveBeenCalledWith('C:\\repo');
    expect(fixture.watcher.start).toHaveBeenCalledWith(repository);
    expect(fixture.events.activeRepositoryChanged).toHaveBeenCalledWith(repository);
  });

  it('reports serializable desktop capabilities and dependency status', async () => {
    const fixture = services();
    registerHandlers(fixture.value);

    const result = await invoke(IPC.capabilities);

    expect(result).toMatchObject({
      ok: true,
      value: {
        runtimeMode: 'desktop',
        systemTrash: true,
        nativePicker: true,
        fileClipboard: true,
        revealInFileManager: true,
        githubCli: { availability: 'ready' },
        aiProviders: [{ id: 'codex', availability: 'ready' }],
      },
    });
    expect(fixture.github.status).toHaveBeenCalledOnce();
    expect(fixture.ai.statuses).toHaveBeenCalledOnce();
  });

  it('keeps native selection as a thin adapter over server openPath', async () => {
    const fixture = services();
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\repo'] });
    registerHandlers(fixture.value);

    await expect(invoke<RepositoryInfo | null>(IPC.repositorySelect)).resolves.toEqual({
      ok: true,
      value: repository,
    });
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(undefined, {
      properties: ['openDirectory'],
      title: 'Open Git repository',
    });
    expect(fixture.repositories.openPath).toHaveBeenCalledWith('C:\\repo');
  });

  it('preserves relocation confirmation and native picker behavior', async () => {
    const fixture = services();
    fixture.repositories.openRecent.mockRejectedValueOnce(new Error('moved'));
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\repo-moved'] });
    registerHandlers(fixture.value);

    await expect(invoke<RepositoryInfo | null>(IPC.repositoryOpenRecent, 'repo-id')).resolves.toEqual({
      ok: true,
      value: repository,
    });
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(undefined, expect.objectContaining({
      buttons: ['Locate repository', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    }));
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(undefined, {
      properties: ['openDirectory'],
      title: 'Locate repo',
    });
    expect(fixture.repositories.relocateRecent).toHaveBeenCalledWith('repo-id', 'C:\\repo-moved');
  });

  it('executes discard without asking the Electron host for confirmation', async () => {
    const fixture = services();
    registerHandlers(fixture.value);

    await expect(invoke(IPC.indexDiscard, 'repo-id', ['tracked.txt'])).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(fixture.operations.discard).toHaveBeenCalledWith('repo-id', ['tracked.txt']);
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
