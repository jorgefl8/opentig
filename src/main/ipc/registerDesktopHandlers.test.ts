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
  const webAccess = {
    getStatus: vi.fn(async () => ({
      enabled: false,
      serverState: 'ready' as const,
      actualPort: 6767,
      localEndpoint: 'http://127.0.0.1:6767',
      networkEndpoints: ['http://192.168.1.50:6767'],
      pairingEndpoints: ['http://127.0.0.1:6767'],
      externalOrigin: null,
      connectedSessionCount: 1,
      restartError: null,
    })),
    setEnabled: vi.fn(async (enabled: boolean) => ({
      enabled,
      serverState: 'ready' as const,
      actualPort: 6767,
      localEndpoint: 'http://127.0.0.1:6767',
      networkEndpoints: ['http://192.168.1.50:6767'],
      pairingEndpoints: ['http://127.0.0.1:6767'],
      externalOrigin: null,
      connectedSessionCount: 1,
      restartError: null,
    })),
    setExternalOrigin: vi.fn(async (externalOrigin: string | null) => ({
      enabled: false,
      serverState: 'ready' as const,
      actualPort: 6767,
      localEndpoint: 'http://127.0.0.1:6767',
      networkEndpoints: ['http://192.168.1.50:6767'],
      pairingEndpoints: ['http://127.0.0.1:6767', ...(externalOrigin ? [externalOrigin] : [])],
      externalOrigin,
      connectedSessionCount: 1,
      restartError: null,
    })),
    createPairingLink: vi.fn(async () => ({ url: 'http://192.168.1.50:6767/pair#token=secret', expiresAt: '2030-01-01T00:00:00.000Z' })),
  };
  return { host, webAccess };
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
    registerDesktopHandlers(value.host, undefined, value.webAccess);

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

  it('keeps network exposure behind validated desktop-only handlers', async () => {
    electron.handlers.clear();
    const value = fixture();
    registerDesktopHandlers(value.host, undefined, value.webAccess);

    await expect(invoke(OPEN_TIG_DESKTOP_IPC.webAccessSetEnabled, true)).resolves.toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ enabled: true }),
    }));
    expect(value.webAccess.setEnabled).toHaveBeenCalledWith(true);
    await expect(invoke(OPEN_TIG_DESKTOP_IPC.webAccessSetExternalOrigin, 'https://opentig.example.com')).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(value.webAccess.setExternalOrigin).toHaveBeenCalledWith('https://opentig.example.com');
    await expect(invoke(OPEN_TIG_DESKTOP_IPC.webAccessSetEnabled, 'yes')).resolves.toEqual(expect.objectContaining({ ok: false }));
    await expect(invoke(OPEN_TIG_DESKTOP_IPC.webAccessCreatePairingLink, 'http://192.168.1.50:6767')).resolves.toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ url: expect.stringContaining('#token=') }),
    }));
    expect(value.webAccess.createPairingLink).toHaveBeenCalledWith('http://192.168.1.50:6767');
  });

  it('accepts only an absolute server-resolved reveal target', async () => {
    electron.handlers.clear();
    const value = fixture();
    registerDesktopHandlers(value.host);

    await expect(invoke(OPEN_TIG_DESKTOP_IPC.repositoryRevealEntry, 'relative.txt')).resolves.toEqual(expect.objectContaining({ ok: false }));
    expect(value.host.revealItem).not.toHaveBeenCalled();
  });
});
