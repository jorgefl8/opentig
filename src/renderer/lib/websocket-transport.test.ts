import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/contracts';
import { clientCommandTimeoutMs } from '@shared/protocol';
import {
  OpenTigWebSocketTransport,
  isConnectionLoss,
  isUnconfirmedResult,
  ServerAuthenticationError,
  ServerDisconnectedError,
  ServerRequestTimeoutError,
  ServerResponseTooLargeError,
  ServerBackpressureError,
} from './websocket-transport';

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  send(data: string): void { this.sent.push(data); }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) });
    this.serverClose(code ?? 1000);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }

  serverClose(code = 1006): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

function fixture(options: ConstructorParameters<typeof OpenTigWebSocketTransport>[0] = {}) {
  const sockets: FakeSocket[] = [];
  const transport = new OpenTigWebSocketTransport({
    url: 'ws://127.0.0.1/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    requestTimeoutMs: 1_000,
    heartbeatMs: 10_000,
    reconnectBaseMs: 100,
    reconnectMaxMs: 400,
    random: () => 0.5,
    ...options,
  });
  return { transport, sockets };
}

const BUSY = { code: 'SERVER_BUSY', operation: 'server-protocol', message: 'Too many in-flight requests.', retryable: true };

afterEach(() => {
  vi.useRealTimers();
});

