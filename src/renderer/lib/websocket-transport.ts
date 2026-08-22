import type { IpcResult } from '@shared/contracts';
import type { OpenTigServerCommandMap } from '@shared/protocol';
import type { OpenTigRuntimeEvent } from '@shared/runtime-events';
import type { OpenTigServerMessage } from '@shared/server-protocol';

export type ServerConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'auth-required'
  | 'incompatible-version'
  | 'offline';

export interface WebSocketTransportOptions {
  url?: string;
  createSocket?: (url: string) => WebSocket;
  requestTimeoutMs?: number;
  heartbeatMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  offlineAfterAttempts?: number;
  random?: () => number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
}

interface ConnectionWaiter {
  resolve(): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
}

const SOCKET_OPEN = 1;

export class ServerTransportError extends Error {}
export class ServerDisconnectedError extends ServerTransportError {}
export class ServerAuthenticationError extends ServerTransportError {}
export class ServerVersionError extends ServerTransportError {}
export class ServerRequestTimeoutError extends ServerTransportError {}

/** One non-replaying request/event transport shared by desktop and browsers. */
export class OpenTigWebSocketTransport {
  private readonly url: string;
  private readonly createSocket: (url: string) => WebSocket;
  private readonly requestTimeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly offlineAfterAttempts: number;
  private readonly random: () => number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly connectionWaiters = new Set<ConnectionWaiter>();
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: OpenTigRuntimeEvent) => void>();
  private readonly reconnectListeners = new Set<() => void | Promise<void>>();
  private socket: WebSocket | null = null;
  private state: ServerConnectionState = 'connecting';
  private requestSequence = 0;
  private socketGeneration = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private awaitingPong = false;
  private started = false;
  private stopped = false;
  private connectedBefore = false;

  constructor(options: WebSocketTransportOptions = {}) {
    this.url = options.url ?? defaultWebSocketUrl();
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? 20_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 250;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5_000;
    this.offlineAfterAttempts = options.offlineAfterAttempts ?? 5;
    this.random = options.random ?? Math.random;
  }

  getState = (): ServerConnectionState => this.state;

  subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    this.start();
    return () => this.stateListeners.delete(listener);
  };

  onEvent(listener: (event: OpenTigRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    this.start();
    return () => this.eventListeners.delete(listener);
  }

  onReconnect(listener: () => void | Promise<void>): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  async request<Command extends keyof OpenTigServerCommandMap>(
    command: Command,
    args: OpenTigServerCommandMap[Command]['args'],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<OpenTigServerCommandMap[Command]['result']> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const startedAt = Date.now();
    this.start();
    await this.waitForConnection(timeoutMs, options.signal);
    if (options.signal?.aborted) throw abortError();
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) throw new ServerDisconnectedError('OpenTig server disconnected.');

    const id = `${Date.now().toString(36)}-${(++this.requestSequence).toString(36)}`;
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    return new Promise<OpenTigServerCommandMap[Command]['result']>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.finishPending(id);
          reject(new ServerRequestTimeoutError(`Server request timed out: ${String(command)}`));
        }, remaining),
        ...(options.signal ? { signal: options.signal } : {}),
      };
      if (options.signal) {
        pending.abort = () => {
          this.finishPending(id);
          reject(abortError());
        };
        options.signal.addEventListener('abort', pending.abort, { once: true });
      }
      this.pending.set(id, pending);
      try {
        const wireArgs: unknown[] = [...args];
        while (wireArgs.length > 0 && wireArgs.at(-1) === undefined) wireArgs.pop();
        socket.send(JSON.stringify({ type: 'request', id, command, args: wireArgs }));
      } catch {
        this.finishPending(id);
        reject(new ServerDisconnectedError('Could not send request to the OpenTig server.'));
      }
    });
  }

  markIncompatible(): void {
    this.stopped = true;
    this.clearReconnect();
    this.setState('incompatible-version');
    this.rejectConnectionWaiters(new ServerVersionError('OpenTig server protocol is incompatible.'));
    this.rejectPending(new ServerVersionError('OpenTig server protocol is incompatible.'));
    this.socket?.close(1000, 'Incompatible protocol');
  }

  close(): void {
    this.stopped = true;
    this.clearReconnect();
    this.clearHeartbeat();
    this.rejectConnectionWaiters(new ServerDisconnectedError('OpenTig server connection closed.'));
    this.rejectPending(new ServerDisconnectedError('OpenTig server connection closed.'));
    this.socket?.close(1000, 'Client closing');
    this.socket = null;
  }

  private start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    this.clearReconnect();
    const generation = ++this.socketGeneration;
    let socket: WebSocket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.disconnected(generation, 0);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.socketGeneration || this.stopped) return;
      const reconnected = this.connectedBefore;
      this.connectedBefore = true;
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.resolveConnectionWaiters();
      this.startHeartbeat();
      if (reconnected) {
        for (const listener of this.reconnectListeners) void Promise.resolve(listener()).catch(() => undefined);
      }
    };
    socket.onmessage = (event) => this.message(generation, event.data);
    socket.onerror = () => undefined;
    socket.onclose = (event) => this.disconnected(generation, event.code);
  }

  private message(generation: number, data: unknown): void {
    if (generation !== this.socketGeneration || typeof data !== 'string') return;
    let message: OpenTigServerMessage;
    try { message = JSON.parse(data) as OpenTigServerMessage; }
    catch { return; }
    if (message.type === 'pong') {
      this.awaitingPong = false;
      return;
    }
    if (message.type === 'event') {
      for (const listener of this.eventListeners) listener(message.event);
      return;
    }
    if (message.type !== 'result') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.finishPending(message.id);
    settleResult(pending, message.result);
  }

  private disconnected(generation: number, closeCode: number): void {
    if (generation !== this.socketGeneration) return;
    this.socket = null;
    this.clearHeartbeat();
    this.rejectPending(new ServerDisconnectedError('OpenTig server disconnected before the request completed.'));
    if (this.stopped) return;
    if (closeCode === 1008) {
      this.stopped = true;
      this.setState('auth-required');
      this.rejectConnectionWaiters(new ServerAuthenticationError('Authentication required.'));
      return;
    }
    this.reconnectAttempts += 1;
    this.setState(this.reconnectAttempts >= this.offlineAfterAttempts ? 'offline' : 'reconnecting');
    const exponential = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** (this.reconnectAttempts - 1)));
    const jittered = Math.max(0, Math.round(exponential * (0.5 + this.random())));
    this.reconnectTimer = setTimeout(() => this.connect(), jittered);
  }

  private waitForConnection(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.state === 'connected' && this.socket?.readyState === SOCKET_OPEN) return Promise.resolve();
    if (this.state === 'auth-required') return Promise.reject(new ServerAuthenticationError('Authentication required.'));
    if (this.state === 'incompatible-version') return Promise.reject(new ServerVersionError('OpenTig server protocol is incompatible.'));
    if (this.stopped) return Promise.reject(new ServerDisconnectedError('OpenTig server connection is closed.'));
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const waiter: ConnectionWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeConnectionWaiter(waiter);
          reject(new ServerRequestTimeoutError('Timed out waiting for the OpenTig server.'));
        }, timeoutMs),
        ...(signal ? { signal } : {}),
      };
      if (signal) {
        waiter.abort = () => {
          this.removeConnectionWaiter(waiter);
          reject(abortError());
        };
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.connectionWaiters.add(waiter);
    });
  }

  private resolveConnectionWaiters(): void {
    for (const waiter of [...this.connectionWaiters]) {
      this.removeConnectionWaiter(waiter);
      waiter.resolve();
    }
  }

  private rejectConnectionWaiters(error: Error): void {
    for (const waiter of [...this.connectionWaiters]) {
      this.removeConnectionWaiter(waiter);
      waiter.reject(error);
    }
  }

  private removeConnectionWaiter(waiter: ConnectionWaiter): void {
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.abort) waiter.signal.removeEventListener('abort', waiter.abort);
    this.connectionWaiters.delete(waiter);
  }

  private finishPending(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort);
    this.pending.delete(id);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of [...this.pending]) {
      this.finishPending(id);
      pending.reject(error);
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== SOCKET_OPEN) return;
      if (this.awaitingPong) {
        socket.close(4000, 'Heartbeat timeout');
        return;
      }
      this.awaitingPong = true;
      socket.send(JSON.stringify({ type: 'ping' }));
    }, this.heartbeatMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingPong = false;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: ServerConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener();
  }
}

function settleResult(pending: PendingRequest, result: IpcResult<unknown>): void {
  if (result.ok) {
    pending.resolve(result.value);
    return;
  }
  const error = new Error(result.error.message) as Error & { detail?: typeof result.error };
  error.detail = result.error;
  pending.reject(error);
}

function defaultWebSocketUrl(): string {
  const url = new URL('/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

function abortError(): Error {
  return new DOMException('The request was cancelled.', 'AbortError');
}
