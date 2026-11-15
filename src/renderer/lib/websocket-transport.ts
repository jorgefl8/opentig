import type { IpcResult } from '@shared/contracts';
import { CONNECTION_WAIT_TIMEOUT_MS } from '@shared/operation-timeouts';
import { clientCommandTimeoutMs, commandDefinition, type OpenTigServerCommandMap } from '@shared/protocol';
import type { OpenTigRuntimeEvent } from '@shared/runtime-events';
import { OPEN_TIG_CLIENT_MAX_BACKGROUND_REQUESTS, OPEN_TIG_CLIENT_MAX_IN_FLIGHT_REQUESTS, type OpenTigServerMessage } from '@shared/server-protocol';
import { serializedErrorFromReason, type SerializedResponseTooLargeError } from '@shared/errors';

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
  /** Replaces the per-command budgets from the protocol. */
  requestTimeoutMs?: number;
  connectionWaitMs?: number;
  heartbeatMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  offlineAfterAttempts?: number;
  random?: () => number;
  /** Requests sent and not yet answered. The rest wait here, in the client. */
  maxInFlight?: number;
  /** How many of those may be background requests. */
  maxBackgroundInFlight?: number;
}

/** Background requests wait behind every foreground one and never fill all the slots. */
export type RequestPriority = 'foreground' | 'background';

interface ClientRequest {
  command: string;
  args: unknown[];
  mutation: boolean;
  priority: RequestPriority;
  /** Position in line, kept when a refused request goes back to waiting. */
  order: number;
  timeoutMs: number;
  /** Set while the request is with the server; null while it waits for a slot. */
  id: string | null;
  /** When a request the server has not accepted yet stops waiting. */
  admissionDeadline: number;
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
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
const BUSY_RETRY_BASE_MS = 100;
const BUSY_RETRY_MAX_MS = 2_000;
/** A refusal comes straight back, so a request not refused within this time was accepted. */
const BUSY_PROBE_WAIT_MS = 250;

let ambientPriority: RequestPriority = 'foreground';

/**
 * Marks the requests `start` makes before it returns as background work, such as
 * icons and the state of repositories that are not open. They wait behind
 * anything the user is doing.
 */
export function inBackground<T>(start: () => T): T {
  const previous = ambientPriority;
  ambientPriority = 'background';
  try { return start(); }
  finally { ambientPriority = previous; }
}

export const UNCONFIRMED_RESULT_MESSAGE = 'OpenTig did not receive the result. The operation may have finished or may still be running, so check the current state before trying again.';

export class ServerTransportError extends Error {
  /** A change that reached the server, which may have finished or may still be running it. */
  unconfirmed = false;
}
export class ServerDisconnectedError extends ServerTransportError {
  constructor(message: string, readonly closeCode?: number) {
    super(message);
  }
}
export class ServerAuthenticationError extends ServerTransportError {}
export class ServerVersionError extends ServerTransportError {}
export class ServerRequestTimeoutError extends ServerTransportError {}
export class ServerBackpressureError extends ServerDisconnectedError {}
export class ServerResponseTooLargeError extends ServerTransportError {
  constructor(readonly detail: SerializedResponseTooLargeError) {
    super(detail.message);
    this.name = 'ServerResponseTooLargeError';
  }
}

/** One non-replaying request/event transport shared by desktop and browsers. */
export class OpenTigWebSocketTransport {
  private readonly url: string;
  private readonly createSocket: (url: string) => WebSocket;
  private readonly requestTimeoutMs: number | undefined;
  private readonly connectionWaitMs: number;
  private readonly heartbeatMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly offlineAfterAttempts: number;
  private readonly random: () => number;
  private readonly maxInFlight: number;
  private readonly maxBackgroundInFlight: number;
  /** Sent and waiting for their result. */
  private readonly pending = new Map<string, ClientRequest>();
  /** Not sent yet: every slot is taken, or the server asked the client to slow down. */
  private readonly waiting: Record<RequestPriority, ClientRequest[]> = { foreground: [], background: [] };
  private backgroundInFlight = 0;
  /**
   * `held` after the server refused a request for being too busy: nothing is
   * sent until `sendAfter`. Then one request goes out alone, `probing` whether
   * the server takes requests again, before the rest follow.
   */
  private admission: 'open' | 'held' | 'probing' = 'open';
  private probe: ClientRequest | null = null;
  private busyRefusals = 0;
  private sendAfter = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
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
  private readonly requested = new Map<string, number>();

