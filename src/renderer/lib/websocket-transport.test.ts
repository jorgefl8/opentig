import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/contracts';
import {
  OpenTigWebSocketTransport,
  ServerAuthenticationError,
  ServerDisconnectedError,
  ServerRequestTimeoutError,
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

afterEach(() => {
  vi.useRealTimers();
});

describe('OpenTigWebSocketTransport', () => {
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
