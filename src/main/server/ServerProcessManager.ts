import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OpenTigPlatform } from '../../shared/contracts';
import { redactSensitiveText } from '../../shared/redaction';
import {
  OPEN_TIG_UTILITY_PROTOCOL_VERSION,
  type OpenTigServerHost,
  type OpenTigUtilityChildMessage,
  type OpenTigUtilityConfig,
  type OpenTigUtilityControlAction,
  type OpenTigUtilityControlResult,
  type OpenTigUtilityParentMessage,
} from '../../shared/server-process';
import { OPEN_TIG_PROTOCOL_VERSION } from '../../shared/server-protocol';
import { DEFAULT_SERVER_PORT, DEFAULT_SERVER_PORT_SCAN_COUNT } from '../../shared/server-config';

export { DEFAULT_SERVER_PORT, DEFAULT_SERVER_PORT_SCAN_COUNT } from '../../shared/server-config';

export interface UtilityProcessLike {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  once(event: 'spawn', listener: () => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  off(event: 'exit', listener: (code: number) => void): this;
  postMessage(message: OpenTigUtilityParentMessage): void;
  kill(): boolean;
}

export interface UtilityForkOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: 'pipe';
  serviceName: string;
}

export type UtilityFork = (
  modulePath: string,
  args: string[],
  options: UtilityForkOptions,
) => UtilityProcessLike;

export interface ServerProcessAddress {
  host: string;
  port: number;
  origin: string;
  protocolVersion: number;
  appVersion: string;
  pid: number;
}

export type ServerProcessState =
  | { status: 'starting'; port: number }
  | ({ status: 'ready' } & ServerProcessAddress)
  | { status: 'restarting'; port: number; attempt: number; delayMs: number }
  | { status: 'failed'; message: string }
  | { status: 'stopped' };

export interface ServerProcessManagerOptions {
  modulePath: string;
  cwd: string;
  logPath: string;
  settingsPath: string;
  aiLogPath: string;
  serverDataPath: string;
  clientRoot: string;
  trashModulePath?: string;
  appVersion: string;
  platform: OpenTigPlatform;
  host?: OpenTigServerHost;
  port?: number;
  env?: NodeJS.ProcessEnv;
  fork: UtilityFork;
  probe?: (address: ServerProcessAddress) => Promise<void>;
  onReady?: (address: ServerProcessAddress, desktopSecret: string) => Promise<void> | void;
  onState?: (state: ServerProcessState) => void;
  randomSecret?: () => string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  stableAfterMs?: number;
  restartDelaysMs?: readonly number[];
  logMaxBytes?: number;
  logBackups?: number;
  controlTimeoutMs?: number;
}

export class ServerPortConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServerPortConflictError';
  }
}

class UtilityStartError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'UtilityStartError';
  }
}

