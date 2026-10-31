import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { CommandRegistry, type CommandExecutionContext } from '../../../src/main/runtime/CommandRegistry';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import { OPEN_TIG_SERVER_COMMANDS } from '../../../src/shared/protocol';
import { BROWSER_SESSION_MAX_AGE_SECONDS, OneTimeBootstrapAuthSource, OpenTigSessionAuth } from './auth';
import { OpenTigServer } from './OpenTigServer';
import { NetworkSettings } from './network-settings';
import { OPEN_TIG_MAX_SERVER_MESSAGE_BYTES } from '../../../src/shared/server-protocol';

interface Fixture {
  auth: OpenTigSessionAuth;
  server: OpenTigServer;
  origin: string;
  socket(): Promise<WebSocket>;
  closeRuntime: ReturnType<typeof vi.fn>;
  logger: ReturnType<typeof vi.fn>;
}

const fixtures: Fixture[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(fixtures.splice(0).map((fixture) => fixture.server.stop()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe('WebSocket safety limits', () => {
  it.each([1, 16])('serializes a broadcast once for %i authenticated connections with separate send metrics', async (count) => {
    vi.stubEnv('OPENTIG_PERF_LOG', '1');
    const fixture = await startFixture(() => emptyBootstrap());
    const sockets: WebSocket[] = [];
    for (let index = 0; index < count; index += 1) sockets.push(await fixture.socket());
    const received = sockets.map((socket) => nextMessage(socket));
    const readRepositoryId = vi.fn(() => 'private-repository-id');
    const event = { type: 'repository.changed' as const, get repositoryId() { return readRepositoryId(); }, scope: 'worktree' as const };
    fixture.server.publish(event);
    const messages = await Promise.all(received);
    expect(readRepositoryId).toHaveBeenCalledTimes(1);
    for (const message of messages) expect(message).toEqual({ type: 'event', event: { type: 'repository.changed', repositoryId: 'private-repository-id', scope: 'worktree' } });
    const bytes = Buffer.byteLength(JSON.stringify(messages[0]));
    const records = performanceRecords(fixture);
    expect(records.filter((record) => record.kind === 'serialize')).toEqual([
      { kind: 'serialize', durationMs: expect.any(Number), bytes, outcome: 'accepted', maxBytes: OPEN_TIG_MAX_SERVER_MESSAGE_BYTES },
    ]);
    await vi.waitFor(() => expect(performanceRecords(fixture).filter((record) => record.kind === 'send')).toHaveLength(count));
    expect(JSON.stringify(performanceRecords(fixture))).not.toContain('private-repository-id');
    for (const socket of sockets) socket.close();
  });

  it('checks each broadcast recipient even when the event encoding is shared', async () => {
    const fixture = await startFixture(() => emptyBootstrap());
    const healthy = await fixture.socket();
    const cookie = (await fixture.auth.exchangePairingToken(fixture.auth.createPairingToken().token))!.split(';', 1)[0]!;
    const revoked = await openWebSocket(fixture.origin, cookie);
    const sessionId = fixture.auth.authenticate({ cookie })!;
    const deniedMessages = vi.fn();
    revoked.on('message', deniedMessages);
    const close = closed(revoked);
    await fixture.auth.revokeBrowserSession(sessionId);
    const response = nextMessage(healthy);
    fixture.server.publish({ type: 'repository.changed', repositoryId: 'repository', scope: 'worktree' });
    expect(await response).toMatchObject({ type: 'event' });
    await expect(close).resolves.toBe(1008);
    expect(deniedMessages).not.toHaveBeenCalled();
    healthy.close();
  });

  it('keeps performance logging disabled by default', async () => {
    vi.stubEnv('OPENTIG_PERF_LOG', '');
    const fixture = await startFixture(() => emptyBootstrap());
    const socket = await fixture.socket();
    await sendAndReceive(socket, { type: 'request', id: 'normal', command: 'app:bootstrap', args: [] });
    expect(fixture.logger).not.toHaveBeenCalled();
    socket.close();
  });

  it('records exact encoded JSON bytes and durations without payloads, paths, IDs, or unvalidated command names', async () => {
    vi.stubEnv('OPENTIG_PERF_LOG', '1');
    const fixture = await startFixture(() => ({ payload: 'payload-secret\n€' }));
    const socket = await fixture.socket();
    const request = { type: 'request', id: 'request-secret', command: 'app:bootstrap', args: [] };
    const response = await sendAndReceive(socket, request);
    await sendAndReceive(socket, { type: 'request', id: 'write-secret', command: 'repository:write-file', args: ['repository-secret', 'path-secret', 'content-secret', ''] });
    await sendAndReceive(socket, { type: 'request', id: 'unknown-secret', command: 'command-secret', args: [] });
    const records = performanceRecords(fixture);
    expect(records).toContainEqual({ kind: 'request', durationMs: expect.any(Number), operation: 'bootstrap', requestBytes: Buffer.byteLength(JSON.stringify(request)) });
    expect(records).toContainEqual({ kind: 'serialize', durationMs: expect.any(Number), outcome: 'accepted', maxBytes: OPEN_TIG_MAX_SERVER_MESSAGE_BYTES, bytes: Buffer.byteLength(JSON.stringify(response)) });
    expect(records).toContainEqual({ kind: 'request', durationMs: expect.any(Number), operation: 'unknown', requestBytes: expect.any(Number) });
    expect(JSON.stringify(records)).not.toContain('secret');
    for (const record of records) expect(record.durationMs).toBeGreaterThanOrEqual(0);
    socket.close();
  });

  it('does not let a failing performance logger interrupt response delivery', async () => {
    vi.stubEnv('OPENTIG_PERF_LOG', '1');
    const fixture = await startFixture(() => emptyBootstrap());
    fixture.logger.mockImplementation(() => { throw new Error('Diagnostic sink failed'); });
    const socket = await fixture.socket();
    expect(await sendAndReceive(socket, { type: 'request', id: 'logged', command: 'app:bootstrap', args: [] }))
      .toMatchObject({ result: { ok: true } });
    socket.close();
  });

  it('aborts only browser commands when Web access is disabled', async () => {
    const active = new Map<string, { signal: AbortSignal; finish(): void }>();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const fixture = await startFixture((context) => new Promise((resolve) => {
      const finish = () => resolve(emptyBootstrap());
      active.set(context.sessionId, { signal: context.signal, finish });
      context.signal.addEventListener('abort', finish, { once: true });
      if (active.size === 2) ready();
    }), { commandTimeoutMs: 10_000 });
    const cookie = (await fixture.auth.exchangePairingToken(fixture.auth.createPairingToken().token))!.split(';', 1)[0]!;
    const browserId = fixture.auth.authenticate({ cookie })!;
    const browser = await openWebSocket(fixture.origin, cookie);
    const desktop = await fixture.socket();
    const disconnected = closed(browser);
    const desktopResult = sendAndReceive(desktop, { type: 'request', id: 'desktop', command: 'app:bootstrap', args: [] });
    browser.send(JSON.stringify({ type: 'request', id: 'browser', command: 'app:bootstrap', args: [] }));
    await started;
    await fixture.server.setBrowserAccessEnabled(false);
    expect(active.get(browserId)?.signal.aborted).toBe(true);
    const remaining = [...active.entries()].find(([id]) => id !== browserId)![1];
    expect(remaining.signal.aborted).toBe(false);
    remaining.finish();
    expect(await desktopResult).toMatchObject({ result: { ok: true } });
    expect(await disconnected).toBe(1008);
    desktop.close();
  });

  it('renews both the cookie and server lifetime over trusted HTTP without disconnecting the socket', async () => {
    let now = Date.parse('2026-09-23T00:00:00.000Z');
    const fixture = await startFixture(() => emptyBootstrap(), {}, () => now);
    const cookie = (await fixture.auth.exchangePairingToken(fixture.auth.createPairingToken().token))!.split(';', 1)[0]!;
    const socket = await openWebSocket(fixture.origin, cookie);
    const renew = (origin: string, forwarded = false) => fetch(`${fixture.origin}/api/auth/renew`, {
      method: 'POST', headers: { Cookie: cookie, Origin: origin, ...(forwarded ? { 'X-Forwarded-Host': 'opentig.example.com' } : {}) },
    });
    now += 29 * 24 * 60 * 60 * 1_000;
    expect((await renew('https://foreign.example')).status).toBe(403);
    const response = await renew('https://opentig.example.com', true);
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('set-cookie')).toBe(`${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure`);
    now += 2 * 24 * 60 * 60 * 1_000;
    expect(await sendAndReceive(socket, { type: 'request', id: 'renewed', command: 'app:bootstrap', args: [] })).toMatchObject({ result: { ok: true } });
    expect(fixture.auth.sessions()).toHaveLength(2); // One desktop fixture and the same browser session.
    const close = closed(socket);
    await fetch(`${fixture.origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: fixture.origin } });
    await expect(close).resolves.toBe(1008);
    const denied = await renew(fixture.origin);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('set-cookie')).toBeNull();
  });

  it.each(['request', 'heartbeat'] as const)('rejects expired browser HTTP access and closes its existing socket on %s', async (trigger) => {
    let now = Date.parse('2026-09-23T00:00:00.000Z');
    const handler = vi.fn(() => emptyBootstrap());
    const fixture = await startFixture(handler, { heartbeatMs: trigger === 'heartbeat' ? 20 : 60_000 }, () => now);
    const cookie = (await fixture.auth.exchangePairingToken(fixture.auth.createPairingToken().token))!.split(';', 1)[0]!;
    const socket = await openWebSocket(fixture.origin, cookie);
    await sendAndReceive(socket, { type: 'request', id: 'before-expiry', command: 'app:bootstrap', args: [] });
    expect(handler).toHaveBeenCalledTimes(1);
    const close = closed(socket);
    now += BROWSER_SESSION_MAX_AGE_SECONDS * 1_000;
    if (trigger === 'request') socket.send(JSON.stringify({ type: 'request', id: 'expired', command: 'app:bootstrap', args: [] }));
    await expect(close).resolves.toBe(1008);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await fetch(`${fixture.origin}/api/auth/sessions`, { headers: { Cookie: cookie } })).status).toBe(401);
    expect(await (await fetch(`${fixture.origin}/api/auth/descriptor`, { headers: { Cookie: cookie } })).json()).toMatchObject({ authenticated: false });
  });

  it('caps in-flight requests at 32 and times out bounded commands', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    const fixture = await startFixture(() => pending, { commandTimeoutMs: 50 });
    const socket = await fixture.socket();
    // Hold the command timers so a slow runner cannot time out a request and free a slot
    // before the 33rd request arrives. Socket I/O stays real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (let index = 0; index < 32; index += 1) {
        socket.send(JSON.stringify({ type: 'request', id: `pending-${index}`, command: 'app:bootstrap', args: [] }));
      }
      const limited = nextMessage(socket);
      socket.send(JSON.stringify({ type: 'request', id: 'limited', command: 'app:bootstrap', args: [] }));
      expect(await limited).toMatchObject({
        type: 'result', id: 'limited', result: { ok: false, error: { message: 'Too many in-flight requests.' } },
      });

      const timedOut = waitForMessage(socket, (message) => isResult(message) && message.id === 'pending-0');
      await vi.advanceTimersByTimeAsync(50);
      expect(await timedOut).toMatchObject({ result: { ok: false, error: { code: 'TIMEOUT' } } });
    } finally {
      vi.useRealTimers();
      release(emptyBootstrap());
    }
  });

  it('aborts the command when its server timeout expires', async () => {
    let aborted = false;
    const fixture = await startFixture((context) => new Promise((resolve) => {
      context.signal.addEventListener('abort', () => {
        aborted = true;
        resolve(emptyBootstrap());
      }, { once: true });
    }), { commandTimeoutMs: 50 });
    const socket = await fixture.socket();

    const response = await sendAndReceive(socket, { type: 'request', id: 'timeout', command: 'app:bootstrap', args: [] });

    expect(response).toMatchObject({ result: { ok: false, error: { code: 'TIMEOUT' } } });
    expect(aborted).toBe(true);
  });

  it.each([
    ['plain 5 MiB', 'x', 5 * 1024 * 1024],
    ['JSON escapes', '\u0000', 1024 * 1024],
    ['UTF-8', '€', 2 * 1024 * 1024],
  ])('returns a typed error for %s on an empty queue and keeps the socket usable', async (_label, content, count) => {
    const fixture = await startFixture(() => ({ payload: content.repeat(count) }));
    const socket = await fixture.socket();
    const response = await sendAndReceive(socket, { type: 'request', id: 'large-result', command: 'app:bootstrap', args: [] });
    expect(response).toMatchObject({ type: 'result', id: 'large-result', result: { ok: false, error: {
      code: 'RESPONSE_TOO_LARGE', maxBytes: OPEN_TIG_MAX_SERVER_MESSAGE_BYTES,
    } } });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(await sendAndReceive(socket, { type: 'ping' })).toEqual({ type: 'pong' });
    expect(await sendAndReceive(socket, { type: 'request', id: 'recovered', command: 'repository:write-file', args: ['repository', 'small.txt', 'x', ''] }))
      .toMatchObject({ result: { ok: true } });
    socket.close();
  });

  it('accepts exactly the byte limit and rejects one more byte without truncating', async () => {
    const envelope = { type: 'result', id: 'boundary', result: { ok: true, value: { payload: '', server: { protocolVersion: 1, appVersion: 'test' } } } };
    const overhead = Buffer.byteLength(JSON.stringify(envelope));
    let payload = 'x'.repeat(OPEN_TIG_MAX_SERVER_MESSAGE_BYTES - overhead);
    const fixture = await startFixture(() => ({ payload }));
    const socket = await fixture.socket();
    const response = await sendAndReceive(socket, { type: 'request', id: 'boundary', command: 'app:bootstrap', args: [] });
    expect(Buffer.byteLength(JSON.stringify(response))).toBe(OPEN_TIG_MAX_SERVER_MESSAGE_BYTES);
    expect(response).toEqual({ ...envelope, result: { ...envelope.result, value: { ...envelope.result.value, payload } } });
    payload += 'x';
    expect(await sendAndReceive(socket, { type: 'request', id: 'boundary', command: 'app:bootstrap', args: [] }))
      .toMatchObject({ result: { ok: false, error: { code: 'RESPONSE_TOO_LARGE' } } });
    socket.close();
  });

  it('still requires authenticated HTTP for images rather than sending image bytes on the socket', async () => {
    const fixture = await startFixture(() => emptyBootstrap());
    const socket = await fixture.socket();
    expect(await sendAndReceive(socket, { type: 'request', id: 'image', command: 'repository:read-image', args: ['repository', 'image.png'] }))
      .toMatchObject({ result: { ok: false, error: { message: 'Image previews use authenticated HTTP.' } } });
    socket.close();
  });

  it('closes a genuinely backpressured TCP peer and leaves another client and reconnection usable', async () => {
    const fixture = await startFixture(() => ({ payload: 'x'.repeat(2 * 1024 * 1024) }));
    const slow = await fixture.socket();
    const healthy = await fixture.socket();
    const slowClosed = closed(slow);
    const original = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount')!.get!;
    let peakBuffered = 0;
    let sendAttempts = 0;
    // Only the server reads bufferedAmount, once per response it tries to send.
    const observed = vi.spyOn(WebSocket.prototype, 'bufferedAmount', 'get').mockImplementation(function (this: WebSocket) {
      const bytes = original.call(this) as number;
      sendAttempts += 1;
      peakBuffered = Math.max(peakBuffered, bytes);
      return bytes;
    });
    try {
      slow.pause(); // Real ws/TCP reads stop; send and bufferedAmount stay native.
      // Send one request at a time until the unread responses exceed the OS socket buffers.
      for (let index = 0; index < 32 && peakBuffered <= 6 * 1024 * 1024; index += 1) {
        slow.send(JSON.stringify({ type: 'request', id: `slow-${index}`, command: 'app:bootstrap', args: [] }));
        await vi.waitFor(() => expect(sendAttempts).toBe(index + 1), { timeout: 5_000, interval: 5 });
      }
      slow.resume();
      await expect(slowClosed).resolves.toBe(1013);
      expect(peakBuffered).toBeGreaterThan(6 * 1024 * 1024);
      expect(await sendAndReceive(healthy, { type: 'request', id: 'healthy', command: 'repository:write-file', args: ['repository', 'small.txt', 'x', ''] }))
        .toMatchObject({ result: { ok: true } });
      const recovered = await fixture.socket();
      expect(await sendAndReceive(recovered, { type: 'ping' })).toEqual({ type: 'pong' });
      recovered.close();
      healthy.close();
    } finally {
      slow.resume();
      observed.mockRestore();
    }
  });

  it('rechecks authentication before delivering an asynchronously completed response', async () => {
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const fixture = await startFixture(() => new Promise((resolve) => { finish = resolve; started(); }));
    const cookie = (await fixture.auth.exchangePairingToken(fixture.auth.createPairingToken().token))!.split(';', 1)[0]!;
    const sessionId = fixture.auth.authenticate({ cookie })!;
    const socket = await openWebSocket(fixture.origin, cookie);
    const messages = vi.fn();
    socket.on('message', messages);
    const close = closed(socket);
    socket.send(JSON.stringify({ type: 'request', id: 'revoked', command: 'app:bootstrap', args: [] }));
    await running;
    await fixture.auth.revokeBrowserSession(sessionId);
    finish({ payload: 'x'.repeat(5 * 1024 * 1024) });
    await expect(close).resolves.toBe(1008);
    expect(messages).not.toHaveBeenCalled();
  });

  it('allows the bounded text-write exception above the normal frame limit', async () => {
    const fixture = await startFixture(() => emptyBootstrap());
    const socket = await fixture.socket();
    const response = await sendAndReceive(socket, {
      type: 'request',
      id: 'write',
      command: 'repository:write-file',
      args: ['repository', 'large.txt', 'x'.repeat(2 * 1024 * 1024), ''],
    });
    expect(response).toMatchObject({ type: 'result', id: 'write', result: { ok: true, value: { status: 'saved' } } });
  });

  it('enforces the configured connection limit', async () => {
    const fixture = await startFixture(() => emptyBootstrap(), { connectionLimit: 1 });
    const first = await fixture.socket();
    const failed = fixture.socket();
    await expect(failed).rejects.toThrow('Unexpected server response: 503');
    first.close();
  });

  it('keeps owner-session state while another tab remains connected', async () => {
    const fixture = await startFixture((context: CommandExecutionContext) => {
      const shared = context.state('shared', () => ({ count: 0 }));
      shared.count += 1;
      return { ...emptyBootstrap(), count: shared.count };
    });
    const first = await fixture.socket();
    const second = await fixture.socket();

    expect(await sendAndReceive(first, { type: 'request', id: 'first', command: 'app:bootstrap', args: [] }))
      .toMatchObject({ result: { value: { count: 1 } } });
    expect(await sendAndReceive(second, { type: 'request', id: 'second', command: 'app:bootstrap', args: [] }))
      .toMatchObject({ result: { value: { count: 2 } } });
    const firstClosed = closed(first);
    first.close();
    await firstClosed;
    expect(await sendAndReceive(second, { type: 'request', id: 'third', command: 'app:bootstrap', args: [] }))
      .toMatchObject({ result: { value: { count: 3 } } });
    second.close();
  });

  it('rate-limits requests within a bounded window', async () => {
    const fixture = await startFixture(() => emptyBootstrap(), { requestRateLimit: 2, requestRateWindowMs: 60_000 });
    const socket = await fixture.socket();
    await sendAndReceive(socket, { type: 'request', id: 'one', command: 'app:bootstrap', args: [] });
    await sendAndReceive(socket, { type: 'request', id: 'two', command: 'app:bootstrap', args: [] });
    const limited = await sendAndReceive(socket, { type: 'request', id: 'three', command: 'app:bootstrap', args: [] });
    expect(limited).toMatchObject({ result: { ok: false, error: { message: 'Request rate limit exceeded.' } } });
  });

  it('stops idempotently, closes clients, and closes its runtime once', async () => {
    const fixture = await startFixture(() => emptyBootstrap());
    const socket = await fixture.socket();
    const socketClosed = closed(socket);
    await Promise.all([fixture.server.stop(), fixture.server.stop()]);
    await expect(socketClosed).resolves.toBe(1001);
    expect(fixture.closeRuntime).toHaveBeenCalledTimes(1);
    await expect(fetch(`${fixture.origin}/healthz`)).rejects.toThrow();
  });
});

async function startFixture(
  handler: (context: CommandExecutionContext, args: readonly unknown[]) => Promise<unknown> | unknown,
  limits: { commandTimeoutMs?: number; connectionLimit?: number; requestRateLimit?: number; requestRateWindowMs?: number; heartbeatMs?: number } = {},
  now?: () => number,
): Promise<Fixture> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-ws-limits-'));
  directories.push(directory);
  const clientRoot = path.join(directory, 'client');
  await mkdir(clientRoot);
  await writeFile(path.join(clientRoot, 'index.html'), '<!doctype html>');
  const registry = new CommandRegistry();
  registry.registerHandler(OPEN_TIG_SERVER_COMMANDS['app.bootstrap'], handler);
  registry.registerHandler(OPEN_TIG_SERVER_COMMANDS['repository.writeFile'], () => ({
    status: 'saved', path: 'large.txt', size: 0, mtimeMs: 0,
  }));
  const desktopSecret = `desktop-${crypto.randomUUID()}`;
  const auth = await OpenTigSessionAuth.open({
    source: new OneTimeBootstrapAuthSource({ desktopSecret }),
    dataDirectory: path.join(directory, 'auth'),
    ...(now ? { now } : {}),
  });
  const closeRuntime = vi.fn(async () => undefined);
  const logger = vi.fn();
  const runtime = { close: closeRuntime, services: { files: {} } } as unknown as OpenTigRuntime;
  const server = new OpenTigServer({
    network: { webAccessEnabled: true, lanAccessEnabled: false, publicOrigin: null, listenerHost: '127.0.0.1', listenerPort: 0 },
    networkSettings: new NetworkSettings(path.join(directory, 'web-access.json')),
    runtime,
    registry,
    clientRoot,
    auth,
    identity: { protocolVersion: 1, appVersion: 'test' },
    port: 0,
    logger,
    ...limits,
  });
  const address = await server.start();
  const response = await fetch(`${address.origin}/api/auth/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: address.origin },
    body: JSON.stringify({ secret: desktopSecret }),
  });
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Authentication cookie missing.');
  const fixture: Fixture = {
    auth,
    server,
    origin: address.origin,
    closeRuntime,
    logger,
    socket: () => openWebSocket(address.origin, cookie),
  };
  fixtures.push(fixture);
  return fixture;
}

function performanceRecords(fixture: Fixture): Array<Record<string, string | number>> {
  return fixture.logger.mock.calls.flatMap(([, message]) => {
    const prefix = 'WebSocket performance ';
    return typeof message === 'string' && message.startsWith(prefix)
      ? [JSON.parse(message.slice(prefix.length)) as Record<string, string | number>]
      : [];
  });
}

function openWebSocket(origin: string, cookie: string): Promise<WebSocket> {
  const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/ws', { headers: { Origin: origin, Cookie: cookie } });
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      reject(new Error(`Unexpected server response: ${response.statusCode}`));
    });
    socket.once('error', reject);
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

function waitForMessage(socket: WebSocket, predicate: (message: unknown) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as unknown;
        if (!predicate(message)) return;
        socket.off('message', onMessage);
        resolve(message);
      } catch (error) {
        socket.off('message', onMessage);
        reject(error);
      }
    };
    socket.on('message', onMessage);
    socket.once('error', reject);
  });
}

function isResult(value: unknown): value is { type: 'result'; id: string } {
  const candidate = value as { type?: unknown; id?: unknown } | null;
  return candidate?.type === 'result' && typeof candidate.id === 'string';
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}

function emptyBootstrap() {
  return {
    recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    activeRepository: null, preferences: {}, performanceAutomation: false,
  };
}
