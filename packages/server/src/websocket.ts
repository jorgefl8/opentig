import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { IPC, type IpcResult } from '../../../src/shared/contracts';
import { DEFAULT_COMMAND_TIMEOUT_MS, commandDefinition } from '../../../src/shared/protocol';
import type { OpenTigRuntimeEvent } from '../../../src/shared/runtime-events';
import { OPEN_TIG_MAX_IN_FLIGHT_REQUESTS, OPEN_TIG_MAX_SERVER_MESSAGE_BYTES, type OpenTigServerIdentity, type OpenTigServerMessage } from '../../../src/shared/server-protocol';
import { CommandRegistry } from '../../../src/main/runtime/CommandRegistry';
import { OpenTigSessionAuth } from './auth';
import type { OpenTigServerLogger } from './http';
import { isAllowedOrigin } from './origin';
import { isDirectLocalClient } from './client-locality';
import { redactOperationResult } from './redact';
import WebSocket, { WebSocketServer } from 'ws';
import type { KeptAnswer } from '../../../src/shared/kept-reads';
import { JsonByteLimitError, stringifyBounded } from './bounded-json';

const NORMAL_FRAME_LIMIT = 1024 * 1024;
const CONTENT_FRAME_LIMIT = 9 * 1024 * 1024;
const FILE_WRITE_FRAME_LIMIT = 17 * 1024 * 1024;
/** Slow enough to help explain a timeout or a stall, without logging ordinary work. */
const SLOW_COMMAND_MS = 10_000;
/** Above one full message, so a second response doesn't drop a connection still receiving the first. */
const MAX_BUFFERED_SEND_BYTES = 2 * OPEN_TIG_MAX_SERVER_MESSAGE_BYTES;
const DEFAULT_CONNECTION_LIMIT = 16;
const DEFAULT_REQUEST_RATE_LIMIT = 120;
const DEFAULT_REQUEST_RATE_WINDOW_MS = 10_000;
/** Time for a rejected client to receive the close frame before the connection is cut. Nothing it sends meanwhile is read. */
const REJECT_GRACE_MS = 1_000;
/** Connections without a session being closed at once, apart from the limit signed-in clients share. Past it, more are refused before the upgrade. */
const UNAUTHENTICATED_CONNECTION_LIMIT = 4;

interface ClientState {
  sessionId: string;
  /** Named here, never by the client: what the server keeps per connection is found by it. */
  connectionId: string;
  alive: boolean;
  requests: Map<string, RunningRequest>;
  requestTimes: number[];
}

interface RunningRequest {
  controller: AbortController;
  /** A change is never stopped halfway: only reads can be cancelled. */
  cancellable: boolean;
}

export interface OpenTigWebSocketOptions {
  server: HttpServer;
  registry: CommandRegistry;
  auth: OpenTigSessionAuth;
  identity: OpenTigServerIdentity;
  logger: OpenTigServerLogger;
  commandTimeoutMs?: number;
  connectionLimit?: number;
  heartbeatMs?: number;
  requestRateLimit?: number;
  requestRateWindowMs?: number;
}

