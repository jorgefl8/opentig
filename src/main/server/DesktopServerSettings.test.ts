import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopServerSettings } from './DesktopServerSettings';

const directories: string[] = [];
const defaults = { webAccessEnabled: false, lanAccessEnabled: false, publicOrigin: null };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DesktopServerSettings', () => {
  it('defaults to loopback without creating state', async () => {
    const fixture = await createFixture();
    await expect(fixture.store.load()).resolves.toEqual(defaults);
  });

  it('atomically persists network exposure', async () => {
    const fixture = await createFixture();
    const config = { webAccessEnabled: true, lanAccessEnabled: false, publicOrigin: 'https://git.example.com' };
    await fixture.store.save(config);
    await fixture.store.flush();

    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual({ version: 4, ...config });
    await expect(fixture.store.load()).resolves.toEqual(config);
  });

  it.each([1, 2, 3])('migrates version %s LAN-only settings', async (version) => {
    const fixture = await createFixture();
    await writeFile(fixture.filePath, JSON.stringify({ version, webAccessEnabled: true }));
    await expect(fixture.store.load()).resolves.toEqual({ ...defaults, webAccessEnabled: true, lanAccessEnabled: true });
    await writeFile(fixture.filePath, JSON.stringify({ version, webAccessEnabled: false }));
    await expect(fixture.store.load()).resolves.toEqual(defaults);
  });

  it('drops the obsolete external URL while migrating version 2', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.filePath, JSON.stringify({ version: 2, webAccessEnabled: false, externalOrigin: 'https://opentig.example.com' }));
    await expect(fixture.store.load()).resolves.toEqual(defaults);
  });

  it('fails closed for corrupt or unsupported state', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.filePath, JSON.stringify({ version: 5, webAccessEnabled: true }));
    await expect(fixture.store.load()).resolves.toEqual(defaults);
    await writeFile(fixture.filePath, '{corrupt');
    await expect(fixture.store.load()).resolves.toEqual(defaults);
  });

  it('fails closed on an invalid public URL and does not overwrite valid state on invalid save', async () => {
    const fixture = await createFixture();
    await fixture.store.save(defaults);
    expect(() => fixture.store.save({ ...defaults, publicOrigin: 'https://user:secret@example.com' })).toThrow();
    await expect(fixture.store.load()).resolves.toEqual(defaults);
    await writeFile(fixture.filePath, JSON.stringify({ version: 4, ...defaults, webAccessEnabled: true, publicOrigin: 'https://example.com/path' }));
    await expect(fixture.store.load()).resolves.toEqual(defaults);
  });
});

async function createFixture(): Promise<{ store: DesktopServerSettings; filePath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-server-settings-'));
  directories.push(directory);
  const filePath = path.join(directory, 'desktop-server.json');
  return { store: new DesktopServerSettings(filePath), filePath };
}