/** Owns exactly one utility server and restarts it after unexpected exits. */
export class ServerProcessManager {
  private readonly log: RotatingServerLog;
  private readonly restartDelaysMs: readonly number[];
  private child: UtilityProcessLike | null = null;
  private attemptChild: UtilityProcessLike | null = null;
  private address: ServerProcessAddress | null = null;
  private startPromise: Promise<ServerProcessAddress> | null = null;
  private stopPromise: Promise<void> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private activePort: number | null = null;
  private desiredHost: OpenTigServerHost;
  private consecutiveFailures = 0;
  private stopping = false;
  private restartQueue: Promise<void> = Promise.resolve();
  private readonly pendingControls = new Map<string, {
    action: OpenTigUtilityControlAction;
    resolve(result: OpenTigUtilityControlResult): void;
    reject(error: Error): void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(private readonly options: ServerProcessManagerOptions) {
    this.desiredHost = options.host ?? '127.0.0.1';
    this.restartDelaysMs = options.restartDelaysMs ?? [250, 500, 1_000, 2_000, 5_000];
    if (this.restartDelaysMs.length === 0 || this.restartDelaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
      throw new Error('At least one valid restart delay is required.');
    }
    this.log = new RotatingServerLog(
      options.logPath,
      options.logMaxBytes ?? 1024 * 1024,
      options.logBackups ?? 3,
    );
  }

  get current(): ServerProcessAddress | null {
    return this.address ? { ...this.address } : null;
  }

  start(): Promise<ServerProcessAddress> {
    if (this.stopping || this.stopPromise) return Promise.reject(new Error('Server process manager is stopping.'));
    this.startPromise ??= this.startInitial();
    return this.startPromise;
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopOwnedProcess();
    return this.stopPromise;
  }

  restart(host: OpenTigServerHost): Promise<ServerProcessAddress> {
    if (this.stopping || this.stopPromise) return Promise.reject(new Error('Server process manager is stopping.'));
    const operation = this.restartQueue.then(() => this.restartForHost(host));
    this.restartQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async getStatus(): Promise<{ connectedSessionCount: number }> {
    const result = await this.requestControl('status');
    if (result.action !== 'status' || !Number.isSafeInteger(result.connectedSessionCount) || result.connectedSessionCount < 0) {
      throw new Error('OpenTig utility returned an invalid server status.');
    }
    return { connectedSessionCount: result.connectedSessionCount };
  }

  async createPairingLink(publicOrigin: string): Promise<{ url: string; expiresAt: string }> {
    const result = await this.requestControl('create-pairing-link');
    if (result.action !== 'create-pairing-link' || Number.isNaN(Date.parse(result.expiresAt))) {
      throw new Error('OpenTig utility returned an invalid pairing link.');
    }
    const privateUrl = new URL(result.url);
    const token = new URLSearchParams(privateUrl.hash.slice(1)).get('token');
    const expiresAt = Date.parse(result.expiresAt);
    if (privateUrl.protocol !== 'http:'
      || privateUrl.username
      || privateUrl.password
      || privateUrl.pathname !== '/pair'
      || privateUrl.search
      || !token
      || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || expiresAt <= Date.now()
      || expiresAt > Date.now() + 15 * 60 * 1_000) {
      throw new Error('OpenTig utility returned an invalid pairing link.');
    }
    const endpoint = normalizePublicOrigin(publicOrigin);
    const url = new URL('/pair', endpoint);
    url.hash = privateUrl.hash;
    return { url: url.href, expiresAt: result.expiresAt };
  }

  async revokeAllSessions(): Promise<{ revokedCount: number; desktopCookie: string }> {
    const result = await this.requestControl('revoke-all-sessions');
    if (result.action !== 'revoke-all-sessions'
      || !Number.isSafeInteger(result.revokedCount)
      || result.revokedCount < 0
      || typeof result.desktopCookie !== 'string'
      || !/^opentig_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict(?:; Secure)?$/.test(result.desktopCookie)) {
      throw new Error('OpenTig utility returned an invalid session revocation result.');
    }
    return { revokedCount: result.revokedCount, desktopCookie: result.desktopCookie };
  }

  private async startInitial(): Promise<ServerProcessAddress> {
    const explicitPort = this.options.port;
    const firstPort = explicitPort ?? DEFAULT_SERVER_PORT;
    const attempts = explicitPort === undefined ? DEFAULT_SERVER_PORT_SCAN_COUNT : 1;
    let lastConflict: unknown = null;

    for (let offset = 0; offset < attempts; offset += 1) {
      const port = firstPort + offset;
      if (port > 65_535) break;
      this.options.onState?.({ status: 'starting', port });
      try {
        const address = await this.spawnAndAdopt(port);
        this.consecutiveFailures = 0;
        this.armStabilityReset();
        return address;
      } catch (error) {
        if (!(error instanceof UtilityStartError) || error.code !== 'EADDRINUSE') throw error;
        lastConflict = error;
        if (explicitPort !== undefined) {
          throw new ServerPortConflictError(`OpenTig server port ${explicitPort} is already in use.`);
        }
      }
    }

    throw new ServerPortConflictError(
      `OpenTig could not find a free server port from ${firstPort} to ${Math.min(65_535, firstPort + attempts - 1)}.`,
      { cause: lastConflict },
    );
  }

  private async restartForHost(host: OpenTigServerHost): Promise<ServerProcessAddress> {
    if (host !== '127.0.0.1' && host !== '0.0.0.0') throw new Error('Invalid OpenTig server host.');
    const previous = await this.start();
    if (previous.host === host) return previous;
    const previousHost = this.desiredHost;
    const port = previous.port;
    await this.shutdownCurrentChild();
    this.desiredHost = host;
    this.options.onState?.({ status: 'starting', port });
    try {
      const address = await this.spawnAndAdopt(port);
      this.startPromise = Promise.resolve(address);
      this.consecutiveFailures = 0;
      this.armStabilityReset();
      return address;
    } catch (error) {
      this.desiredHost = previousHost;
      this.options.onState?.({ status: 'starting', port });
      try {
        const restored = await this.spawnAndAdopt(port);
        this.startPromise = Promise.resolve(restored);
        this.consecutiveFailures = 0;
        this.armStabilityReset();
      } catch (restoreError) {
        this.startPromise = null;
        const message = `OpenTig server restart failed and previous binding recovery also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`;
        this.options.onState?.({ status: 'failed', message });
        void this.log.write('manager', `${message}\n`);
      }
      throw error;
    }
  }

  private spawnAndAdopt(port: number): Promise<ServerProcessAddress> {
    const desktopSecret = (this.options.randomSecret ?? defaultSecret)();
    const utilityConfig: OpenTigUtilityConfig = {
      appVersion: this.options.appVersion,
      desktopSecret,
      settingsPath: this.options.settingsPath,
      aiLogPath: this.options.aiLogPath,
      serverDataPath: this.options.serverDataPath,
      clientRoot: this.options.clientRoot,
      ...(this.options.trashModulePath ? { trashModulePath: this.options.trashModulePath } : {}),
      platform: this.options.platform,
      host: this.desiredHost,
      port,
    };

    return new Promise<ServerProcessAddress>((resolve, reject) => {
      let child: UtilityProcessLike;
      try {
        child = this.options.fork(this.options.modulePath, [], {
          cwd: this.options.cwd,
          env: { ...(this.options.env ?? process.env) },
          stdio: 'pipe',
          serviceName: 'OpenTig Server',
        });
      } catch (error) {
        reject(error);
        return;
      }

      this.attemptChild = child;
      this.capture(child.stdout, 'stdout', desktopSecret);
      this.capture(child.stderr, 'stderr', desktopSecret);
      let finished = false;
      let adopted = false;
      let processingReady = false;
      const timeout = setTimeout(() => fail(new UtilityStartError('START_TIMEOUT', 'OpenTig server did not become ready in time.')), this.options.startupTimeoutMs ?? 15_000);
      timeout.unref();

      const cleanupAttempt = () => {
        clearTimeout(timeout);
        if (this.attemptChild === child) this.attemptChild = null;
      };
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        cleanupAttempt();
        child.kill();
        reject(error);
      };
      const onExit = (code: number) => {
        if (!finished) {
          fail(new UtilityStartError('EARLY_EXIT', `OpenTig server exited before readiness with code ${code}.`));
          return;
        }
        if (adopted) this.handleUnexpectedExit(child, code);
      };

      child.on('exit', onExit);
      child.once('spawn', () => {
        if (finished || this.stopping) return fail(new Error('Server startup was cancelled.'));
        child.postMessage({
          type: 'bootstrap',
          protocolVersion: OPEN_TIG_UTILITY_PROTOCOL_VERSION,
          config: utilityConfig,
        });
      });
      child.on('message', (value) => {
        if (!isChildMessage(value)) return;
        if (value.type === 'control-result') {
          this.handleControlResult(child, value);
          return;
        }
        if (finished || processingReady) return;
        if (value.type === 'error') {
          fail(new UtilityStartError(value.code, value.message));
          return;
        }
        if (value.type !== 'ready') return;
        processingReady = true;
        void (async () => {
          const pid = child.pid;
          if (!pid) throw new UtilityStartError('EARLY_EXIT', 'OpenTig server process has no PID.');
          const reportedAddress: ServerProcessAddress = {
            host: value.host,
            port: value.port,
            origin: value.origin,
            protocolVersion: value.protocolVersion,
            appVersion: value.appVersion,
            pid,
          };
          validateReadyAddress(reportedAddress, utilityConfig);
          const address: ServerProcessAddress = {
            ...reportedAddress,
            origin: `http://127.0.0.1:${reportedAddress.port}`,
          };
          await (this.options.probe ?? probeReady)(address);
          await this.options.onReady?.(address, desktopSecret);
          if (finished || this.stopping) throw new Error('Server startup was cancelled.');
          this.child = child;
          this.address = address;
          this.activePort = address.port;
          adopted = true;
          finished = true;
          cleanupAttempt();
          this.options.onState?.({ status: 'ready', ...address });
          resolve({ ...address });
        })().catch(fail);
      });
    });
  }

  private requestControl(action: OpenTigUtilityControlAction): Promise<OpenTigUtilityControlResult> {
    const child = this.child;
    if (!child?.pid || !this.address) return Promise.reject(new Error('OpenTig server is not ready.'));
    const requestId = randomBytes(12).toString('base64url');
    return new Promise<OpenTigUtilityControlResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControls.delete(requestId);
        reject(new Error('OpenTig server control request timed out.'));
      }, this.options.controlTimeoutMs ?? 5_000);
      timeout.unref();
      this.pendingControls.set(requestId, { action, resolve, reject, timeout });
      try { child.postMessage({ type: 'control', requestId, action }); }
      catch (error) {
        clearTimeout(timeout);
        this.pendingControls.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleControlResult(
    child: UtilityProcessLike,
    message: Extract<OpenTigUtilityChildMessage, { type: 'control-result' }>,
  ): void {
    if (this.child !== child) return;
    const pending = this.pendingControls.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingControls.delete(message.requestId);
    if (!message.ok) {
      pending.reject(new Error(message.message.slice(0, 512) || 'OpenTig server control request failed.'));
      return;
    }
    if (message.result.action !== pending.action) {
      pending.reject(new Error('OpenTig utility returned a mismatched control response.'));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectPendingControls(message: string): void {
    for (const pending of this.pendingControls.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pendingControls.clear();
  }

  private handleUnexpectedExit(child: UtilityProcessLike, code: number): void {
    if (this.child !== child) return;
    this.child = null;
    this.address = null;
    this.rejectPendingControls('OpenTig server stopped before the control request completed.');
    this.clearStableTimer();
    if (this.stopping) return;
    this.consecutiveFailures += 1;
    void this.log.write('manager', `Utility process exited unexpectedly with code ${code}.\n`);
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return;
    if (this.consecutiveFailures > this.restartDelaysMs.length) {
      const message = 'OpenTig server stopped after repeated restart failures.';
      this.options.onState?.({ status: 'failed', message });
      void this.log.write('manager', `${message}\n`);
      return;
    }
    const port = this.options.port ?? this.currentPort();
    const delayMs = this.restartDelaysMs[Math.min(this.consecutiveFailures - 1, this.restartDelaysMs.length - 1)]!;
    this.options.onState?.({ status: 'restarting', port, attempt: this.consecutiveFailures, delayMs });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping) return;
      void this.spawnAndAdopt(port).then(() => {
        this.armStabilityReset();
      }).catch((error: unknown) => {
        this.consecutiveFailures += 1;
        void this.log.write('manager', `Restart failed: ${error instanceof Error ? error.message : String(error)}\n`);
        this.scheduleRestart();
      });
    }, delayMs);
    this.restartTimer.unref();
  }

  private currentPort(): number {
    const state = this.options.port ?? this.activePort ?? DEFAULT_SERVER_PORT;
    return state;
  }

  private armStabilityReset(): void {
    this.clearStableTimer();
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      this.consecutiveFailures = 0;
    }, this.options.stableAfterMs ?? 30_000);
    this.stableTimer.unref();
  }

  private clearStableTimer(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }

  private capture(stream: NodeJS.ReadableStream | null, source: 'stdout' | 'stderr', desktopSecret: string): void {
    stream?.on('data', (chunk: string | Buffer) => {
      void this.log.write(source, Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk), [desktopSecret]);
    });
  }

  private async stopOwnedProcess(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.clearStableTimer();
    await this.restartQueue.catch(() => undefined);
    await this.shutdownCurrentChild();
    this.startPromise = null;
    await this.log.close();
    this.options.onState?.({ status: 'stopped' });
  }

  private async shutdownCurrentChild(): Promise<void> {
    const child = this.child ?? this.attemptChild;
    this.child = null;
    this.attemptChild = null;
    this.address = null;
    this.rejectPendingControls('OpenTig server stopped before the control request completed.');
    if (child?.pid) {
      const exited = new Promise<boolean>((resolve) => {
        const onExit = () => {
          clearTimeout(timeout);
          resolve(true);
        };
        const timeout = setTimeout(() => {
          child.off('exit', onExit);
          resolve(false);
        }, this.options.shutdownTimeoutMs ?? 5_000);
        timeout.unref();
        child.once('exit', onExit);
      });
      try { child.postMessage({ type: 'shutdown' }); } catch { /* process already gone */ }
      if (!(await exited)) child.kill();
    }
  }
}

