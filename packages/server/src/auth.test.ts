import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OneTimeBootstrapAuthSource, OpenTigSessionAuth } from './auth';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('persistent owner authentication', () => {
  it('mints 32-byte pairing tokens, rotates them, and consumes one exactly once', async () => {
    const directory = await authDirectory();
    const auth = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }),
      dataDirectory: directory,
      secureCookies: true,
    });
    const first = auth.createPairingToken();
    const second = auth.createPairingToken();
    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(second.token).not.toBe(first.token);
    await expect(auth.exchangePairingToken(first.token)).resolves.toBeNull();

    const exchanges = await Promise.all([
      auth.exchangePairingToken(second.token),
      auth.exchangePairingToken(second.token),
    ]);
    expect(exchanges.filter(Boolean)).toHaveLength(1);
    expect(exchanges.find(Boolean)).toMatch(/^opentig_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Secure$/);
    expect(auth.descriptor().pairingAvailable).toBe(false);
    await auth.close();
  });

  it('expires pairing credentials without persisting their plaintext', async () => {
    let now = Date.parse('2026-08-22T12:00:00.000Z');
    const directory = await authDirectory();
    const auth = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }),
      dataDirectory: directory,
      now: () => now,
    });
    const pairing = auth.createPairingToken(1_000);
    expect(auth.descriptor().pairingAvailable).toBe(true);
    now += 1_000;
    expect(auth.descriptor().pairingAvailable).toBe(false);
    await expect(auth.exchangePairingToken(pairing.token)).resolves.toBeNull();
    expect(await persistedText(directory)).not.toContain(pairing.token);
    await auth.close();
  });

  it('persists only hashes and restores sessions after restart', async () => {
    const directory = await authDirectory();
    const desktopSecret = 'desktop-bootstrap-secret';
    const first = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret }),
      dataDirectory: directory,
    });
    const cookie = await first.exchangeDesktopSecret(desktopSecret);
    expect(cookie).not.toBeNull();
    const header = cookieValue(cookie!);
    const token = header.slice(header.indexOf('=') + 1);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const firstSessionId = first.authenticate({ cookie: header });
    expect(firstSessionId).toBeTruthy();
    await first.close();

    const persisted = await persistedText(directory);
    expect(persisted).not.toContain(desktopSecret);
    expect(persisted).not.toContain(token);

    const restarted = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'new-bootstrap-secret' }),
      dataDirectory: directory,
    });
    expect(restarted.authenticate({ cookie: header })).toBe(firstSessionId);
    await expect(restarted.revoke({ cookie: header })).resolves.toBe(firstSessionId);
    expect(restarted.authenticate({ cookie: header })).toBeNull();
    await restarted.close();

    const afterRevoke = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'third-bootstrap-secret' }),
      dataDirectory: directory,
    });
    expect(afterRevoke.authenticate({ cookie: header })).toBeNull();
    await afterRevoke.close();
  });

  it('revokes every persisted owner session without affecting pairing rotation', async () => {
    const directory = await authDirectory();
    const auth = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }),
      dataDirectory: directory,
    });
    const firstPairing = auth.createPairingToken();
    const firstCookie = await auth.exchangePairingToken(firstPairing.token);
    const secondPairing = auth.createPairingToken();
    const secondCookie = await auth.exchangePairingToken(secondPairing.token);
    const ids = [firstCookie, secondCookie].map((cookie) => auth.authenticate({ cookie: cookieValue(cookie!) }));
    expect(ids.every(Boolean)).toBe(true);

    await expect(auth.revokeAll()).resolves.toEqual(expect.arrayContaining(ids));
    expect(auth.authenticate({ cookie: cookieValue(firstCookie!) })).toBeNull();
    expect(auth.authenticate({ cookie: cookieValue(secondCookie!) })).toBeNull();
    await auth.close();
  });

  it('fails closed on corrupt session data and leaves it untouched', async () => {
    const directory = await authDirectory();
    const auth = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }),
      dataDirectory: directory,
    });
    await auth.close();
    const sessionsPath = path.join(directory, 'sessions.json');
    await writeFile(sessionsPath, '{corrupt', 'utf8');

    await expect(OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'another-secret' }),
      dataDirectory: directory,
    })).rejects.toThrow('authentication session data is corrupt');
    expect(await readFile(sessionsPath, 'utf8')).toBe('{corrupt');
  });

  it.skipIf(process.platform === 'win32')('uses private POSIX permissions for directory and files', async () => {
    const directory = await authDirectory();
    const auth = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }),
      dataDirectory: directory,
    });
    await auth.close();
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(directory, 'server-secret'))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(directory, 'sessions.json'))).mode & 0o777).toBe(0o600);
  });
});

async function authDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-auth-'));
  directories.push(directory);
  return directory;
}

function cookieValue(cookie: string): string {
  return cookie.split(';', 1)[0] ?? '';
}

async function persistedText(directory: string): Promise<string> {
  return [
    await readFile(path.join(directory, 'server-secret'), 'utf8'),
    await readFile(path.join(directory, 'sessions.json'), 'utf8'),
  ].join('\n');
}
