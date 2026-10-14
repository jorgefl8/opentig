import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as atomicWrite from './atomicWrite';
import { SettingsStore } from './SettingsStore';

const realAtomicWrite = atomicWrite.writeFileAtomically;
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-settings-writes-'));
  directories.push(directory);
  const file = path.join(directory, 'settings.json');
  const store = new SettingsStore(file);
  await store.load();
  const write = vi.spyOn(atomicWrite, 'writeFileAtomically');
  return { store, file, write };
}

async function expectTheme(file: string, theme: string) {
  for (const document of [file, atomicWrite.backupPathFor(file)]) {
    expect(JSON.parse(await readFile(document, 'utf8')).preferences.theme).toBe(theme);
  }
}

describe('SettingsStore unchanged writes', () => {
  it('skips unchanged saves after loading canonical primary and backup documents', async () => {
    const { file, write } = await fixture();
    await new SettingsStore(file).load();
    write.mockClear();
    const restarted = new SettingsStore(file);
    await restarted.load();
    await restarted.setPreferences({ theme: 'system' });
    await restarted.setWindowBounds(restarted.windowBounds);
    await restarted.flush();
    expect(write).not.toHaveBeenCalled();
    await expectTheme(file, 'system');
  });

  it('repairs a missing backup during load before treating the snapshot as persisted', async () => {
    const { file, write } = await fixture();
    await new SettingsStore(file).load();
    await rm(atomicWrite.backupPathFor(file));
    write.mockClear();
    const restarted = new SettingsStore(file);
    await restarted.load();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe(atomicWrite.backupPathFor(file));
    write.mockClear();
    await restarted.setPreferences({ theme: 'system' });
    expect(write).not.toHaveBeenCalled();
    await expectTheme(file, 'system');
  });

  it('settles equal queued saves only after the first primary and backup writes finish', async () => {
    const { store, file, write } = await fixture();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const realWrite = realAtomicWrite;
    write.mockImplementationOnce(async (...args) => { await blocked; await realWrite(...args); });
    let settled = false;
    const first = store.setPreferences({ theme: 'dark' });
    const equal = store.setPreferences({ theme: 'dark' }).then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    await Promise.all([first, equal, store.flush()]);
    expect(write).toHaveBeenCalledTimes(2);
    await expectTheme(file, 'dark');
  });

  it('preserves intervening queued changes when returning to the persisted value', async () => {
    const { store, file, write } = await fixture();
    await Promise.all([
      store.setPreferences({ theme: 'dark' }),
      store.setPreferences({ theme: 'system' }),
      store.setPreferences({ theme: 'system' }),
    ]);
    expect(write).toHaveBeenCalledTimes(4);
    await expectTheme(file, 'system');
  });

  it.each(['primary', 'backup'] as const)('retries an equal save after a failed %s write', async (failed) => {
    const { store, file, write } = await fixture();
    const realWrite = realAtomicWrite;
    if (failed === 'backup') write.mockImplementationOnce(realWrite);
    write.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(store.setPreferences({ theme: 'dark' })).rejects.toThrow('disk unavailable');
    write.mockClear();
    await store.setPreferences({ theme: 'dark' });
    expect(write).toHaveBeenCalledTimes(2);
    await expectTheme(file, 'dark');
  });

  it('retries an equal queued save instead of inheriting an earlier failed write', async () => {
    const { store, file, write } = await fixture();
    write.mockRejectedValueOnce(new Error('disk unavailable'));
    const first = store.setPreferences({ theme: 'dark' });
    const second = store.setPreferences({ theme: 'dark' });
    await expect(first).rejects.toThrow('disk unavailable');
    await second;
    expect(write).toHaveBeenCalledTimes(3);
    await expectTheme(file, 'dark');
  });

  it('repairs the primary when reverting after the backup failed', async () => {
    const { store, file, write } = await fixture();
    write.mockImplementationOnce(realAtomicWrite).mockRejectedValueOnce(new Error('backup unavailable'));
    await expect(store.setPreferences({ theme: 'dark' })).rejects.toThrow('backup unavailable');
    write.mockClear();
    await store.setPreferences({ theme: 'system' });
    expect(write).toHaveBeenCalledTimes(2);
    await expectTheme(file, 'system');
  });

  it('flushes pending background state during an otherwise unchanged preference save', async () => {
    const { store, file, write } = await fixture();
    store.setFilesTreeExpandedPaths('0123456789abcdef', ['src']);
    await store.setPreferences({ theme: 'system' });
    await store.flush();
    expect(write).toHaveBeenCalledTimes(2);
    for (const document of [file, atomicWrite.backupPathFor(file)]) {
      expect(JSON.parse(await readFile(document, 'utf8')).filesTreeStates[0].expandedPaths).toEqual(['src']);
    }
  });

  it('reports background failures through flush and persists the retry', async () => {
    const { store, file, write } = await fixture();
    store.setOpenFilesState('0123456789abcdef', [{ path: 'src/a.ts', pinned: true }], 'src/a.ts', null);
    write.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(store.flush()).rejects.toThrow('disk unavailable');
    await store.flush();
    for (const document of [file, atomicWrite.backupPathFor(file)]) {
      expect(JSON.parse(await readFile(document, 'utf8')).openFilesStates[0].activePath).toBe('src/a.ts');
    }
  });
});
