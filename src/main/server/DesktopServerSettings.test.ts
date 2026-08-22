import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopServerSettings } from './DesktopServerSettings';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DesktopServerSettings', () => {
  it('defaults to loopback without creating state', async () => {
    const fixture = await createFixture();
    await expect(fixture.store.load()).resolves.toBe(false);
  });

  it('atomically persists network exposure', async () => {
    const fixture = await createFixture();
    await fixture.store.save(true);
    await fixture.store.flush();

    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual({ version: 1, webAccessEnabled: true });
    await expect(fixture.store.load()).resolves.toBe(true);
  });

  it('fails closed for corrupt or unsupported state', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.filePath, JSON.stringify({ version: 2, webAccessEnabled: true }));
    await expect(fixture.store.load()).resolves.toBe(false);
    await writeFile(fixture.filePath, '{corrupt');
    await expect(fixture.store.load()).resolves.toBe(false);
  });
});

async function createFixture(): Promise<{ store: DesktopServerSettings; filePath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-server-settings-'));
  directories.push(directory);
  const filePath = path.join(directory, 'desktop-server.json');
  return { store: new DesktopServerSettings(filePath), filePath };
}
