import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_SESSION_MAX_AGE_SECONDS, OneTimeBootstrapAuthSource, OpenTigSessionAuth } from './auth';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('persistent owner authentication', () => {
  it.each(['production', 'dev'] as const)('renews %s browser access across the original expiry and a restart without changing its credential', async (profile) => {
    let now = Date.parse('2026-09-23T00:00:00.000Z');
    const directory = await authDirectory();
    const config = { source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }), dataDirectory: directory, now: () => now, profile };
    const auth = await OpenTigSessionAuth.open(config);
    const cookie = cookieValue((await auth.exchangePairingToken(auth.createPairingToken().token))!);
    const id = auth.authenticate({ cookie });
    now += 29 * 24 * 60 * 60 * 1_000;
    const renewed = await auth.renewBrowserCookie({ cookie }, true);
    expect(cookieValue(renewed!)).toBe(cookie);
    expect(renewed).toContain('HttpOnly; SameSite=Strict; Max-Age=2592000; Secure');
    expect(auth.sessions()[0]?.expiresAt).toBe('2026-11-21T00:00:00.000Z');
    expect(auth.sessions()[0]?.createdAt).toBe('2026-09-23T00:00:00.000Z');
    await auth.close();
    now += 2 * 24 * 60 * 60 * 1_000;
    const restarted = await OpenTigSessionAuth.open(config);
    expect(restarted.authenticate({ cookie })).toBe(id);
    now = Date.parse('2026-11-21T00:00:00.000Z');
    await expect(restarted.renewBrowserCookie({ cookie })).resolves.toBeNull();
    expect(restarted.authenticate({ cookie })).toBeNull();
    await restarted.close();
  });

  it('does not renew desktop cookies or resurrect access revoked alongside a renewal', async () => {
    const directory = await authDirectory();
    const auth = await OpenTigSessionAuth.open({ source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }), dataDirectory: directory });
    const desktop = cookieValue((await auth.exchangeDesktopSecret('desktop-secret'))!);
    await expect(auth.renewBrowserCookie({ cookie: desktop })).resolves.toBeNull();
    const cookie = cookieValue((await auth.exchangePairingToken(auth.createPairingToken().token))!);
    await Promise.all([auth.renewBrowserCookie({ cookie }), auth.revoke({ cookie })]);
    expect(auth.authenticate({ cookie })).toBeNull();
    await expect(auth.renewBrowserCookie({ cookie })).resolves.toBeNull();
    await expect(auth.renewBrowserCookie({ cookie: 'opentig_session=unknown' })).resolves.toBeNull();
    await auth.close();
  });

  it('enforces the browser lifetime on the server across activity and restarts', async () => {
    let now = Date.parse('2026-09-23T00:00:00.000Z');
    const issuedAt = now;
    const directory = await authDirectory();
    const config = { source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }), dataDirectory: directory, now: () => now };
    const auth = await OpenTigSessionAuth.open(config);
    const desktop = cookieValue((await auth.exchangeDesktopSecret('desktop-secret'))!);
    const browser = cookieValue((await auth.exchangePairingToken(auth.createPairingToken().token))!);
    const id = auth.authenticate({ cookie: browser })!;
    const expiresAt = issuedAt + BROWSER_SESSION_MAX_AGE_SECONDS * 1_000;
    expect(auth.sessions().find((session) => session.id === id)?.expiresAt).toBe(new Date(expiresAt).toISOString());
    now = expiresAt - 1;
    expect(auth.authenticate({ cookie: browser })).toBe(id);
    await auth.recordConnection(id);
    await auth.close();
    const restarted = await OpenTigSessionAuth.open(config);
    expect(restarted.authenticate({ cookie: browser })).toBe(id);
    now = expiresAt;
    expect(restarted.authenticate({ cookie: browser })).toBeNull();
    expect(restarted.hasSession(id)).toBe(false);
    expect(restarted.sessions().some((session) => session.id === id)).toBe(false);
    await expect(restarted.recordConnection(id)).resolves.toBe(false);
    expect(restarted.authenticate({ cookie: desktop })).toBeTruthy();
    await restarted.close();
    const expiredRestart = await OpenTigSessionAuth.open(config);
    expect(expiredRestart.authenticate({ cookie: browser })).toBeNull();
    await expiredRestart.close();
  });

  it.each([2, 3])('migrates v%s sessions with a fixed expiry derived from creation, not restart', async (version) => {
    let now = Date.parse('2026-09-23T00:00:00.000Z');
    const directory = await authDirectory();
    const config = { source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }), dataDirectory: directory, now: () => now };
    const auth = await OpenTigSessionAuth.open(config);
    const cookie = cookieValue((await auth.exchangePairingToken(auth.createPairingToken().token))!);
    const id = auth.authenticate({ cookie })!;
    await auth.close();
    const sessionsPath = path.join(directory, 'sessions.json');
    const data = JSON.parse(await readFile(sessionsPath, 'utf8'));
    data.version = version;
    for (const session of data.sessions) delete session.expiresAt;
    await writeFile(sessionsPath, JSON.stringify(data));
    now += 29 * 24 * 60 * 60 * 1_000;
    const migrated = await OpenTigSessionAuth.open(config);
    expect(migrated.authenticate({ cookie })).toBe(id);
    expect(migrated.sessions()[0]?.expiresAt).toBe('2026-10-23T00:00:00.000Z');
    await migrated.close();
    expect(JSON.parse(await readFile(sessionsPath, 'utf8')).version).toBe(4);
    now += 24 * 60 * 60 * 1_000;
    const expired = await OpenTigSessionAuth.open(config);
    expect(expired.authenticate({ cookie })).toBeNull();
    await expired.close();
  });

  it.each([null, 'invalid-date'])('rejects browser records with invalid persisted expiry %s', async (expiresAt) => {
    const directory = await authDirectory();
    const config = { source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }), dataDirectory: directory };
    const auth = await OpenTigSessionAuth.open(config);
    await auth.exchangePairingToken(auth.createPairingToken().token);
    await auth.close();
    const sessionsPath = path.join(directory, 'sessions.json');
    const data = JSON.parse(await readFile(sessionsPath, 'utf8'));
    data.sessions[0].expiresAt = expiresAt;
    await writeFile(sessionsPath, JSON.stringify(data));
    await expect(OpenTigSessionAuth.open(config)).rejects.toThrow('session data is corrupt');
  });

  it.each(['production', 'dev'] as const)('remembers paired %s browsers without persisting desktop cookies', async (profile) => {
    const directory = await authDirectory();
    const config = { source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }), dataDirectory: directory, profile };
    const auth = await OpenTigSessionAuth.open(config);
    const desktop = await auth.exchangeDesktopSecret('desktop-secret');
    expect(desktop).not.toContain('Max-Age');
    const paired = await auth.exchangePairingToken(auth.createPairingToken().token, undefined, true);
    expect(paired).toContain('Max-Age=2592000; Secure');
    const header = cookieValue(paired!);
    await auth.close();
    const restarted = await OpenTigSessionAuth.open(config);
    expect(restarted.authenticate({ cookie: header })).toBeTruthy();
    expect(restarted.expiredCookie(true)).toContain('Max-Age=0; Secure');
    await restarted.revoke({ cookie: header });
    expect(restarted.authenticate({ cookie: header })).toBeNull();
    await restarted.close();
  });

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
    expect(exchanges.find(Boolean)).toMatch(/^opentig_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
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

  it('migrates existing unlabelled sessions without losing authentication', async () => {
    const directory = await authDirectory();
    const first = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'desktop-secret' }),
      dataDirectory: directory,
    });
    const pairing = first.createPairingToken();
    const cookie = await first.exchangePairingToken(pairing.token);
    await first.close();

    const sessionsPath = path.join(directory, 'sessions.json');
    const current = JSON.parse(await readFile(sessionsPath, 'utf8')) as { sessions: Array<Record<string, unknown>> };
    await writeFile(sessionsPath, JSON.stringify({
      version: 1,
      sessions: current.sessions.map(({ id, digest, createdAt }) => ({ id, digest, createdAt })),
    }));

    const migrated = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'next-secret' }),
      dataDirectory: directory,
    });
    expect(migrated.authenticate({ cookie: cookieValue(cookie!) })).toBeTruthy();
    expect(migrated.sessions()).toEqual([expect.objectContaining({
      kind: 'legacy',
      clientName: 'Legacy browser session',
      deviceType: 'unknown',
      lastConnectedAt: null,
    })]);
    expect(JSON.parse(await readFile(sessionsPath, 'utf8'))).toEqual(expect.objectContaining({ version: 4 }));
    await migrated.close();
  });

  it('keeps one desktop session and allows browser names and activity to be updated', async () => {
    const directory = await authDirectory();
    const first = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'first-secret' }),
      dataDirectory: directory,
    });
    await first.exchangeDesktopSecret('first-secret');
    await first.close();

    const auth = await OpenTigSessionAuth.open({
      source: new OneTimeBootstrapAuthSource({ desktopSecret: 'second-secret' }),
      dataDirectory: directory,
    });
    await auth.exchangeDesktopSecret('second-secret');
    const pairing = auth.createPairingToken();
    const cookie = await auth.exchangePairingToken(pairing.token, {
      clientName: 'Work laptop',
      deviceType: 'desktop',
      os: 'Windows',
      browser: 'Chrome',
      remoteAddress: '203.0.113.42',
      viaProxy: true,
    });
    const browserId = auth.authenticate({ cookie: cookieValue(cookie!) })!;
    await expect(auth.renameBrowserSession(browserId, 'Travel laptop')).resolves.toBe(true);
    await expect(auth.recordConnection(browserId)).resolves.toBe(true);
    expect(auth.sessions().filter((session) => session.kind === 'desktop')).toHaveLength(1);
    expect(auth.sessions()).toContainEqual(expect.objectContaining({
      id: browserId,
      clientName: 'Travel laptop',
      browser: 'Chrome',
      viaProxy: true,
      lastConnectedAt: expect.any(String),
    }));
    await auth.close();
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
