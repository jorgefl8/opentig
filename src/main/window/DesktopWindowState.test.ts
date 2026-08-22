import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopWindowState } from './DesktopWindowState';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DesktopWindowState', () => {
  it('preserves legacy bounds before the desktop-owned file exists', async () => {
    const fixture = await createFixture({ windowBounds: { width: 1440, height: 900, x: 40, y: 50 } });
    await expect(fixture.store.load()).resolves.toEqual({ width: 1440, height: 900, x: 40, y: 50 });
  });

  it('prefers and atomically persists desktop-owned bounds', async () => {
    const fixture = await createFixture({ windowBounds: { width: 1000, height: 700 } });
    await fixture.store.save({ width: 1600, height: 1000, x: 20, y: 30 });
    await fixture.store.flush();

    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual({ width: 1600, height: 1000, x: 20, y: 30 });
    await expect(fixture.store.load()).resolves.toEqual({ width: 1600, height: 1000, x: 20, y: 30 });
  });

  it('repairs invalid state to safe minimum bounds', async () => {
    const fixture = await createFixture({ windowBounds: { width: 'bad', height: 1 } });
    await expect(fixture.store.load()).resolves.toEqual({ width: 1280, height: 800 });
    await fixture.store.save({ width: 200, height: 100 });
    await expect(fixture.store.load()).resolves.toEqual({ width: 900, height: 600 });
  });
});

async function createFixture(legacy: unknown): Promise<{ store: DesktopWindowState; filePath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-window-state-'));
  directories.push(directory);
  const filePath = path.join(directory, 'desktop-window.json');
  const legacyPath = path.join(directory, 'settings.json');
  await writeFile(legacyPath, JSON.stringify(legacy));
  return { store: new DesktopWindowState(filePath, legacyPath), filePath };
}
