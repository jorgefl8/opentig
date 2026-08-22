import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CutEntriesResult, IpcResult, RepositoryInfo } from '../../shared/contracts';
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
    get: vi.fn(() => repository),
    validatePaths: vi.fn((_repositoryId: string, paths: string[]) => paths),
    resolvePath: vi.fn((_repositoryId: string, filePath: string) => `C:\\repo\\${filePath}`),
    status: vi.fn(async () => ({
      changes: [{
        path: 'tracked.txt', kind: 'modified', indexStatus: ' ', worktreeStatus: 'M',
        staged: false, unstaged: true, conflict: false, submodule: '',
      }],
    })),
  };
  const operations = { discard: vi.fn(async () => undefined) };
  const files = {
    pastePaths: vi.fn(async () => ['destination.txt']),
    movePaths: vi.fn(async () => ['destination.txt']),
    pasteImage: vi.fn(async () => 'pasted-image.png'),
    snapshot: vi.fn(async () => null),
  };
  const fileHistory = {
    serialize: vi.fn(async (_repositoryId: string, action: () => Promise<unknown>) => action()),
    recordMove: vi.fn(),
    recordPaste: vi.fn(),
  };
  const trash = { available: true, trashItem: vi.fn(async () => undefined) };
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
    files,
    fileHistory,
    trash,
    value: {
      runtimeMode: 'desktop',
      platform: 'win32',
      repositories,
      watcher,
      github,
      ai,
      events,
      operations,
      files,
      fileHistory,
      trash,
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

  it('returns a native selected path without opening it', async () => {
    const fixture = services();
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\repo'] });
    registerHandlers(fixture.value);

    await expect(invoke<string | null>(IPC.repositorySelect)).resolves.toEqual({
      ok: true,
      value: 'C:\\repo',
    });
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(undefined, {
      properties: ['openDirectory'],
      title: 'Open Git repository',
    });
    expect(fixture.repositories.openPath).not.toHaveBeenCalled();
  });

  it('keeps native relocation selection separate from server validation', async () => {
    const fixture = services();
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\repo-moved'] });
    registerHandlers(fixture.value);

    await expect(invoke<string | null>(IPC.repositorySelectRelocation, 'repo', 'C:\\repo')).resolves.toEqual({
      ok: true,
      value: 'C:\\repo-moved',
    });
    await expect(invoke<RepositoryInfo>(IPC.repositoryRelocateRecent, 'repo-id', 'C:\\repo-moved')).resolves.toEqual({
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
    expect(fixture.watcher.start).toHaveBeenCalledWith(repository);
  });

  it('passes explicit paste sources to server-owned validation and copying', async () => {
    const fixture = services();
    registerHandlers(fixture.value);

    await expect(invoke(IPC.repositoryPasteEntries, 'repo-id', 'target', ['C:\\source.txt'], null, null)).resolves.toEqual({
      ok: true,
      value: { status: 'pasted', source: 'files', created: ['destination.txt'] },
    });
    expect(fixture.files.pastePaths).toHaveBeenCalledWith('repo-id', ['C:\\source.txt'], 'target');
    expect(fixture.fileHistory.recordPaste).toHaveBeenCalledOnce();
    expect(electron.clipboard.readText).not.toHaveBeenCalled();
  });

  it('moves a cut transfer only when the server-issued transfer id returns', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'opentig-cut-transfer-'));
    const source = path.join(temporary, 'source.txt');
    await writeFile(source, 'source');
    try {
      const fixture = services();
      fixture.repositories.resolvePath.mockReturnValue(source);
      fixture.repositories.get.mockReturnValue({ ...repository, path: temporary });
      registerHandlers(fixture.value);

      const cut = await invoke<CutEntriesResult>(IPC.repositoryCutEntries, 'repo-id', ['source.txt']);
      expect(cut.ok).toBe(true);
      if (!cut.ok) throw new Error(cut.error.message);
      const pasted = await invoke(IPC.repositoryPasteEntries, 'repo-id', 'target', [source], cut.value.transferId, null);

      expect(pasted).toEqual({
        ok: true,
        value: { status: 'pasted', source: 'cut', created: ['destination.txt'] },
      });
      expect(fixture.files.movePaths).toHaveBeenCalledWith('repo-id', [source], 'target');
      expect(fixture.files.pastePaths).not.toHaveBeenCalled();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
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

  it('uses server-owned system Trash for untracked discard', async () => {
    const fixture = services();
    fixture.repositories.status.mockResolvedValueOnce({
      changes: [{
        path: 'new.txt', kind: 'untracked', indexStatus: '?', worktreeStatus: '?',
        staged: false, unstaged: true, conflict: false, submodule: '',
      }],
    });
    registerHandlers(fixture.value);

    await expect(invoke(IPC.indexDiscard, 'repo-id', ['new.txt'])).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(fixture.operations.discard).toHaveBeenCalledWith('repo-id', []);
    expect(fixture.trash.trashItem).toHaveBeenCalledOnce();
    expect(fixture.trash.trashItem).toHaveBeenCalledWith('C:\\repo\\new.txt');
  });
});