  constructor(options: WebSocketTransportOptions = {}) {
    this.url = options.url ?? defaultWebSocketUrl();
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.connectionWaitMs = options.connectionWaitMs ?? CONNECTION_WAIT_TIMEOUT_MS;
    this.heartbeatMs = options.heartbeatMs ?? 20_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 250;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5_000;
    this.offlineAfterAttempts = options.offlineAfterAttempts ?? 5;
    this.random = options.random ?? Math.random;
    this.maxInFlight = options.maxInFlight ?? OPEN_TIG_CLIENT_MAX_IN_FLIGHT_REQUESTS;
    this.maxBackgroundInFlight = options.maxBackgroundInFlight ?? OPEN_TIG_CLIENT_MAX_BACKGROUND_REQUESTS;
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
    options: { signal?: AbortSignal; timeoutMs?: number; priority?: RequestPriority } = {},
  ): Promise<OpenTigServerCommandMap[Command]['result']> {
    // Read before the first await, while the caller that chose it is still on the stack.
    const priority = options.priority ?? ambientPriority;
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs ?? clientCommandTimeoutMs(command);
    this.start();
    await this.waitForConnection(Math.min(timeoutMs, this.connectionWaitMs), options.signal);
    if (options.signal?.aborted) throw abortError();
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) throw new ServerDisconnectedError('OpenTig server disconnected.');

    this.requested.set(command, (this.requested.get(command) ?? 0) + 1);
    const wireArgs: unknown[] = [...args];
    while (wireArgs.length > 0 && wireArgs.at(-1) === undefined) wireArgs.pop();
    return new Promise<OpenTigServerCommandMap[Command]['result']>((resolve, reject) => {
      const request: ClientRequest = {
        command,
        args: wireArgs,
        mutation: commandDefinition(command)?.mutation === true,
        priority,
        order: ++this.requestSequence,
        timeoutMs,
        id: null,
        admissionDeadline: Date.now() + timeoutMs,
        resolve,
        reject,
        timer: null,
        ...(options.signal ? { signal: options.signal } : {}),
      };
      if (options.signal) {
        request.abort = () => {
          this.finish(request);
          reject(abortError());
          this.drain();
        };
        options.signal.addEventListener('abort', request.abort, { once: true });
      }
      this.enqueue(request);
      this.drain();
    });
  }

  /**
   * How many requests each command has been asked for since the page loaded, and
   * how many are still unanswered. Diagnostics compare two readings to count what
   * a navigation costs; a request the server refused and took later counts once.
   */
  requestCounts(): { requested: Record<string, number>; unanswered: number } {
    return {
      requested: Object.fromEntries(this.requested),
      unanswered: this.pending.size + this.waiting.foreground.length + this.waiting.background.length,
    };
  }

  markIncompatible(): void {
    this.stopped = true;
    this.clearReconnect();
    this.setState('incompatible-version');
    this.rejectConnectionWaiters(new ServerVersionError('OpenTig server protocol is incompatible.'));
    this.rejectPending(() => new ServerVersionError('OpenTig server protocol is incompatible.'));
    this.socket?.close(1000, 'Incompatible protocol');
  }

  close(): void {
    this.stopped = true;
    this.clearReconnect();
    this.clearHeartbeat();
    this.rejectConnectionWaiters(new ServerDisconnectedError('OpenTig server connection closed.'));
    this.rejectPending(() => new ServerDisconnectedError('OpenTig server connection closed.'));
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
    const request = this.pending.get(message.id);
    if (!request) return;
    if (!message.result.ok && message.result.error.code === 'SERVER_BUSY') {
      // The server ran nothing, so the request goes back to its place in line. The first
      // refusal of a burst, or of a probe, starts a longer wait than the one before.
      this.release(request);
      if (this.admission !== 'held') {
        this.busyRefusals += 1;
        this.sendAfter = Date.now() + Math.min(BUSY_RETRY_MAX_MS, BUSY_RETRY_BASE_MS * (2 ** (this.busyRefusals - 1)));
        this.admission = 'held';
      }
      this.probe = null;
      this.enqueue(request);
    } else {
      if (request === this.probe) this.reopen();
      this.finish(request);
      settleResult(request, message.result);
    }
    this.drain();
  }

  private reopen(): void {
    this.admission = 'open';
    this.probe = null;
    this.busyRefusals = 0;
    this.sendAfter = 0;
  }

  /** Puts a request in line, where it gives up if no slot opens before its deadline. */
  private enqueue(request: ClientRequest): void {
    const giveUp = () => {
      this.finish(request);
      // Never sent, or refused before it ran: nothing happened on the server, so this is not an unconfirmed result.
      request.reject(new ServerRequestTimeoutError('The OpenTig server did not respond in time.'));
    };
    const remaining = request.admissionDeadline - Date.now();
    if (remaining <= 0) return giveUp();
    request.timer = setTimeout(giveUp, remaining);
    const line = this.waiting[request.priority];
    const behind = line.findIndex((other) => other.order > request.order);
    if (behind === -1) line.push(request);
    else line.splice(behind, 0, request);
  }

