import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopServerSettings } from './DesktopServerSettings';
import { PersistentAuthStore } from '../../../packages/server/src/auth-store';
import { OneTimeBootstrapAuthSource, OpenTigSessionAuth } from '../../../packages/server/src/auth';

const directories: string[] = [];
const defaults = { webAccessEnabled: false, lanAccessEnabled: false, publicOrigin: null };

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DesktopServerSettings', () => {
  it('defaults to loopback without creating state', async () => {
    const fixture = await createFixture();
    await expect(fixture.store.load(() => PersistentAuthStore.hasActiveBrowserSessions(fixture.serverDirectory))).resolves.toEqual(defaults);
    await expect(readFile(fixture.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
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

  it.each([undefined, 1, 2, 3])('preserves loopback browser cookies when upgrading settings version %s, including a restart', async (version) => {
    const fixture = await createFixture();
    const auth = await openAuth(fixture.serverDirectory);
    const cookie = (await auth.exchangePairingToken(auth.createPairingToken().token))!.split(';')[0]!;
    await auth.close();
    if (version !== undefined) await writeFile(fixture.filePath, JSON.stringify({ version, webAccessEnabled: false }));
    const readSessions = vi.fn(() => PersistentAuthStore.hasActiveBrowserSessions(fixture.serverDirectory));
    const config = await fixture.store.load(readSessions);
    expect(config).toEqual({ ...defaults, webAccessEnabled: true });
    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual({ version: 4, ...config });
    const upgraded = await openAuth(fixture.serverDirectory, config.webAccessEnabled);
    expect(upgraded.authenticate({ cookie })).toBeTruthy();
    await upgraded.close();
    await expect(fixture.store.load(readSessions)).resolves.toEqual(config);
    expect(readSessions).toHaveBeenCalledTimes(1);
    const restarted = await openAuth(fixture.serverDirectory, config.webAccessEnabled);
    expect(restarted.authenticate({ cookie })).toBeTruthy();
    await restarted.close();
  });

  it.each([1, 2, 3])('reads legacy v%s sessions without rewriting them and preserves authentication', async (version) => {
    const fixture = await createFixture();
    const auth = await openAuth(fixture.serverDirectory);
    const cookie = (await auth.exchangePairingToken(auth.createPairingToken().token))!.split(';')[0]!;
    await auth.close();
    const sessionsFile = path.join(fixture.serverDirectory, 'sessions.json');
    const data = JSON.parse(await readFile(sessionsFile, 'utf8'));
    const oldData = JSON.stringify({ version, sessions: data.sessions.map((session: Record<string, unknown>) => {
      if (version === 1) return { id: session.id, digest: session.digest, createdAt: session.createdAt };
      const rest = { ...session };
      delete rest.expiresAt;
      return rest;
    }) });
    await writeFile(sessionsFile, oldData);
    await writeFile(fixture.filePath, JSON.stringify({ version: 3, webAccessEnabled: false }));
    const config = await fixture.store.load(() => PersistentAuthStore.hasActiveBrowserSessions(fixture.serverDirectory));
    expect(config).toEqual({ ...defaults, webAccessEnabled: true });
    expect(await readFile(sessionsFile, 'utf8')).toBe(oldData);
    const upgraded = await openAuth(fixture.serverDirectory, config.webAccessEnabled);
    expect(upgraded.authenticate({ cookie })).toBeTruthy();
    await upgraded.close();
  });

  it('does not enable browser access for desktop-only, expired, or empty sessions', async () => {
    const fixture = await createFixture();
    const now = Date.now() - 31 * 24 * 60 * 60 * 1_000;
    const oldAuth = await OpenTigSessionAuth.open({ source: new OneTimeBootstrapAuthSource({ desktopSecret: 'test-desktop' }), dataDirectory: fixture.serverDirectory, now: () => now });
    await oldAuth.exchangePairingToken(oldAuth.createPairingToken().token);
    await oldAuth.exchangeDesktopSecret('test-desktop');
    await oldAuth.close();
    await writeFile(fixture.filePath, JSON.stringify({ version: 3, webAccessEnabled: false }));
    await expect(fixture.store.load(() => PersistentAuthStore.hasActiveBrowserSessions(fixture.serverDirectory))).resolves.toEqual(defaults);
    const auth = await openAuth(fixture.serverDirectory, false);
    expect(auth.sessions().every((session) => session.kind === 'desktop')).toBe(true);
    await auth.close();
  });

  it('honours explicit OFF even when a paired browser is still persisted', async () => {
    const fixture = await createFixture();
    const auth = await openAuth(fixture.serverDirectory);
    const cookie = (await auth.exchangePairingToken(auth.createPairingToken().token))!.split(';')[0]!;
    await auth.close();
    await fixture.store.save(defaults);
    const readSessions = vi.fn(() => PersistentAuthStore.hasActiveBrowserSessions(fixture.serverDirectory));
    await expect(fixture.store.load(readSessions)).resolves.toEqual(defaults);
    expect(readSessions).not.toHaveBeenCalled();
    const disabled = await openAuth(fixture.serverDirectory, false);
    expect(disabled.authenticate({ cookie })).toBeNull();
    await disabled.setBrowserAccessEnabled(true);
    expect(disabled.authenticate({ cookie })).toBeNull();
    await disabled.close();
  });

  it('leaves legacy settings intact and fails startup when migration cannot be saved', async () => {
    const fixture = await createFixture();
    const original = JSON.stringify({ version: 3, webAccessEnabled: false });
    await writeFile(fixture.filePath, original);
    vi.spyOn(fixture.store, 'save').mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(fixture.store.load(async () => true)).rejects.toThrow('Disk unavailable');
    expect(await readFile(fixture.filePath, 'utf8')).toBe(original);
    await expect(fixture.store.load(async () => true)).resolves.toEqual({ ...defaults, webAccessEnabled: true });
  });

  it('fails startup when existing session data is unreadable instead of revoking pairings', async () => {
    const fixture = await createFixture();
    const original = JSON.stringify({ version: 3, webAccessEnabled: false });
    await writeFile(fixture.filePath, original);
    await mkdir(fixture.serverDirectory);
    await writeFile(path.join(fixture.serverDirectory, 'sessions.json'), '{corrupt');
    await expect(fixture.store.load(() => PersistentAuthStore.hasActiveBrowserSessions(fixture.serverDirectory))).rejects.toThrow('corrupt');
    expect(await readFile(fixture.filePath, 'utf8')).toBe(original);
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

async function createFixture(): Promise<{ store: DesktopServerSettings; filePath: string; serverDirectory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-server-settings-'));
  directories.push(directory);
  const filePath = path.join(directory, 'desktop-server.json');
  return { store: new DesktopServerSettings(filePath), filePath, serverDirectory: path.join(directory, 'server') };
}

function openAuth(dataDirectory: string, browserAccessEnabled = true) {
  return OpenTigSessionAuth.open({ source: new OneTimeBootstrapAuthSource({ desktopSecret: 'test-desktop' }), dataDirectory, browserAccessEnabled });
}
