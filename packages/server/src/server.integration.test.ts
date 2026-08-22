import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { OneTimeBootstrapAuthSource } from './auth';
import { runOpenTigServer, type RunningOpenTigServer } from './server';

const execFileAsync = promisify(execFile);
const servers: RunningOpenTigServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('authoritative HTTP server', () => {
  it('serves fixed health, readiness, descriptor, and secure static responses', async () => {
    const fixture = await startFixture();

    await expectJson(`${fixture.server.origin}/healthz`, 200, { status: 'ok' });
    await expectJson(`${fixture.server.origin}/readyz`, 200, {
      status: 'ready', protocolVersion: 1, appVersion: '0.1-test',
    });
    const descriptor = await fetch(`${fixture.server.origin}/api/auth/descriptor`);
    expect(await descriptor.json()).toEqual({
      authenticationRequired: true,
      pairingAvailable: true,
      mode: 'desktop',
      protocolVersion: 1,
      appVersion: '0.1-test',
    });
    expect(JSON.stringify(await (await fetch(`${fixture.server.origin}/api/auth/descriptor`)).json())).not.toContain(fixture.desktopSecret);
    expect(JSON.stringify(await (await fetch(`${fixture.server.origin}/api/auth/descriptor`)).json())).not.toContain(fixture.pairingToken);

    const index = await fetch(`${fixture.server.origin}/repository/history`);
    expect(await index.text()).toContain('OpenTig test client');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(index.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');

    const asset = await fetch(`${fixture.server.origin}/assets/app-12345678.js`);
    expect(await asset.text()).toBe('export const test = true;');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expectJson(`${fixture.server.origin}/api/missing`, 404, { error: 'Not found.' });
  });

  it('requires exact origin and exchanges one-use credentials for HttpOnly sessions', async () => {
    const fixture = await startFixture();
    const wrongOrigin = await postJson(`${fixture.server.origin}/api/auth/pair`, { token: fixture.pairingToken }, 'http://evil.invalid');
    expect(wrongOrigin.status).toBe(403);
    const invalid = await postJson(`${fixture.server.origin}/api/auth/pair`, { token: 'invalid' }, fixture.server.origin);
    expect(invalid.status).toBe(401);

    const paired = await postJson(`${fixture.server.origin}/api/auth/pair`, { token: fixture.pairingToken }, fixture.server.origin);
    expect(paired.status).toBe(204);
    expect(paired.cookie).toMatch(/^opentig_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict$/);
    expect((await (await fetch(`${fixture.server.origin}/api/auth/descriptor`)).json()).pairingAvailable).toBe(false);
    expect((await postJson(`${fixture.server.origin}/api/auth/pair`, { token: fixture.pairingToken }, fixture.server.origin)).status).toBe(401);

    const desktop = await postJson(`${fixture.server.origin}/api/auth/desktop`, { secret: fixture.desktopSecret }, fixture.server.origin);
    expect(desktop.status).toBe(204);
    expect((await postJson(`${fixture.server.origin}/api/auth/desktop`, { secret: fixture.desktopSecret }, fixture.server.origin)).status).toBe(401);
    expect((await fetch(`${fixture.server.origin}/api/image/missing/file.png`)).status).toBe(401);
    expect((await fetch(`${fixture.server.origin}/api/image/missing/file.png`, { headers: { Cookie: 'opentig_session=invalid' } })).status).toBe(401);
  });

  it('creates short-lived pairing links with credentials only in the fragment', async () => {
    const fixture = await startFixture();
    const pairing = fixture.server.createPairingLink();
    const url = new URL(pairing.url);
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    expect(url.pathname).toBe('/pair');
    expect(url.search).toBe('');
    expect(Buffer.from(token ?? '', 'base64url')).toHaveLength(32);
    expect(url.href.slice(0, url.href.indexOf('#'))).not.toContain(token!);
    expect(Date.parse(pairing.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('blocks traversal and symlink escape without SPA fallback', async () => {
    const fixture = await startFixture();
    const outside = await temporaryDirectory();
    await writeFile(path.join(outside, 'secret.txt'), 'outside');
    await symlink(outside, path.join(fixture.clientRoot, 'escape'), 'junction');

    expect((await rawGet(fixture.server.origin, '/%2e%2e/secret.txt')).status).toBe(400);
    expect((await rawGet(fixture.server.origin, '/..%2fsecret.txt')).status).toBe(400);
    expect((await fetch(`${fixture.server.origin}/escape/secret.txt`)).status).toBe(404);
    expect((await fetch(`${fixture.server.origin}/missing.js`)).status).toBe(404);
    expect((await fetch(`${fixture.server.origin}/api/not-a-route`)).status).toBe(404);
  });

  it('serves validated image bytes over authenticated HTTP', async () => {
    const fixture = await startFixture();
    const repositoryPath = path.join(fixture.directory, 'repository');
    await mkdir(repositoryPath);
    await execFileAsync('git', ['init', '--quiet'], { cwd: repositoryPath });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await writeFile(path.join(repositoryPath, 'preview.png'), png);
    const repository = await fixture.server.runtime.services.repositories.openPath(repositoryPath);
    const authenticated = await postJson(`${fixture.server.origin}/api/auth/desktop`, { secret: fixture.desktopSecret }, fixture.server.origin);
    const imageUrl = `${fixture.server.origin}/api/image/${encodeURIComponent(repository.id)}/preview.png`;
    const image = await fetch(imageUrl, { headers: { Cookie: cookieValue(authenticated.cookie) } });

    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    expect(image.headers.get('cache-control')).toBe('private, no-store');
  });

  it('fails clearly when an explicit port is already occupied', async () => {
    const fixture = await startFixture();
    const secondDirectory = await temporaryDirectory();
    const secondClient = path.join(secondDirectory, 'client');
    await mkdir(secondClient);
    await writeFile(path.join(secondClient, 'index.html'), '<!doctype html>');

    await expect(runOpenTigServer({
      settingsPath: path.join(secondDirectory, 'settings.json'),
      aiLogPath: path.join(secondDirectory, 'ai-log.jsonl'),
      platform: 'win32',
      trash: { available: true, trashItem: async () => undefined },
      clientRoot: secondClient,
      appVersion: '0.1-test',
      auth: new OneTimeBootstrapAuthSource({ desktopSecret: 'second-desktop-secret' }),
      host: '127.0.0.1',
      port: fixture.server.port,
    })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('restores an authenticated browser session after server restart', async () => {
    const fixture = await startFixture();
    const authenticated = await postJson(`${fixture.server.origin}/api/auth/desktop`, { secret: fixture.desktopSecret }, fixture.server.origin);
    const cookie = cookieValue(authenticated.cookie);
    await fixture.server.close();

    const restarted = await runOpenTigServer({
      settingsPath: path.join(fixture.directory, 'settings.json'),
      aiLogPath: path.join(fixture.directory, 'ai-log.jsonl'),
      platform: 'win32',
      trash: { available: true, trashItem: async () => undefined },
      clientRoot: fixture.clientRoot,
      appVersion: '0.1-test',
      auth: new OneTimeBootstrapAuthSource({ desktopSecret: 'restart-bootstrap-secret' }),
      port: 0,
    });
    servers.push(restarted);
    const socket = await openWebSocket(restarted.origin, cookie);
    expect(await sendAndReceive(socket, { type: 'ping' })).toEqual({ type: 'pong' });
    socket.close();
  });
});

describe('authenticated WebSocket protocol', () => {
  it('rejects missing/wrong auth and carries command, error, ping, and runtime event messages', async () => {
    const fixture = await startFixture();
    await expectWebSocketFailure(fixture.server.origin, fixture.server.origin, undefined, 401);
    const authenticated = await postJson(`${fixture.server.origin}/api/auth/desktop`, { secret: fixture.desktopSecret }, fixture.server.origin);
    await expectWebSocketFailure(fixture.server.origin, 'http://evil.invalid', cookieValue(authenticated.cookie), 403);

    const socket = await openWebSocket(fixture.server.origin, cookieValue(authenticated.cookie));
    const bootstrap = await sendAndReceive(socket, { type: 'request', id: 'bootstrap', command: 'app:bootstrap', args: [] });
    expect(bootstrap).toMatchObject({
      type: 'result',
      id: 'bootstrap',
      result: { ok: true, value: { server: { protocolVersion: 1, appVersion: '0.1-test' } } },
    });

    const unknown = await sendAndReceive(socket, { type: 'request', id: 'unknown', command: 'missing:command', args: [] });
    expect(unknown).toMatchObject({ type: 'result', id: 'unknown', result: { ok: false, error: { code: 'INVALID_ARGUMENT' } } });
    expect(await sendAndReceive(socket, { type: 'ping' })).toEqual({ type: 'pong' });

    const eventPromise = nextMessage(socket);
    fixture.server.runtime.publishRepositoryChange('repository-id', 'unknown');
    expect(await eventPromise).toEqual({
      type: 'event',
      event: { type: 'repository.changed', repositoryId: 'repository-id', scope: 'unknown' },
    });

    const logoutClosed = closed(socket);
    const logout = await postJson(`${fixture.server.origin}/api/auth/logout`, {}, fixture.server.origin, cookieValue(authenticated.cookie));
    expect(logout.status).toBe(204);
    expect(logout.cookie).toContain('Max-Age=0');
    await expect(logoutClosed).resolves.toBe(1008);
  });

  it('rejects malformed, binary, image, and oversized normal requests before dispatch', async () => {
    const fixture = await startFixture();
    const authenticated = await postJson(`${fixture.server.origin}/api/auth/desktop`, { secret: fixture.desktopSecret }, fixture.server.origin);
    const socket = await openWebSocket(fixture.server.origin, cookieValue(authenticated.cookie));

    const malformedPromise = nextMessage(socket);
    socket.send('{');
    expect(await malformedPromise).toMatchObject({ type: 'result', result: { ok: false } });

    const image = await sendAndReceive(socket, { type: 'request', id: 'image', command: 'repository:read-image', args: ['id', 'path'] });
    expect(image).toMatchObject({ type: 'result', id: 'image', result: { ok: false, error: { operation: 'server-protocol' } } });

    const oversized = await sendAndReceive(socket, {
      type: 'request', id: 'large', command: 'app:bootstrap', args: ['x'.repeat(1024 * 1024)],
    });
    expect(oversized).toMatchObject({ type: 'result', id: 'large', result: { ok: false, error: { operation: 'server-protocol' } } });

    const binaryClosed = closed(socket);
    socket.send(Buffer.from([1, 2, 3]), { binary: true });
    await expect(binaryClosed).resolves.toBe(1003);
  });

  it('revokes every session and disconnects all authenticated clients', async () => {
    const fixture = await startFixture();
    const first = await postJson(`${fixture.server.origin}/api/auth/pair`, { token: fixture.pairingToken }, fixture.server.origin);
    const nextPairing = fixture.server.createPairingLink();
    const nextToken = new URLSearchParams(new URL(nextPairing.url).hash.slice(1)).get('token');
    const second = await postJson(`${fixture.server.origin}/api/auth/pair`, { token: nextToken }, fixture.server.origin);
    const firstCookie = cookieValue(first.cookie);
    const secondCookie = cookieValue(second.cookie);
    const firstSocket = await openWebSocket(fixture.server.origin, firstCookie);
    const secondSocket = await openWebSocket(fixture.server.origin, secondCookie);
    const firstClosed = closed(firstSocket);
    const secondClosed = closed(secondSocket);

    const revoked = await postJson(`${fixture.server.origin}/api/auth/revoke-all`, {}, fixture.server.origin, firstCookie);
    expect(revoked.status).toBe(204);
    await expect(Promise.all([firstClosed, secondClosed])).resolves.toEqual([1008, 1008]);
    await expectWebSocketFailure(fixture.server.origin, fixture.server.origin, secondCookie, 401);
  });
});

async function startFixture(): Promise<{
  server: RunningOpenTigServer;
  directory: string;
  clientRoot: string;
  desktopSecret: string;
  pairingToken: string;
}> {
  const directory = await temporaryDirectory();
  const clientRoot = path.join(directory, 'client');
  await mkdir(path.join(clientRoot, 'assets'), { recursive: true });
  await writeFile(path.join(clientRoot, 'index.html'), '<!doctype html><title>OpenTig test client</title>');
  await writeFile(path.join(clientRoot, 'assets', 'app-12345678.js'), 'export const test = true;');
  const desktopSecret = `desktop-${crypto.randomUUID()}`;
  const server = await runOpenTigServer({
    settingsPath: path.join(directory, 'settings.json'),
    aiLogPath: path.join(directory, 'ai-log.jsonl'),
    platform: 'win32',
    trash: { available: true, trashItem: async () => undefined },
    clientRoot,
    appVersion: '0.1-test',
    auth: new OneTimeBootstrapAuthSource({ desktopSecret }),
    port: 0,
  });
  const pairingLink = server.createPairingLink();
  const pairingToken = new URLSearchParams(new URL(pairingLink.url).hash.slice(1)).get('token');
  if (!pairingToken) throw new Error('Pairing token missing.');
  servers.push(server);
  return { server, directory, clientRoot, desktopSecret, pairingToken };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-http-'));
  directories.push(directory);
  return directory;
}

async function expectJson(url: string, status: number, expected: unknown): Promise<void> {
  const response = await fetch(url);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(expected);
}

async function postJson(url: string, body: unknown, origin: string, cookie?: string): Promise<{ status: number; cookie: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, cookie: response.headers.get('set-cookie') ?? '' };
}

function cookieValue(setCookie: string): string {
  return setCookie.split(';', 1)[0] ?? '';
}

function rawGet(origin: string, requestPath: string): Promise<{ status: number; body: string }> {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: target.hostname, port: target.port, path: requestPath, method: 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}

function openWebSocket(origin: string, cookie: string): Promise<WebSocket> {
  const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/ws', { headers: { Origin: origin, Cookie: cookie } });
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function expectWebSocketFailure(origin: string, requestOrigin: string, cookie: string | undefined, status: number): Promise<void> {
  const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/ws', {
    headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
  });
  return new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      expect(response.statusCode).toBe(status);
      response.resume();
      resolve();
    });
    socket.once('open', () => reject(new Error('WebSocket unexpectedly opened.')));
    socket.once('error', () => undefined);
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try { resolve(JSON.parse(data.toString())); }
      catch (error) { reject(error); }
    });
    socket.once('error', reject);
  });
}

async function sendAndReceive(socket: WebSocket, value: unknown): Promise<unknown> {
  const response = nextMessage(socket);
  socket.send(JSON.stringify(value));
  return response;
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}