  /** Sends waiting requests while slots are free, foreground first. */
  private drain(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    if (this.admission !== 'open') {
      const waitMs = this.sendAfter - Date.now();
      if (waitMs > 0) {
        this.drainTimer ??= setTimeout(() => {
          this.drainTimer = null;
          this.drain();
        }, waitMs);
        return;
      }
      if (this.admission === 'held') {
        // With every slot taken, the next result to arrive comes back here.
        if (this.pending.size >= this.maxInFlight) return;
        const probe = this.nextWaiting();
        if (probe) {
          this.admission = 'probing';
          this.probe = probe;
          this.sendAfter = Date.now() + BUSY_PROBE_WAIT_MS;
          this.send(socket, probe);
          return this.drain();
        }
      }
      // The probe was not refused, or nothing is left to send.
      this.reopen();
    }
    while (this.pending.size < this.maxInFlight) {
      const request = this.nextWaiting();
      if (!request) return;
      this.send(socket, request);
    }
  }

  private nextWaiting(): ClientRequest | undefined {
    return this.waiting.foreground.shift()
      ?? (this.backgroundInFlight < this.maxBackgroundInFlight ? this.waiting.background.shift() : undefined);
  }

  private send(socket: WebSocket, request: ClientRequest): void {
    const id = `${Date.now().toString(36)}-${(++this.requestSequence).toString(36)}`;
    if (request.timer) clearTimeout(request.timer);
    request.id = id;
    request.timer = setTimeout(() => {
      this.finish(request);
      const timedOut = new ServerRequestTimeoutError('The OpenTig server did not respond in time.');
      timedOut.unconfirmed = request.mutation;
      request.reject(timedOut);
      // The server's own, shorter budget has passed too, so its slot is free again.
      this.drain();
    }, request.timeoutMs);
    this.pending.set(id, request);
    if (request.priority === 'background') this.backgroundInFlight += 1;
    try {
      socket.send(JSON.stringify({ type: 'request', id, command: request.command, args: request.args }));
    } catch {
      this.finish(request);
      request.reject(new ServerDisconnectedError('Could not send request to the OpenTig server.'));
    }
  }

  /** Takes a request out of the line or out of its slot, wherever it is. */
  private release(request: ClientRequest): void {
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    if (request.id === null) {
      const line = this.waiting[request.priority];
      const index = line.indexOf(request);
      if (index !== -1) line.splice(index, 1);
      return;
    }
    if (this.pending.delete(request.id) && request.priority === 'background') this.backgroundInFlight -= 1;
    request.id = null;
  }

  /** Releases a request that is about to be settled. */
  private finish(request: ClientRequest): void {
    this.release(request);
    if (request.signal && request.abort) request.signal.removeEventListener('abort', request.abort);
  }

  private disconnected(generation: number, closeCode: number): void {
    if (generation !== this.socketGeneration) return;
    this.socket = null;
    this.clearHeartbeat();
    const createError = () => closeCode === 1008
      ? new ServerAuthenticationError('Authentication required.')
      : closeCode === 1013
      ? new ServerBackpressureError('OpenTig server disconnected because the client send queue was full.')
      : new ServerDisconnectedError(`OpenTig server disconnected before the request completed. ${disconnectCause(closeCode)}`, closeCode);
    this.rejectPending(createError);
    if (this.stopped) return;
    if (closeCode === 1008) {
      this.stopped = true;
      this.setState('auth-required');
      this.rejectConnectionWaiters(createError());
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

  /** Fails every request, sent or still waiting. Only a change that was sent may have happened. */
  private rejectPending(createError: () => ServerTransportError): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
    this.reopen();
    for (const request of [...this.pending.values(), ...this.waiting.foreground, ...this.waiting.background]) {
      const sent = request.id !== null;
      this.finish(request);
      const error = createError();
      error.unconfirmed = sent && request.mutation;
      request.reject(error);
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

/** The server can't be reached, as opposed to a request failing or running out of time. */
export function isConnectionLoss(reason: unknown): boolean {
  return reason instanceof ServerDisconnectedError || (reason instanceof ServerRequestTimeoutError && !reason.unconfirmed);
}

function disconnectCause(closeCode: number): string {
  if (closeCode === 4000) return 'The server stopped responding.';
  if (closeCode === 1001) return 'The server restarted or shut down.';
  if (closeCode === 1009) return 'A server message was too large.';
  return 'The connection ended unexpectedly.';
}

/** A failure that says nothing about the work: it may have succeeded or may still be running. */
export function isUnconfirmedResult(reason: unknown): boolean {
  if (reason instanceof ServerTransportError) return reason.unconfirmed;
  const detail = serializedErrorFromReason(reason);
  return detail !== null && 'unconfirmed' in detail && detail.unconfirmed === true;
}

function settleResult(pending: ClientRequest, result: IpcResult<unknown>): void {
  if (result.ok) {
    pending.resolve(result.value);
    return;
  }
  if (result.error.code === 'RESPONSE_TOO_LARGE') {
    pending.reject(new ServerResponseTooLargeError(result.error));
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