describe('OpenTigWebSocketTransport', () => {
  it('rejects an oversized response with typed detail and completes another request on the same socket', async () => {
    const { transport, sockets } = fixture();
    const result = transport.request(IPC.capabilities, []);
    sockets[0]!.open();
    await Promise.resolve();
    const { id } = JSON.parse(sockets[0]!.sent[0]!) as { id: string };
    sockets[0]!.message({ type: 'result', id, result: { ok: false, error: {
      code: 'RESPONSE_TOO_LARGE', operation: 'server-protocol', message: 'Too large.', maxBytes: 4 * 1024 * 1024,
    } } });
    await expect(result).rejects.toBeInstanceOf(ServerResponseTooLargeError);
    await expect(result).rejects.toMatchObject({ detail: { code: 'RESPONSE_TOO_LARGE', maxBytes: 4 * 1024 * 1024 } });
    expect(transport.getState()).toBe('connected');
    const next = transport.request(IPC.capabilities, []);
    await Promise.resolve();
    const second = JSON.parse(sockets[0]!.sent[1]!) as { id: string };
    sockets[0]!.message({ type: 'result', id: second.id, result: { ok: true, value: { runtimeMode: 'headless' } } });
    await expect(next).resolves.toMatchObject({ runtimeMode: 'headless' });
    expect(sockets).toHaveLength(1);
    transport.close();
  });

  it('classifies a full send queue and reconnects without replaying requests', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture();
    const pending = transport.request(IPC.capabilities, []);
    sockets[0]!.open();
    await Promise.resolve();
    const rejected = expect(pending).rejects.toBeInstanceOf(ServerBackpressureError);
    sockets[0]!.serverClose(1013);
    await rejected;
    await vi.advanceTimersByTimeAsync(100);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([]);
    transport.close();
  });
  it('correlates a request made while the first connection is opening', async () => {
    const { transport, sockets } = fixture();
    const result = transport.request(IPC.capabilities, []);
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    await Promise.resolve();

    const request = JSON.parse(sockets[0]!.sent[0]!) as { id: string; command: string; args: unknown[] };
    expect(request).toMatchObject({ type: 'request', command: IPC.capabilities, args: [] });
    sockets[0]!.message({ type: 'result', id: request.id, result: { ok: true, value: { runtimeMode: 'headless' } } });

    await expect(result).resolves.toMatchObject({ runtimeMode: 'headless' });
    transport.close();
  });

  it('omits trailing optional arguments instead of serializing them as null', async () => {
    const { transport, sockets } = fixture();
    const status = transport.request(IPC.repositoryStatus, ['repo-id', undefined]);
    sockets[0]!.open();
    await Promise.resolve();

    const request = JSON.parse(sockets[0]!.sent[0]!) as { id: string; command: string; args: unknown[] };
    expect(request).toMatchObject({ command: IPC.repositoryStatus, args: ['repo-id'] });
    sockets[0]!.message({ type: 'result', id: request.id, result: { ok: true, value: { changes: [] } } });

    await expect(status).resolves.toMatchObject({ changes: [] });
    transport.close();
  });

  it('rejects sent requests on disconnect and never replays them', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture();
    const promise = transport.request(IPC.commitCreate, ['repo-id', 'message']);
    sockets[0]!.open();
    await Promise.resolve();
    expect(sockets[0]!.sent).toHaveLength(1);
    const rejection = expect(promise).rejects.toBeInstanceOf(ServerDisconnectedError);

    sockets[0]!.serverClose();
    await rejection;
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([]);
    transport.close();
  });

  it('supports cancellation and bounded request timeouts', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ requestTimeoutMs: 50 });
    const controller = new AbortController();
    const cancelled = transport.request(IPC.capabilities, [], { signal: controller.signal });
    sockets[0]!.open();
    await Promise.resolve();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    const timedOut = transport.request(IPC.capabilities, []);
    const timeoutRejection = expect(timedOut).rejects.toBeInstanceOf(ServerRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await timeoutRejection;
    transport.close();
  });

  it('waits for each command as long as the protocol allows', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ requestTimeoutMs: undefined as unknown as number, heartbeatMs: 60 * 60_000 });
    let settled = false;
    const slow = transport.request(IPC.refsPull, ['repo-id']).catch((reason: unknown) => { settled = true; return reason; });
    sockets[0]!.open();
    await Promise.resolve();
    const budget = clientCommandTimeoutMs(IPC.refsPull);
    expect(budget).toBeGreaterThan(30_000);

    await vi.advanceTimersByTimeAsync(budget - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const reason = await slow;
    expect(reason).toBeInstanceOf(ServerRequestTimeoutError);
    expect(isUnconfirmedResult(reason)).toBe(true);
    transport.close();
  });

  it('keeps the connection wait short and does not send a request that timed out waiting', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ requestTimeoutMs: undefined as unknown as number });
    const waiting = transport.request(IPC.worktreeRemove, [{ repositoryId: 'repo-id', path: '/sample/review', expectedOid: 'a'.repeat(40), force: false, deleteBranch: false }])
      .catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(30_000);
    const reason = await waiting;
    expect(reason).toBeInstanceOf(ServerRequestTimeoutError);
    expect(isUnconfirmedResult(reason)).toBe(false);
    expect(isConnectionLoss(reason)).toBe(true);

    sockets[0]!.open();
    await Promise.resolve();
    expect(sockets[0]!.sent).toEqual([]);
    transport.close();
  });

  it('reports only a change interrupted by a disconnect as unconfirmed', async () => {
    const { transport, sockets } = fixture();
    const change = transport.request(IPC.commitCreate, ['repo-id', 'message']).catch((reason: unknown) => reason);
    const read = transport.request(IPC.capabilities, []).catch((reason: unknown) => reason);
    sockets[0]!.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets[0]!.sent).toHaveLength(2);
    sockets[0]!.serverClose(1006);
    expect(await change).toBeInstanceOf(ServerDisconnectedError);
    expect(isUnconfirmedResult(await change)).toBe(true);
    expect(isUnconfirmedResult(await read)).toBe(false);
    expect(isConnectionLoss(await read)).toBe(true);
    transport.close();
  });

  it('does not call a read that ran out of time unconfirmed', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ requestTimeoutMs: 50 });
    const read = transport.request(IPC.capabilities, []).catch((reason: unknown) => reason);
    sockets[0]!.open();
    await vi.advanceTimersByTimeAsync(50);
    expect(await read).toBeInstanceOf(ServerRequestTimeoutError);
    expect(isUnconfirmedResult(await read)).toBe(false);
    transport.close();
  });

  it.each([
    [4000, 'stopped responding'],
    [1001, 'restarted or shut down'],
    [1006, 'ended unexpectedly'],
  ])('keeps why the connection closed with code %i', async (code, cause) => {
    const { transport, sockets } = fixture();
    const pending = transport.request(IPC.capabilities, []).catch((reason: unknown) => reason);
    sockets[0]!.open();
    await Promise.resolve();
    sockets[0]!.serverClose(code);
    expect(await pending).toMatchObject({ closeCode: code, message: expect.stringContaining(cause) });
    transport.close();
  });

  it('recognizes a server timeout as unconfirmed but not an ordinary failure', async () => {
    const { transport, sockets } = fixture();
    const timedOut = transport.request(IPC.commitCreate, ['repo-id', 'message']).catch((reason: unknown) => reason);
    const failed = transport.request(IPC.commitCreate, ['repo-id', 'message']).catch((reason: unknown) => reason);
    sockets[0]!.open();
    await Promise.resolve();
    await Promise.resolve();
    const [first, second] = sockets[0]!.sent.map((raw) => (JSON.parse(raw) as { id: string }).id);
    sockets[0]!.message({ type: 'result', id: first, result: { ok: false, error: { code: 'TIMEOUT', operation: IPC.commitCreate, message: 'Command timed out.', unconfirmed: true } } });
    sockets[0]!.message({ type: 'result', id: second, result: { ok: false, error: { code: 'TIMEOUT', operation: 'commit', message: 'Git took too long.' } } });
    expect(isUnconfirmedResult(await timedOut)).toBe(true);
    expect(isUnconfirmedResult(await failed)).toBe(false);
    transport.close();
  });

  it('stops reconnecting when the server rejects authentication', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture();
    const states: string[] = [];
    transport.subscribeState(() => states.push(transport.getState()));
    const pending = transport.request(IPC.capabilities, []);
    const rejection = expect(pending).rejects.toBeInstanceOf(ServerAuthenticationError);

    sockets[0]!.serverClose(1008);
    await rejection;
    expect(transport.getState()).toBe('auth-required');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
    expect(states).toContain('auth-required');
  });

  it('classifies authentication rejection after the socket opens for in-flight bootstrap', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture();
    const pending = transport.request(IPC.bootstrap, []);
    const rejection = expect(pending).rejects.toBeInstanceOf(ServerAuthenticationError);
    sockets[0]!.open();
    await Promise.resolve();
    expect(sockets[0]!.sent).toHaveLength(1);

    sockets[0]!.serverClose(1008);
    await rejection;
    expect(transport.getState()).toBe('auth-required');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
    transport.close();
  });

  it('keeps a waiting request to its own time limit and never sends it afterwards', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ maxInFlight: 1 });
    const running = transport.request(IPC.capabilities, []);
    sockets[0]!.open();
    const waiting = transport.request(IPC.commitCreate, ['repo-id', 'message'], { timeoutMs: 50 }).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(50);
    expect(await waiting).toBeInstanceOf(ServerRequestTimeoutError);
    // The commit never left the client, so there is nothing to check before trying again.
    expect(isUnconfirmedResult(await waiting)).toBe(false);

    const { id } = JSON.parse(sockets[0]!.sent[0]!) as { id: string };
    sockets[0]!.message({ type: 'result', id, result: { ok: true, value: { runtimeMode: 'headless' } } });
    await expect(running).resolves.toMatchObject({ runtimeMode: 'headless' });
    expect(sockets[0]!.sent).toHaveLength(1);
    transport.close();
  });

  it('fails waiting requests on disconnect without calling an unsent change unconfirmed', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ maxInFlight: 1 });
    const sent = transport.request(IPC.commitCreate, ['repo-id', 'first']).catch((reason: unknown) => reason);
    const waiting = transport.request(IPC.commitCreate, ['repo-id', 'second']).catch((reason: unknown) => reason);
    sockets[0]!.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets[0]!.sent).toHaveLength(1);

    sockets[0]!.serverClose(1006);
    expect(await sent).toBeInstanceOf(ServerDisconnectedError);
    expect(await waiting).toBeInstanceOf(ServerDisconnectedError);
    expect(isUnconfirmedResult(await sent)).toBe(true);
    expect(isUnconfirmedResult(await waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([]);
    transport.close();
  });

  it('sends a request the server was too busy to run again, without reporting the refusal', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture();
    const commit = transport.request(IPC.commitCreate, ['repo-id', 'message']);
    sockets[0]!.open();
    await Promise.resolve();
    const first = JSON.parse(sockets[0]!.sent[0]!) as { id: string };
    sockets[0]!.message({ type: 'result', id: first.id, result: { ok: false, error: BUSY } });
    expect(sockets[0]!.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(sockets[0]!.sent).toHaveLength(2);
    const second = JSON.parse(sockets[0]!.sent[1]!) as { id: string; command: string; args: unknown[] };
    expect(second).toMatchObject({ command: IPC.commitCreate, args: ['repo-id', 'message'] });
    expect(second.id).not.toBe(first.id);
    sockets[0]!.message({ type: 'result', id: second.id, result: { ok: true, value: { oid: 'abc' } } });
    await expect(commit).resolves.toEqual({ oid: 'abc' });
    transport.close();
  });

  it('gives up on a server that stays busy as a timeout, never as the refusal itself', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ requestTimeoutMs: 1_000 });
    const commit = transport.request(IPC.commitCreate, ['repo-id', 'message']).catch((reason: unknown) => reason);
    sockets[0]!.open();
    const socket = sockets[0]!;
    const send = socket.send.bind(socket);
    socket.send = (data: string) => {
      send(data);
      const { id } = JSON.parse(data) as { id: string };
      queueMicrotask(() => socket.message({ type: 'result', id, result: { ok: false, error: BUSY } }));
    };
    await vi.advanceTimersByTimeAsync(1_000);
    const reason = await commit;
    expect(reason).toBeInstanceOf(ServerRequestTimeoutError);
    expect(reason).not.toHaveProperty('detail');
    // Every attempt was refused before it ran.
    expect(isUnconfirmedResult(reason)).toBe(false);
    expect(socket.sent.length).toBeGreaterThan(1);
    transport.close();
  });

  it('heartbeats and reconnects when no pong arrives', async () => {
    vi.useFakeTimers();
    const { transport, sockets } = fixture({ heartbeatMs: 50 });
    transport.subscribeState(() => undefined);
    sockets[0]!.open();

    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'ping' });
    await vi.advanceTimersByTimeAsync(50);
    expect(sockets[0]!.closeCalls).toContainEqual({ code: 4000, reason: 'Heartbeat timeout' });
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    transport.close();
  });
});
