import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import { CommandRegistry } from '../../../src/main/runtime/CommandRegistry';
import type { OpenTigRuntimeEvent } from '../../../src/shared/runtime-events';
import type { OpenTigServerIdentity } from '../../../src/shared/server-protocol';
import { OpenTigSessionAuth, type PairingToken } from './auth';
import { createOpenTigHttpHandler, type OpenTigServerLogger, type OpenTigServerMode } from './http';
import { OpenTigWebSocketTransport } from './websocket';

import type { DesktopUpdatesApi } from '../../../src/shared/desktop-updates';
import { networkInterfaces } from 'node:os';
import type { OpenTigWebAccessStatus } from '../../../src/shared/desktop-api';
import { applyNetworkPatch, isLoopbackHost, type NetworkConfig, type NetworkSettings } from './network-settings';

export interface OpenTigServerOptions {
  network: NetworkConfig;
  networkSettings: NetworkSettings;
  recoveryCommand?: string;
  onNetworkChanged?(config: NetworkConfig): Promise<void> | void;
  updates?: DesktopUpdatesApi;
  runtime: OpenTigRuntime;
  registry: CommandRegistry;
  clientRoot: string;
  auth: OpenTigSessionAuth;
  identity: OpenTigServerIdentity;
  host?: string;
  port?: number;
  mode?: OpenTigServerMode;
  logger?: OpenTigServerLogger;
  commandTimeoutMs?: number;
  connectionLimit?: number;
  heartbeatMs?: number;
  requestRateLimit?: number;
  requestRateWindowMs?: number;
  admin?: { token: string; instanceId: string };
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
  private networkMutation: Promise<unknown> = Promise.resolve();
  private network: NetworkConfig;