async function probeReady(address: ServerProcessAddress): Promise<void> {
  const response = await fetch(`${address.origin}/readyz`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new UtilityStartError('READY_PROBE_FAILED', `OpenTig server readiness returned ${response.status}.`);
  const value = await response.json() as Partial<ServerProcessAddress> & { status?: unknown };
  if (value.status !== 'ready' || value.protocolVersion !== OPEN_TIG_PROTOCOL_VERSION || value.appVersion !== address.appVersion) {
    throw new UtilityStartError('READY_PROBE_FAILED', 'OpenTig server readiness response is incompatible.');
  }
}

function validateReadyAddress(address: ServerProcessAddress, config: OpenTigUtilityConfig): void {
  if (address.host !== config.host || address.port !== config.port || address.origin !== `http://${config.host}:${config.port}`) {
    throw new UtilityStartError('INVALID_READY', 'OpenTig utility returned an unexpected address.');
  }
  if (address.protocolVersion !== OPEN_TIG_PROTOCOL_VERSION || address.appVersion !== config.appVersion) {
    throw new UtilityStartError('INVALID_READY', 'OpenTig utility returned an incompatible version.');
  }
}

function isChildMessage(value: unknown): value is OpenTigUtilityChildMessage {
  return Boolean(value && typeof value === 'object' && 'type' in value && typeof value.type === 'string');
}

function defaultSecret(): string {
  return randomBytes(32).toString('base64url');
}

function normalizePublicOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid OpenTig network endpoint.');
  }
  return url.origin;
}

class RotatingServerLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
    private readonly backups: number,
  ) {}

  write(source: string, value: string, exactSecrets: readonly string[] = []): Promise<void> {
    let redacted = redactSensitiveText(value);
    for (const secret of exactSecrets) {
      if (secret) redacted = redacted.split(secret).join('[redacted]');
    }
    const line = `${new Date().toISOString()} [${source}] ${redacted}`;
    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      if (await wouldExceed(this.filePath, Buffer.byteLength(line), this.maxBytes)) await this.rotate();
      await appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    }).catch(() => undefined);
    return this.queue;
  }

  close(): Promise<void> {
    return this.queue;
  }

  private async rotate(): Promise<void> {
    if (this.backups <= 0) {
      await rm(this.filePath, { force: true });
      return;
    }
    await rm(`${this.filePath}.${this.backups}`, { force: true });
    for (let index = this.backups - 1; index >= 1; index -= 1) {
      await moveIfPresent(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`);
    }
    await moveIfPresent(this.filePath, `${this.filePath}.1`);
  }
}

async function wouldExceed(filePath: string, incomingBytes: number, maxBytes: number): Promise<boolean> {
  try {
    return (await stat(filePath)).size + incomingBytes > maxBytes;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function moveIfPresent(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}
