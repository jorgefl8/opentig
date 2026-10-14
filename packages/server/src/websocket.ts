import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { IPC, type IpcResult } from '../../../src/shared/contracts';
import { DEFAULT_COMMAND_TIMEOUT_MS, OPEN_TIG_SERVER_COMMANDS, type OpenTigServerCommandDefinition } from '../../../src/shared/protocol';
import type { OpenTigRuntimeEvent } from '../../../src/shared/runtime-events';
import { OPEN_TIG_MAX_SERVER_MESSAGE_BYTES, type OpenTigServerIdentity, type OpenTigServerMessage } from '../../../src/shared/server-protocol';
import { CommandRegistry } from '../../../src/main/runtime/CommandRegistry';
import { OpenTigSessionAuth } from './auth';
import type { OpenTigServerLogger } from './http';
import { isAllowedOrigin } from './origin';
import { redactOperationResult } from './redact';
import WebSocket, { WebSocketServer } from 'ws';
import { JsonByteLimitError, stringifyBounded } from './bounded-json';

const NORMAL_FRAME_LIMIT = 1024 * 1024;
const CONTENT_FRAME_LIMIT = 9 * 1024 * 1024;
const FILE_WRITE_FRAME_LIMIT = 17 * 1024 * 1024;
const MAX_IN_FLIGHT = 32;
const MAX_BUFFERED_SEND_BYTES = 4 * 1024 * 1024;
const DEFAULT_CONNECTION_LIMIT = 16;
const DEFAULT_REQUEST_RATE_LIMIT = 120;
const DEFAULT_REQUEST_RATE_WINDOW_MS = 10_000;

