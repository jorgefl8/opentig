import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import { CommandRegistry } from '../../../src/main/runtime/CommandRegistry';
import type { OpenTigRuntimeEvent } from '../../../src/shared/runtime-events';
import type { OpenTigServerIdentity } from '../../../src/shared/server-protocol';
import { OpenTigSessionAuth } from './auth';
import { createOpenTigHttpHandler, type OpenTigServerLogger, type OpenTigServerMode } from './http';
import { normalizeOrigins } from './origin';
import { OpenTigWebSocketTransport } from './websocket';

export interface OpenTigServerOptions {
  runtime: OpenTigRuntime;
  registry: CommandRegistry;
  clientRoot: string;
  auth: OpenTigSessionAuth;
  identity: OpenTigServerIdentity;
  host?: string;
  port?: number;
  mode?: OpenTigServerMode;
  allowedOrigins?: readonly string[];
  logger?: OpenTigServerLogger;
  commandTimeoutMs?: number;
  connectionLimit?: number;
  heartbeatMs?: number;
  requestRateLimit?: number;
  requestRateWindowMs?: number;
}

export interface OpenTigServerAddress extends OpenTigServerIdentity {
  host: string;
  port: number;
  origin: string;
}

/** Owns one HTTP/WebSocket listener and the runtime behind it. */
export class OpenTigServer {
  private readonly httpServer: Server;
  private readonly webSockets: OpenTigWebSocketTransport;
  private readonly logger: OpenTigServerLogger;
  private ready = false;
  private startPromise: Promise<OpenTigServerAddress> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(private readonly options: OpenTigServerOptions) {
    this.logger = options.logger ?? (() => undefined);
    const allowedOrigins = normalizeOrigins(options.allowedOrigins);
    this.httpServer = createServer(createOpenTigHttpHandler({
      runtime: options.runtime,
      clientRoot: options.clientRoot,
      auth: options.auth,
      identity: options.identity,
      mode: options.mode ?? 'desktop',
      allowedOrigins,
      isReady: () => this.ready,
      onSessionRevoked: (sessionId) => {
        options.registry.clearSession(sessionId);
        this.webSockets.revokeSession(sessionId);
      },
      logger: this.logger,
    }));
    this.webSockets = new OpenTigWebSocketTransport({
      server: this.httpServer,
      registry: options.registry,
      auth: options.auth,
      identity: options.identity,
      allowedOrigins,
      logger: this.logger,
      ...(options.commandTimeoutMs === undefined ? {} : { commandTimeoutMs: options.commandTimeoutMs }),
      ...(options.connectionLimit === undefined ? {} : { connectionLimit: options.connectionLimit }),
      ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
      ...(options.requestRateLimit === undefined ? {} : { requestRateLimit: options.requestRateLimit }),
      ...(options.requestRateWindowMs === undefined ? {} : { requestRateWindowMs: options.requestRateWindowMs }),
    });
  }

  start(): Promise<OpenTigServerAddress> {
    if (this.stopPromise) return Promise.reject(new Error('Server is stopping.'));
    this.startPromise ??= this.listen();
    return this.startPromise;
  }

  publish(event: OpenTigRuntimeEvent): void {
    if (this.ready) this.webSockets.publish(event);
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopServer();
    return this.stopPromise;
  }

  private listen(): Promise<OpenTigServerAddress> {
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 6767;
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.httpServer.once('error', onError);
      this.httpServer.listen(port, host, () => {
        this.httpServer.off('error', onError);
        const address = this.httpServer.address() as AddressInfo | null;
        if (!address) return reject(new Error('Server did not expose a TCP address.'));
        this.ready = true;
        resolve({
          host: address.address,
          port: address.port,
          origin: `http://${formatHost(address.address)}:${address.port}`,
          ...this.options.identity,
        });
      });
    });
  }

  private async stopServer(): Promise<void> {
    this.ready = false;
    await this.webSockets.close();
    if (this.httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer.close((error) => error ? reject(error) : resolve());
        this.httpServer.closeAllConnections();
      });
    }
    this.options.registry.clear();
    this.options.auth.clear();
    await this.options.runtime.close();
  }
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}
