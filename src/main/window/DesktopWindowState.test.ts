import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  boundsVisibleOnDisplays,
  browserWindowBounds,
  DesktopWindowState,
} from './DesktopWindowState';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DesktopWindowState', () => {
  it('preserves legacy bounds before the desktop-owned file exists', async () => {
    const fixture = await createFixture({ windowBounds: { width: 1440, height: 900, x: 40, y: 50 } });
    await expect(fixture.store.load()).resolves.toEqual({ width: 1440, height: 900, x: 40, y: 50, isMaximized: false });
  });

  it('prefers and atomically persists desktop-owned bounds', async () => {
    const fixture = await createFixture({ windowBounds: { width: 1000, height: 700 } });
    await fixture.store.save({ width: 1600, height: 1000, x: 20, y: 30, isMaximized: false });
    await fixture.store.flush();

    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual({
      width: 1600, height: 1000, x: 20, y: 30, isMaximized: false,
    });
    await expect(fixture.store.load()).resolves.toEqual({ width: 1600, height: 1000, x: 20, y: 30, isMaximized: false });
  });

  it('round-trips the maximized flag separately from normal bounds', async () => {
    const fixture = await createFixture({ windowBounds: { width: 1000, height: 700 } });
    await fixture.store.save({ width: 1280, height: 800, x: 80, y: 40, isMaximized: true });
    await expect(fixture.store.load()).resolves.toEqual({
      width: 1280, height: 800, x: 80, y: 40, isMaximized: true,
    });
  });

  it('treats a missing maximized flag as restored-normal', async () => {
    const fixture = await createFixture({ windowBounds: { width: 1440, height: 900, x: 12, y: 24 } });
    await writeFile(fixture.filePath, `${JSON.stringify({ width: 1440, height: 900, x: 12, y: 24 })}\n`);
    await expect(fixture.store.load()).resolves.toEqual({
      width: 1440, height: 900, x: 12, y: 24, isMaximized: false,
    });
  });

  it('repairs invalid state to safe minimum bounds', async () => {
    const fixture = await createFixture({ windowBounds: { width: 'bad', height: 1 } });
    await expect(fixture.store.load()).resolves.toEqual({ width: 1280, height: 800, isMaximized: false });
    await fixture.store.save({ width: 200, height: 100, isMaximized: false });
    await expect(fixture.store.load()).resolves.toEqual({ width: 900, height: 600, isMaximized: false });
  });
});

describe('browserWindowBounds', () => {
  it('omits the maximized flag from BrowserWindow constructor options', () => {
    expect(browserWindowBounds({ width: 1280, height: 800, x: 10, y: 20, isMaximized: true })).toEqual({
      width: 1280, height: 800, x: 10, y: 20,
    });
  });
});

describe('boundsVisibleOnDisplays', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };

  it('keeps on-screen position', () => {
    expect(boundsVisibleOnDisplays({ width: 1280, height: 800, x: 100, y: 80 }, [primary])).toEqual({
      width: 1280, height: 800, x: 100, y: 80,
    });
  });

  it('centers a disconnected-monitor position on the primary display', () => {
    expect(boundsVisibleOnDisplays({ width: 1280, height: 800, x: 8000, y: 40 }, [primary])).toEqual({
      width: 1280, height: 800, x: 320, y: 140,
    });
  });

  it('recovers a window with only a sliver visible at the left edge', () => {
    expect(boundsVisibleOnDisplays({ width: 1280, height: 800, x: -970, y: 30 }, [primary])).toEqual({
      width: 1280, height: 800, x: 0, y: 30,
    });
  });

  it('keeps the title bar and bottom edge inside the available work area', () => {
    const area = { x: 40, y: 60, width: 1500, height: 900 };
    expect(boundsVisibleOnDisplays({ width: 1280, height: 800, x: 100, y: -700 }, [area])).toEqual({
      width: 1280, height: 800, x: 100, y: 60,
    });
    expect(boundsVisibleOnDisplays({ width: 1280, height: 800, x: 1200, y: 800 }, [area])).toEqual({
      width: 1280, height: 800, x: 260, y: 160,
    });
  });

  it('preserves valid negative coordinates on a connected left-hand monitor', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const bounds = { width: 1280, height: 800, x: -1600, y: 80 };
    expect(boundsVisibleOnDisplays(bounds, [primary, left])).toEqual(bounds);
    expect(boundsVisibleOnDisplays({ ...bounds, x: -2100 }, [primary, left])).toEqual({ ...bounds, x: -1920 });
  });

  it('fits fresh and oversized restored windows to small or scaled screens', () => {
    const small = { x: 0, y: 30, width: 800, height: 550 };
    for (const bounds of [{ width: 1280, height: 800 }, { width: 3200, height: 1800, x: -970, y: -30 }]) {
      expect(boundsVisibleOnDisplays(bounds, [small])).toEqual({ width: 800, height: 550, x: 0, y: 30 });
    }
  });

  it('centers fresh or incomplete positions on the explicit primary display regardless of enumeration order', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    for (const bounds of [{ width: 1280, height: 800 }, { width: 1280, height: 800, x: -1500 }]) {
      expect(boundsVisibleOnDisplays(bounds, [left, primary], primary)).toEqual({ width: 1280, height: 800, x: 320, y: 140 });
    }
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