export class OpenTigWebSocketTransport {
  /** A browser on this machine: compressing costs it time and saves nothing. */
  private readonly webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: FILE_WRITE_FRAME_LIMIT,
    perMessageDeflate: false,
  });
  /**
   * A signed-in client through the network or a tunnel: messages over 1 KB are compressed when
   * the browser offers it (a file tree shrinks to about a tenth). No context is kept between
   * messages, so each connection holds no compression window between them. Only a client whose
   * session the upgrade request already proves gets here (see `upgrade`). What one message may
   * inflate to is `FILE_WRITE_FRAME_LIMIT`, the largest request a client may send (a file save
   * of up to 16 MB): the per-command limits are checked on the inflated text.
   */
  private readonly compressingWebSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: FILE_WRITE_FRAME_LIMIT,
    perMessageDeflate: {
      threshold: 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      zlibDeflateOptions: { level: 6, memLevel: 8 },
    },
  });
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly connections = new Map<string, WebSocket>();
  /** Connections without a session, upgraded only to be closed, until they are cut. They have their own bound. */
  private readonly rejected = new Set<WebSocket>();
  /** Every connection `reject` has refused: it is refused once, and nothing it still emits is acted on. */
  private readonly refused = new WeakSet<WebSocket>();
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private readonly commandTimeoutMs: number | undefined;
  private readonly connectionLimit: number;
  private readonly requestRateLimit: number;
  private readonly requestRateWindowMs: number;
  private readonly measureTransport = process.env.OPENTIG_PERF_LOG === '1';
  private readonly heartbeat: NodeJS.Timeout;
  private readonly upgradeHandler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly options: OpenTigWebSocketOptions) {
    this.commandTimeoutMs = options.commandTimeoutMs;
    this.connectionLimit = options.connectionLimit ?? DEFAULT_CONNECTION_LIMIT;
    this.requestRateLimit = options.requestRateLimit ?? DEFAULT_REQUEST_RATE_LIMIT;
    this.requestRateWindowMs = options.requestRateWindowMs ?? DEFAULT_REQUEST_RATE_WINDOW_MS;
    this.upgradeHandler = (request, socket, head) => this.upgrade(request, socket, head);
    options.server.on('upgrade', this.upgradeHandler);
    this.webSocketServer.on('connection', (socket, request) => this.connected(socket, request));
    this.compressingWebSocketServer.on('connection', (socket, request) => this.connected(socket, request));
    this.heartbeat = setInterval(() => this.checkHeartbeats(), options.heartbeatMs ?? 30_000);
    this.heartbeat.unref();
  }

  get connectedSessionCount(): number {
    return new Set([...this.clients.values()].map((client) => client.sessionId)).size;
  }

  connectionCount(sessionId: string): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.sessionId === sessionId) count += 1;
    }
    return count;
  }

  /** Sends an event to these connections, or to every connection without them. */
  publish(event: OpenTigRuntimeEvent, connectionIds?: ReadonlySet<string>): void {
    if (!connectionIds) return this.broadcast({ type: 'event', event });
    const sockets: WebSocket[] = [];
    for (const connectionId of connectionIds) {
      const socket = this.connections.get(connectionId);
      if (socket) sockets.push(socket);
    }
    this.sendTo(sockets, { type: 'event', event });
  }

  revokeSessions(sessionIds: readonly string[]): void {
    const revoked = new Set(sessionIds);
    for (const [socket, state] of this.clients) {
      if (revoked.has(state.sessionId)) {
        for (const request of state.requests.values()) request.controller.abort();
        this.reject(socket, 1008, 'Session revoked');
      }
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeTransport();
    return this.closePromise;
  }

  /** Keep authentication and runtime alive while clients reconnect to a new bind. */
  reconnectClients(): void {
    for (const socket of this.clients.keys()) socket.terminate();
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const rawPath = (request.url ?? '').split(/[?#]/, 1)[0];
    if (rawPath !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
    if (!isAllowedOrigin(request)) return rejectUpgrade(socket, 403, 'Forbidden');
    const authenticated = this.options.auth.authenticate(request.headers) !== null;
    // A client without a session never takes the room signed-in clients share: it has its own small
    // bound, and past it is refused before the upgrade.
    if (!authenticated && this.rejected.size >= UNAUTHENTICATED_CONNECTION_LIMIT) return rejectUpgrade(socket, 503, 'Too many connections without a session');
    if (authenticated && this.clients.size >= this.connectionLimit) return rejectUpgrade(socket, 503, 'Connection limit reached');
    // Compression is only negotiated for a session the request already proves: a client without one
    // is upgraded as before, so a browser sees the same 1008 close and shows pairing, and nothing it
    // sends is ever inflated.
    const compress = authenticated && !isDirectLocalClient(request);
    const server = compress ? this.compressingWebSocketServer : this.webSocketServer;
    server.handleUpgrade(request, socket, head, (webSocket) => {
      server.emit('connection', webSocket, request);
    });
  }

  private connected(socket: WebSocket, request: IncomingMessage): void {
    const sessionId = this.options.auth.authenticate(request.headers);
    if (!sessionId) {
      this.reject(socket, 1008, 'Unauthorized');
      return;
    }
    const state: ClientState = { sessionId, connectionId: randomUUID(), alive: true, requests: new Map(), requestTimes: [] };
    this.clients.set(socket, state);
    this.connections.set(state.connectionId, socket);
    this.options.registry.connectionOpened(state.connectionId);
    void this.options.auth.recordConnection(sessionId).catch(() => {
      this.options.logger('warn', 'Could not update owner session activity.');
    });
    socket.on('pong', () => { state.alive = true; });
    socket.on('message', (data, isBinary) => { void this.message(socket, state, data, isBinary); });
    socket.on('close', (code) => {
      // 1000, 1001 and 1005 are a client closing or navigating away as usual.
      if (state.requests.size > 0 || ![1000, 1001, 1005].includes(code)) {
        this.note(`WebSocket closed ${JSON.stringify({ code, requestsInFlight: state.requests.size })}`);
      }
      for (const request of state.requests.values()) request.controller.abort();
      this.clients.delete(socket);
      // Also when it died without a close frame: the heartbeat ends it, and `ws` reports the close.
      this.connections.delete(state.connectionId);
      this.options.registry.connectionClosed(state.connectionId);
      if (![...this.clients.values()].some((client) => client.sessionId === sessionId)) {
        this.options.registry.clearSession(sessionId);
      }
    });
    socket.on('error', () => this.options.logger('warn', 'WebSocket connection failed.'));
  }

  /**
   * Closes a connection the server refuses and stops reading from it at once: frames it sends
   * afterwards are neither parsed nor inflated. The close frame still goes out, so a browser sees
   * the code; the connection is cut shortly after, without waiting for the client's reply.
   */
  private reject(socket: WebSocket, code: number, reason: string): void {
    // `ws` has no supported way to stop parsing what it already received; what it still emits is ignored (see `message`).
    if (this.refused.has(socket)) return;
    this.refused.add(socket);
    if (!this.clients.has(socket) && !this.rejected.has(socket)) {
      this.rejected.add(socket);
      socket.once('close', () => this.rejected.delete(socket));
    }
    if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    socket.pause();
    const cut = setTimeout(() => socket.terminate(), REJECT_GRACE_MS);
    cut.unref();
    socket.once('close', () => clearTimeout(cut));
  }

  private async message(socket: WebSocket, state: ClientState, data: WebSocket.RawData, isBinary: boolean): Promise<void> {
    if (this.refused.has(socket)) return;
    if (!this.options.auth.hasSession(state.sessionId)) return this.reject(socket, 1008, 'Session expired or revoked');
    if (isBinary) return this.reject(socket, 1003, 'Text messages only');
    const bytes = rawBytes(data);
    if (bytes.byteLength > FILE_WRITE_FRAME_LIMIT) return this.reject(socket, 1009, 'Message too large');

    let input: unknown;
    try { input = JSON.parse(bytes.toString('utf8')); }
    catch { return this.sendProtocolError(socket, '', 'Malformed request.'); }
    if (isPing(input)) return void this.send(socket, { type: 'pong' });
    if (isCancel(input)) {
      // Unknown or finished ids are ignored: the result may already be on its way.
      const running = state.requests.get(input.id);
      if (running?.cancellable) running.controller.abort();
      return;
    }
    if (!isRequest(input)) return this.sendProtocolError(socket, requestId(input), 'Malformed request.');
    if (!this.options.auth.hasSession(state.sessionId)) return this.reject(socket, 1008, 'Session expired or revoked');
    const now = Date.now();
    state.requestTimes = state.requestTimes.filter((requestedAt) => now - requestedAt < this.requestRateWindowMs);
    if (state.requestTimes.length >= this.requestRateLimit) return this.sendBusy(socket, input.id, 'Request rate limit exceeded.');
    state.requestTimes.push(now);
    if (state.requests.has(input.id)) return this.sendProtocolError(socket, input.id, 'Duplicate request id.');
    if (state.requests.size >= OPEN_TIG_MAX_IN_FLIGHT_REQUESTS) return this.sendBusy(socket, input.id, 'Too many in-flight requests.');
    if (bytes.byteLength > frameLimit(input.command)) return this.sendProtocolError(socket, input.id, 'Command request exceeded the transport limit.');
    if (input.command === IPC.repositoryReadImage) return this.sendProtocolError(socket, input.id, 'Image previews use authenticated HTTP.');

    const controller = new AbortController();
    const startedAt = this.measureTransport ? performance.now() : undefined;
    const read = commandDefinition(input.command)?.mutation === false;
    state.requests.set(input.id, { controller, cancellable: read });
    let kept: KeptAnswer | undefined;
    // What the handler leaves for after the answer, which runs at once once the answer has gone.
    const afterAnswer: { sent: boolean; tasks: (() => void)[] } = { sent: false, tasks: [] };
    const runAfterAnswer = (task: () => void) => {
      try { task(); } catch { this.options.logger('warn', 'A follow-up to a WebSocket answer failed.'); }
    };
    const execution = this.options.registry.execute(state.sessionId, input.command, input.args, {
      signal: controller.signal,
      connectionId: state.connectionId,
      afterAnswer: (task) => { if (afterAnswer.sent) runAfterAnswer(task); else afterAnswer.tasks.push(task); },
      ...(read && input.acceptKept === true ? { kept: (answer: KeptAnswer) => { kept ??= answer; } } : {}),
    });
    this.pendingOperations.add(execution);
    void execution.finally(() => this.pendingOperations.delete(execution));
    const requestedAt = Date.now();
    let timedOut = false;
    void execution.then((settled) => {
      const durationMs = Date.now() - requestedAt;
      if (durationMs >= SLOW_COMMAND_MS) {
        this.note(`Slow command ${JSON.stringify({ operation: commandDefinition(input.command)?.operation ?? 'unknown', durationMs, outcome: settled.ok ? 'ok' : settled.error.code, timedOut })}`);
      }
      if (timedOut && settled.ok) this.options.registry.recordLateSuccess(input.command, input.args, durationMs);
    });
    try {
      const timeoutMs = this.commandTimeoutMs ?? commandDefinition(input.command)?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
      const result = redactOperationResult(await withTimeout(execution, timeoutMs, input.command, () => {
        timedOut = true;
        controller.abort();
        this.options.registry.recordCommandTimeout(input.command, input.args, timeoutMs);
      }));
      if (input.command === IPC.bootstrap && result.ok && isRecord(result.value)) {
        // This transport understands `cancel` and `acceptKept`; a client only sends them to a server that says so.
        result.value = { ...result.value, server: { ...this.options.identity, requestCancellation: true, keptReads: true, repositorySnapshots: true, actionJobLogs: true, fileHistory: true, pullRequestFiles: true, repositoryPerClient: true, worktreeRepair: true } satisfies OpenTigServerIdentity };
      }
      if (result.ok && kept && !timedOut) {
        this.send(socket, { type: 'result', id: input.id, result, kept: { readAt: kept.readAt } });
        // Only this connection asked: nobody else is told, and a closed connection is told nothing.
        const requestId = input.id;
        void kept.refresh.then((outcome) => {
          const event = outcome.outcome === 'failed'
            ? { type: 'github.read-refreshed' as const, requestId, outcome: 'failed' as const, error: (redactOperationResult({ ok: false, error: outcome.error }) as { ok: false; error: typeof outcome.error }).error }
            : { type: 'github.read-refreshed' as const, requestId, outcome: 'updated' as const };
          this.send(socket, { type: 'event', event });
        }, () => undefined);
      } else this.send(socket, { type: 'result', id: input.id, result });
    } finally {
      afterAnswer.sent = true;
      for (const task of afterAnswer.tasks.splice(0)) runAfterAnswer(task);
      state.requests.delete(input.id);
      if (startedAt !== undefined) this.measure('request', startedAt, {
        requestBytes: bytes.byteLength,
        operation: commandDefinition(input.command)?.operation ?? 'unknown',
      });
    }
  }

  /** Refuses a request the connection has no room for. Nothing has run, so the client sends it again later. */
  private sendBusy(socket: WebSocket, id: string, message: string): void {
    this.send(socket, {
      type: 'result',
      id,
      result: { ok: false, error: { code: 'SERVER_BUSY', operation: 'server-protocol', message, retryable: true } },
    });
  }

  private sendProtocolError(socket: WebSocket, id: string, message: string): void {
    this.send(socket, {
      type: 'result',
      id,
      result: { ok: false, error: { code: 'INVALID_ARGUMENT', operation: 'server-protocol', message } },
    });
  }

  private broadcast(message: OpenTigServerMessage): void {
    this.sendTo(this.clients.keys(), message);
  }

  private sendTo(sockets: Iterable<WebSocket>, message: OpenTigServerMessage): void {
    // Share only the encoding; admission, session authentication, and queued bytes remain per connection.
    let serialized: ReturnType<typeof stringifyBounded> | null | undefined;
    for (const socket of sockets) {
      if (!this.canSend(socket)) continue;
      if (serialized === undefined) serialized = this.serialize(message);
      this.sendSerialized(socket, serialized);
    }
  }

  private send(socket: WebSocket, message: OpenTigServerMessage): void {
    if (this.canSend(socket)) this.sendSerialized(socket, this.serialize(message));
  }

  private canSend(socket: WebSocket): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    const state = this.clients.get(socket);
    if (!state || !this.options.auth.hasSession(state.sessionId)) {
      this.reject(socket, 1008, 'Session expired or revoked');
      return false;
    }
    return true;
  }

  private serialize(message: OpenTigServerMessage): ReturnType<typeof stringifyBounded> | null {
    const startedAt = this.measureTransport ? performance.now() : undefined;
    let serialized: ReturnType<typeof stringifyBounded> | null = null;
    let outcome = 'accepted';
    try {
      serialized = stringifyBounded(message, OPEN_TIG_MAX_SERVER_MESSAGE_BYTES);
    } catch (error) {
      if (!(error instanceof JsonByteLimitError)) throw error;
      outcome = 'message-too-large';
      if (message.type === 'result') {
        outcome = 'response-too-large';
        // Keep the result envelope compatible with older clients.
        serialized = stringifyBounded({
          type: 'result', id: message.id,
          result: { ok: false, error: {
            code: 'RESPONSE_TOO_LARGE', operation: 'server-protocol',
            message: 'Response exceeded the 4 MiB transport limit. Request a smaller scope.',
            maxBytes: OPEN_TIG_MAX_SERVER_MESSAGE_BYTES,
          } },
        }, OPEN_TIG_MAX_SERVER_MESSAGE_BYTES);
      }
    }
    if (startedAt !== undefined) this.measure('serialize', startedAt, {
      bytes: serialized?.bytes ?? 0, outcome, maxBytes: OPEN_TIG_MAX_SERVER_MESSAGE_BYTES,
    });
    return serialized;
  }

  private sendSerialized(socket: WebSocket, serialized: ReturnType<typeof stringifyBounded> | null): void {
    if (!this.canSend(socket)) return;
    if (!serialized) {
      this.reject(socket, 1009, 'Server message too large');
      return;
    }
    const startedAt = this.measureTransport ? performance.now() : undefined;
    const bufferedBytes = socket.bufferedAmount;
    if (bufferedBytes + serialized.bytes > MAX_BUFFERED_SEND_BYTES) {
      if (startedAt !== undefined) this.measure('send', startedAt, { bytes: serialized.bytes, bufferedBytes, outcome: 'backpressure' });
      this.reject(socket, 1013, 'Client is too slow');
      return;
    }
    socket.send(serialized.text, (error) => {
      if (startedAt !== undefined) this.measure('send', startedAt, { bytes: serialized.bytes, bufferedBytes, outcome: error ? 'failed' : 'written' });
      if (error) this.options.logger('warn', 'WebSocket send failed.');
    });
  }

  private measure(kind: 'request' | 'serialize' | 'send', startedAt: number, data: Record<string, string | number>): void {
    this.note(`WebSocket performance ${JSON.stringify({ kind, durationMs: performance.now() - startedAt, ...data })}`);
  }

  private note(message: string): void {
    try { this.options.logger('info', message); }
    catch { /* Diagnostics must not interrupt delivery. */ }
  }

  private checkHeartbeats(): void {
    for (const [socket, state] of this.clients) {
      if (!this.options.auth.hasSession(state.sessionId)) {
        this.reject(socket, 1008, 'Session expired or revoked');
        continue;
      }
      if (!state.alive) {
        socket.terminate();
        continue;
      }
      state.alive = false;
      socket.ping();
    }
  }

  private async closeTransport(): Promise<void> {
    clearInterval(this.heartbeat);
    this.options.server.off('upgrade', this.upgradeHandler);
    for (const [socket, state] of this.clients) {
      for (const request of state.requests.values()) request.controller.abort();
      socket.close(1001, 'Server shutting down');
    }
    await Promise.race([
      Promise.allSettled([...this.pendingOperations]),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    for (const socket of this.clients.keys()) socket.terminate();
    for (const state of this.clients.values()) this.options.registry.connectionClosed(state.connectionId);
    this.clients.clear();
    this.connections.clear();
    await Promise.all([this.webSocketServer, this.compressingWebSocketServer].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
}

function frameLimit(command: string): number {
  if (command === IPC.repositoryWriteFile) return FILE_WRITE_FRAME_LIMIT;
  if (command === IPC.indexResolveConflict || command === IPC.indexUpdateConflict) return CONTENT_FRAME_LIMIT;
  const definition = commandDefinition(command);
  return Math.min(definition?.maxRequestBytes ?? NORMAL_FRAME_LIMIT, NORMAL_FRAME_LIMIT);
}

function isPing(value: unknown): value is { type: 'ping' } {
  return isRecord(value) && value.type === 'ping';
}

function isRequest(value: unknown): value is { type: 'request'; id: string; command: string; args: unknown[]; acceptKept?: unknown } {
  return isRecord(value)
    && value.type === 'request'
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 128
    && typeof value.command === 'string'
    && value.command.length > 0
    && value.command.length <= 200
    && Array.isArray(value.args);
}

function isCancel(value: unknown): value is { type: 'cancel'; id: string } {
  return isRecord(value) && value.type === 'cancel' && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128;
}

function requestId(value: unknown): string {
  return isRecord(value) && typeof value.id === 'string' && value.id.length <= 128 ? value.id : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function rawBytes(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  throw new Error('Unsupported WebSocket payload.');
}

async function withTimeout(
  operation: Promise<IpcResult<unknown>>,
  timeoutMs: number,
  command: string,
  onTimeout: () => void,
): Promise<IpcResult<unknown>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<IpcResult<unknown>>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve({
        ok: false,
        error: { code: 'TIMEOUT', operation: command, message: 'Command timed out.', ...(commandDefinition(command)?.mutation ? { unconfirmed: true } : {}) },
      });
    }, timeoutMs);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
