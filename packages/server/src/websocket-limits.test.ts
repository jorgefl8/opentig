import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { CommandRegistry, type CommandExecutionContext } from '../../../src/main/runtime/CommandRegistry';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import { OPEN_TIG_SERVER_COMMANDS } from '../../../src/shared/protocol';
import { OneTimeBootstrapAuthSource, OpenTigSessionAuth } from './auth';
import { OpenTigServer } from './OpenTigServer';

interface Fixture {
  server: OpenTigServer;
  origin: string;
  socket(): Promise<WebSocket>;
  closeRuntime: ReturnType<typeof vi.fn>;
}

const fixtures: Fixture[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(fixtures.splice(0).map((fixture) => fixture.server.stop()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('WebSocket safety limits', () => {
  it('caps in-flight requests at 32 and times out bounded commands', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    const fixture = await startFixture(() => pending, { commandTimeoutMs: 50 });
    const socket = await fixture.socket();

    for (let index = 0; index < 32; index += 1) {
      socket.send(JSON.stringify({ type: 'request', id: `pending-${index}`, command: 'app:bootstrap', args: [] }));
    }
    const limited = nextMessage(socket);
    socket.send(JSON.stringify({ type: 'request', id: 'limited', command: 'app:bootstrap', args: [] }));
    expect(await limited).toMatchObject({
      type: 'result', id: 'limited', result: { ok: false, error: { message: 'Too many in-flight requests.' } },
    });

    const timedOut = await waitForMessage(socket, (message) => isResult(message) && message.id === 'pending-0');
    expect(timedOut).toMatchObject({ result: { ok: false, error: { code: 'TIMEOUT' } } });
    release(emptyBootstrap());
  });

  it('disconnects a client when one result would exceed the bounded send queue', async () => {
    const fixture = await startFixture(() => ({ payload: 'x'.repeat(5 * 1024 * 1024) }));
    const socket = await fixture.socket();
    const close = closed(socket);
    socket.send(JSON.stringify({ type: 'request', id: 'large-result', command: 'app:bootstrap', args: [] }));
    await expect(close).resolves.toBe(1013);
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
  limits: { commandTimeoutMs?: number; connectionLimit?: number; requestRateLimit?: number; requestRateWindowMs?: number } = {},
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
  });
  const closeRuntime = vi.fn(async () => undefined);
  const runtime = { close: closeRuntime, services: { files: {} } } as unknown as OpenTigRuntime;
  const server = new OpenTigServer({
    runtime,
    registry,
    clientRoot,
    auth,
    identity: { protocolVersion: 1, appVersion: 'test' },
    port: 0,
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
    server,
    origin: address.origin,
    closeRuntime,
    socket: () => openWebSocket(address.origin, cookie),
  };
  fixtures.push(fixture);
  return fixture;
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