  constructor(private readonly options: OpenTigServerOptions) {
    this.network = options.network;
    this.logger = options.logger ?? (() => undefined);
    this.httpServer = createServer(createOpenTigHttpHandler({
      runtime: options.runtime,
      ...(options.updates ? { updates: options.updates } : {}),
      beginUpdate: () => options.registry.pauseForUpdate(),
      cancelUpdate: () => options.registry.resumeAfterUpdate(),
      clientRoot: options.clientRoot,
      auth: options.auth,
      webAccess: {
        getStatus: () => this.getWebAccessStatus(),
        update: (patch) => this.updateWebAccess(patch),
      },
      identity: options.identity,
      mode: options.mode ?? 'desktop',
      isReady: () => this.ready,
      listenerAddress: () => {
        const address = this.httpServer.address() as AddressInfo;
        return { host: address.address, port: address.port };
      },
      sessionConnectionCount: (sessionId) => this.webSockets.connectionCount(sessionId),
      onSessionsRevoked: (sessionIds) => this.disconnectSessions(sessionIds),
      logger: this.logger,
      ...(options.admin ? {
        admin: {
          ...options.admin,
          createPairingToken: () => options.auth.createPairingToken(),
        },
      } : {}),
    }));
    this.webSockets = new OpenTigWebSocketTransport({
      server: this.httpServer,
      registry: options.registry,
      auth: options.auth,
      identity: options.identity,
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

  createPairingToken(): PairingToken {
    if (!this.ready) throw new Error('Server is not ready.');
    return this.options.auth.createPairingToken();
  }

  getStatus(): { connectedSessionCount: number; browserAccessEnabled: boolean } {
    return { connectedSessionCount: this.webSockets.connectedSessionCount, browserAccessEnabled: this.options.auth.descriptor().browserAccessEnabled };
  }

  getWebAccessStatus(): OpenTigWebAccessStatus {
    const address = this.httpServer.address() as AddressInfo | null;
    const port = address?.port ?? this.network.listenerPort;
    const host = address?.address ?? this.network.listenerHost;
    const localHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
    const localEndpoint = `http://${formatHost(localHost)}:${port}`;
    const endpoints = Object.values(networkInterfaces()).flat().filter(entry => entry && !entry.internal && !entry.address.startsWith('169.254.') && !entry.address.startsWith('fe80:') && (host.includes(':') || entry.family === 'IPv4'))
      .map(entry => `http://${formatHost(entry!.address)}:${port}`);
    const networkEndpoints = [...new Set(endpoints)].sort();
    const listeningOnLan = !isLoopbackHost(host);
    return {
      webAccessEnabled: this.options.auth.descriptor().browserAccessEnabled,
      lanAccessEnabled: this.network.lanAccessEnabled,
      publicOrigin: this.network.publicOrigin,
      listeningOnLan,
      listenerHost: host,
      actualPort: port,
      serverState: this.ready ? 'ready' : 'restarting',
      localEndpoint,
      networkEndpoints,
      pairingEndpoints: this.network.webAccessEnabled ? [...new Set([localEndpoint, ...(listeningOnLan ? networkEndpoints.filter(endpoint => host === '0.0.0.0' || host === '::' || new URL(endpoint).hostname.replace(/[[\]]/g, '') === host) : []), ...(this.network.publicOrigin ? [this.network.publicOrigin] : [])])] : [],
      connectedSessionCount: this.webSockets.connectedSessionCount,
      restartError: null,
      ...(this.options.recoveryCommand ? { recoveryCommand: this.options.recoveryCommand } : {}),
    };
  }

  updateWebAccess(patch: unknown): Promise<OpenTigWebAccessStatus> {
    const operation = this.networkMutation.then(async () => {
      if (!this.ready || this.stopPromise) throw new Error('Server is not ready.');
      const previous = this.network;
      const next = applyNetworkPatch(previous, patch);
      const rebind = next.listenerHost !== previous.listenerHost || next.listenerPort !== previous.listenerPort;
      if (rebind && !this.options.registry.pauseForUpdate()) throw new Error('Wait for running operations to finish before changing the listener.');
      try {
        if (rebind) await this.rebind(next);
        try {
          await this.options.networkSettings.save(next);
          await this.options.onNetworkChanged?.(next);
        } catch (error) {
          if (rebind) await this.rebind(previous);
          await this.options.networkSettings.save(previous);
          await this.options.onNetworkChanged?.(previous);
          throw error;
        }
        this.network = next;
        await this.setBrowserAccessEnabled(next.webAccessEnabled);
        if (rebind) this.webSockets.reconnectClients();
        return this.getWebAccessStatus();
      } finally {
        if (rebind) this.options.registry.resumeAfterUpdate();
      }
    });
    this.networkMutation = operation.catch(() => undefined);
    return operation;
  }

  private async rebind(config: NetworkConfig): Promise<void> {
    const previous = this.network;
    this.httpServer.close();
    this.httpServer.closeIdleConnections();
    try { await this.bind(config.listenerHost, config.listenerPort); }
    catch (error) {
      await this.bind(previous.listenerHost, previous.listenerPort);
      throw new Error('Could not use that listening address or port. The previous listener has been restored.', { cause: error });
    }
  }

  async setBrowserAccessEnabled(enabled: boolean): Promise<void> {
    if (!this.ready) throw new Error('Server is not ready.');
    const pending = this.options.auth.setBrowserAccessEnabled(enabled);
    if (!enabled) this.disconnectSessions(this.options.auth.sessions().filter((session) => session.kind !== 'desktop').map((session) => session.id));
    await pending;
  }

  async revokeAllSessions(): Promise<{ revokedCount: number; desktopCookie: string }> {
    if (!this.ready) throw new Error('Server is not ready.');
    const { sessionIds, cookie } = await this.options.auth.revokeAllAndIssueDesktopCookie();
    this.disconnectSessions(sessionIds);
    return { revokedCount: sessionIds.length, desktopCookie: cookie };
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopServer();
    return this.stopPromise;
  }

  private listen(): Promise<OpenTigServerAddress> {
    return this.bind(this.network.listenerHost, this.network.listenerPort).then(address => {
      this.network = { ...this.network, listenerHost: address.host, listenerPort: address.port,
        lanAccessEnabled: this.network.listenerHost === address.host ? this.network.lanAccessEnabled : !isLoopbackHost(address.host),
      };
      return address;
    });
  }

  private bind(host: string, port: number): Promise<OpenTigServerAddress> {
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
    await this.networkMutation;
    this.ready = false;
    await this.webSockets.close();
    if (this.httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer.close((error) => error ? reject(error) : resolve());
        this.httpServer.closeAllConnections();
      });
    }
    this.options.registry.clear();
    await this.options.auth.close();
    await this.options.runtime.close();
  }

  private disconnectSessions(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) this.options.registry.clearSession(sessionId);
    this.webSockets.revokeSessions(sessionIds);
  }
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}
