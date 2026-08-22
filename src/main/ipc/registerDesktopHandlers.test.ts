import { describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '../../shared/contracts';
import { OPEN_TIG_DESKTOP_IPC } from '../../shared/desktop-api';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { registerDesktopHandlers } from './registerDesktopHandlers';

function fixture() {
  const host = {
    capabilities: { nativePicker: true, fileClipboard: true, revealInFileManager: true },
    preferencesChanged: vi.fn(),
    setTitleBarTheme: vi.fn(),
    readClipboardFilePaths: vi.fn(async () => ['C:\\source.txt']),
    readClipboardImagePng: vi.fn(() => null),
    selectDirectory: vi.fn(async () => 'C:\\repo'),
    confirm: vi.fn(async () => true),
    revealItem: vi.fn(),
  };
  return { host };
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return handler({}, ...args) as Promise<IpcResult<T>>;
}

describe('desktop IPC boundary', () => {
  it('registers only the named native desktop channels', () => {
    electron.handlers.clear();
    const value = fixture();
    registerDesktopHandlers(value.host);

    expect([...electron.handlers.keys()].sort()).toEqual(Object.values(OPEN_TIG_DESKTOP_IPC).sort());
    expect([...electron.handlers.keys()].every((channel) => channel.startsWith('desktop:'))).toBe(true);
  });

  it('reports validated preference changes to Electron', async () => {
    electron.handlers.clear();
    const changed = vi.fn();
    const value = fixture();
    registerDesktopHandlers(value.host, changed);

    await expect(invoke(OPEN_TIG_DESKTOP_IPC.preferencesChanged, {
      doubleControlShortcutEnabled: true,
    })).resolves.toEqual({ ok: true, value: undefined });
    expect(changed).toHaveBeenCalledWith(true);
  });

  it('keeps directory selection native without opening a repository', async () => {
    electron.handlers.clear();
    const value = fixture();
    registerDesktopHandlers(value.host);

    await expect(invoke(OPEN_TIG_DESKTOP_IPC.repositorySelect)).resolves.toEqual({
      ok: true,
      value: 'C:\\repo',
    });
    expect(value.host.selectDirectory).toHaveBeenCalledWith('Open Git repository');
  });

  it('accepts only an absolute server-resolved reveal target', async () => {
    electron.handlers.clear();
    const value = fixture();
    registerDesktopHandlers(value.host);

    await expect(invoke(OPEN_TIG_DESKTOP_IPC.repositoryRevealEntry, 'relative.txt')).resolves.toEqual(expect.objectContaining({ ok: false }));
    expect(value.host.revealItem).not.toHaveBeenCalled();
  });
});