interface ClientState {
  sessionId: string;
  alive: boolean;
  requests: Map<string, AbortController>;
  requestTimes: number[];
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
  private readonly webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: FILE_WRITE_FRAME_LIMIT,
    perMessageDeflate: false,
  });
  private readonly clients = new Map<WebSocket, ClientState>();
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

  publish(event: OpenTigRuntimeEvent): void {
    this.broadcast({ type: 'event', event });
  }

  revokeSessions(sessionIds: readonly string[]): void {
    const revoked = new Set(sessionIds);
    for (const [socket, state] of this.clients) {
      if (revoked.has(state.sessionId)) {
        for (const controller of state.requests.values()) controller.abort();
        socket.close(1008, 'Session revoked');
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
    if (this.clients.size >= this.connectionLimit) return rejectUpgrade(socket, 503, 'Connection limit reached');
    this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.webSocketServer.emit('connection', webSocket, request);
    });
  }

  private connected(socket: WebSocket, request: IncomingMessage): void {
    const sessionId = this.options.auth.authenticate(request.headers);
    if (!sessionId) {
      socket.close(1008, 'Unauthorized');
      return;
    }
    const state: ClientState = { sessionId, alive: true, requests: new Map(), requestTimes: [] };
    this.clients.set(socket, state);
    void this.options.auth.recordConnection(sessionId).catch(() => {
      this.options.logger('warn', 'Could not update owner session activity.');
    });
    socket.on('pong', () => { state.alive = true; });
    socket.on('message', (data, isBinary) => { void this.message(socket, state, data, isBinary); });
    socket.on('close', () => {
      for (const controller of state.requests.values()) controller.abort();
      this.clients.delete(socket);
      if (![...this.clients.values()].some((client) => client.sessionId === sessionId)) {
        this.options.registry.clearSession(sessionId);
      }
    });
    socket.on('error', () => this.options.logger('warn', 'WebSocket connection failed.'));
  }

  private async message(socket: WebSocket, state: ClientState, data: WebSocket.RawData, isBinary: boolean): Promise<void> {
    if (!this.options.auth.hasSession(state.sessionId)) return socket.close(1008, 'Session expired or revoked');
    if (isBinary) return socket.close(1003, 'Text messages only');
    const bytes = rawBytes(data);
    if (bytes.byteLength > FILE_WRITE_FRAME_LIMIT) return socket.close(1009, 'Message too large');

    let input: unknown;
    try { input = JSON.parse(bytes.toString('utf8')); }
    catch { return this.sendProtocolError(socket, '', 'Malformed request.'); }
    if (isPing(input)) return void this.send(socket, { type: 'pong' });
    if (!isRequest(input)) return this.sendProtocolError(socket, requestId(input), 'Malformed request.');
    if (!this.options.auth.hasSession(state.sessionId)) return socket.close(1008, 'Session expired or revoked');
    const now = Date.now();
    state.requestTimes = state.requestTimes.filter((requestedAt) => now - requestedAt < this.requestRateWindowMs);
    if (state.requestTimes.length >= this.requestRateLimit) return this.sendProtocolError(socket, input.id, 'Request rate limit exceeded.');
    state.requestTimes.push(now);
    if (state.requests.has(input.id)) return this.sendProtocolError(socket, input.id, 'Duplicate request id.');
    if (state.requests.size >= MAX_IN_FLIGHT) return this.sendProtocolError(socket, input.id, 'Too many in-flight requests.');
    if (bytes.byteLength > frameLimit(input.command)) return this.sendProtocolError(socket, input.id, 'Command request exceeded the transport limit.');
    if (input.command === IPC.repositoryReadImage) return this.sendProtocolError(socket, input.id, 'Image previews use authenticated HTTP.');

    const controller = new AbortController();
    const startedAt = this.measureTransport ? performance.now() : undefined;
    state.requests.set(input.id, controller);
    const execution = this.options.registry.execute(state.sessionId, input.command, input.args, { signal: controller.signal });
    this.pendingOperations.add(execution);
    void execution.finally(() => this.pendingOperations.delete(execution));
    try {
      const timeoutMs = this.commandTimeoutMs ?? commandDefinition(input.command)?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
      const result = redactOperationResult(await withTimeout(execution, timeoutMs, input.command, () => controller.abort()));
      if (input.command === IPC.bootstrap && result.ok && isRecord(result.value)) {
        result.value = { ...result.value, server: this.options.identity };
      }
      this.send(socket, { type: 'result', id: input.id, result });
    } finally {
      state.requests.delete(input.id);
      if (startedAt !== undefined) this.measure('request', startedAt, {
        requestBytes: bytes.byteLength,
        operation: commandDefinition(input.command)?.operation ?? 'unknown',
      });
    }
  }

  private sendProtocolError(socket: WebSocket, id: string, message: string): void {
    this.send(socket, {
      type: 'result',
      id,
      result: { ok: false, error: { code: 'INVALID_ARGUMENT', operation: 'server-protocol', message } },
    });
  }

  private broadcast(message: OpenTigServerMessage): void {
    // Events are owner-wide invalidations. Share only the encoding; admission,
    // session authentication, and queued bytes remain per connection.
    let serialized: ReturnType<typeof stringifyBounded> | null | undefined;
    for (const socket of this.clients.keys()) {
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
      socket.close(1008, 'Session expired or revoked');
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
      socket.close(1009, 'Server message too large');
      return;
    }
    const startedAt = this.measureTransport ? performance.now() : undefined;
    const bufferedBytes = socket.bufferedAmount;
    if (bufferedBytes + serialized.bytes > MAX_BUFFERED_SEND_BYTES) {
      if (startedAt !== undefined) this.measure('send', startedAt, { bytes: serialized.bytes, bufferedBytes, outcome: 'backpressure' });
      socket.close(1013, 'Client is too slow');
      return;
    }
    socket.send(serialized.text, (error) => {
      if (startedAt !== undefined) this.measure('send', startedAt, { bytes: serialized.bytes, bufferedBytes, outcome: error ? 'failed' : 'written' });
      if (error) this.options.logger('warn', 'WebSocket send failed.');
    });
  }

  private measure(kind: 'request' | 'serialize' | 'send', startedAt: number, data: Record<string, string | number>): void {
    try {
      this.options.logger('info', `WebSocket performance ${JSON.stringify({ kind, durationMs: performance.now() - startedAt, ...data })}`);
    } catch { /* Diagnostics must not interrupt delivery. */ }
  }

  private checkHeartbeats(): void {
    for (const [socket, state] of this.clients) {
      if (!this.options.auth.hasSession(state.sessionId)) {
        socket.close(1008, 'Session expired or revoked');
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
      for (const controller of state.requests.values()) controller.abort();
      socket.close(1001, 'Server shutting down');
    }
    await Promise.race([
      Promise.allSettled([...this.pendingOperations]),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    for (const socket of this.clients.keys()) socket.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => this.webSocketServer.close(() => resolve()));
  }
}

function frameLimit(command: string): number {
  if (command === IPC.repositoryWriteFile) return FILE_WRITE_FRAME_LIMIT;
  if (command === IPC.indexResolveConflict || command === IPC.indexUpdateConflict) return CONTENT_FRAME_LIMIT;
  const definition = commandDefinition(command);
  return Math.min(definition?.maxRequestBytes ?? NORMAL_FRAME_LIMIT, NORMAL_FRAME_LIMIT);
}

function commandDefinition(command: string): OpenTigServerCommandDefinition | undefined {
  return Object.values(OPEN_TIG_SERVER_COMMANDS).find((candidate) => candidate.command === command);
}

function isPing(value: unknown): value is { type: 'ping' } {
  return isRecord(value) && value.type === 'ping';
}

function isRequest(value: unknown): value is { type: 'request'; id: string; command: string; args: unknown[] } {
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
        error: { code: 'TIMEOUT', operation: command, message: 'Command timed out.' },
      });
    }, timeoutMs);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
