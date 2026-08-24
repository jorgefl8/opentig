import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenTigUtilityParentMessage } from '../../shared/server-process';
import {
  DEFAULT_SERVER_PORT,
  ServerPortConflictError,
  ServerProcessManager,
  type ServerProcessManagerOptions,
  type UtilityFork,
  type UtilityForkOptions,
  type UtilityProcessLike,
} from './ServerProcessManager';

const temporaryDirectories: string[] = [];
const PAIRING_TOKEN = 'p'.repeat(43);
const PAIRING_EXPIRES_AT = new Date(Date.now() + 5 * 60 * 1_000).toISOString();

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ServerProcessManager', () => {
  it('boots port 6767 through one postMessage without putting the secret in args or env', async () => {
    const fixture = await createFixture([readyBehavior]);
    const onReady = vi.fn();
    const manager = new ServerProcessManager({ ...fixture.options, onReady });

    const address = await manager.start();
    const child = fixture.children[0]!;
    const bootstrap = child.messages[0] as Extract<OpenTigUtilityParentMessage, { type: 'bootstrap' }>;

    expect(address).toMatchObject({ port: DEFAULT_SERVER_PORT, origin: `http://127.0.0.1:${DEFAULT_SERVER_PORT}` });
    expect(fixture.calls[0]).toMatchObject({ modulePath: fixture.options.modulePath, args: [], options: { cwd: fixture.options.cwd, stdio: 'pipe', serviceName: 'OpenTig Server' } });
    expect(child.postedBeforeSpawn).toBe(false);
    expect(child.messages).toHaveLength(1);
    expect(bootstrap.config.desktopSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(fixture.calls[0]!.args)).not.toContain(bootstrap.config.desktopSecret);
    expect(JSON.stringify(fixture.calls[0]!.options.env)).not.toContain(bootstrap.config.desktopSecret);
    expect(fixture.options.probe).toHaveBeenCalledWith(address);
    expect(onReady).toHaveBeenCalledWith(address, bootstrap.config.desktopSecret);

    await manager.stop();
    expect(child.messages.at(-1)).toEqual({ type: 'shutdown' });
  });

  it('scans upward only when the default port is occupied', async () => {
    const fixture = await createFixture([portConflictBehavior, readyBehavior]);
    const manager = new ServerProcessManager(fixture.options);

    await expect(manager.start()).resolves.toMatchObject({ port: DEFAULT_SERVER_PORT + 1 });
    expect(bootstrapPort(fixture.children[0]!)).toBe(DEFAULT_SERVER_PORT);
    expect(bootstrapPort(fixture.children[1]!)).toBe(DEFAULT_SERVER_PORT + 1);
    await manager.stop();
  });

  it('fails an explicit occupied port without scanning', async () => {
    const fixture = await createFixture([portConflictBehavior]);
    const manager = new ServerProcessManager({ ...fixture.options, port: 7000 });

    await expect(manager.start()).rejects.toEqual(expect.objectContaining<Partial<ServerPortConflictError>>({
      name: 'ServerPortConflictError',
      message: 'OpenTig server port 7000 is already in use.',
    }));
    expect(fixture.children).toHaveLength(1);
  });

  it('restarts once on the same selected port after an unexpected exit', async () => {
    const states: string[] = [];
    const fixture = await createFixture([readyBehavior, readyBehavior]);
    const manager = new ServerProcessManager({
      ...fixture.options,
      restartDelaysMs: [0, 1],
      stableAfterMs: 60_000,
      onState: (state) => states.push(state.status),
    });

    const initial = await manager.start();
    fixture.children[0]!.crash(9);
    await waitFor(() => fixture.children.length === 2 && manager.current?.pid === fixture.children[1]!.pid);

    expect(bootstrapPort(fixture.children[1]!)).toBe(initial.port);
    expect(states).toEqual(['starting', 'ready', 'restarting', 'ready']);
    expect(fixture.children.filter((child) => !child.exited)).toHaveLength(1);
    await manager.stop();
  });

  it('restarts the sole utility on the same port when network exposure changes', async () => {
    const fixture = await createFixture([readyBehavior, readyBehavior]);
    const manager = new ServerProcessManager(fixture.options);
    const initial = await manager.start();

    const exposed = await manager.restart('0.0.0.0');

    expect(fixture.children).toHaveLength(2);
    expect(fixture.children[0]!.messages).toContainEqual({ type: 'shutdown' });
    expect(bootstrapHost(fixture.children[1]!)).toBe('0.0.0.0');
    expect(exposed).toMatchObject({ host: '0.0.0.0', port: initial.port, origin: `http://127.0.0.1:${initial.port}` });
    expect(fixture.children.filter((child) => !child.exited)).toHaveLength(1);
    await manager.stop();
  });

  it('restarts on the same loopback listener when an external HTTPS origin changes', async () => {
    const fixture = await createFixture([readyBehavior, readyBehavior]);
    const manager = new ServerProcessManager(fixture.options);
    await manager.start();

    await manager.restart('127.0.0.1', ['https://opentig.example.com']);

    const bootstrap = fixture.children[1]!.messages[0] as Extract<OpenTigUtilityParentMessage, { type: 'bootstrap' }>;
    expect(bootstrap.config).toMatchObject({ host: '127.0.0.1', allowedOrigins: ['https://opentig.example.com'] });
    await manager.stop();
  });

  it('uses parent-port controls without exposing pairing credentials in the bind origin', async () => {
    const fixture = await createFixture([readyBehavior]);
    const manager = new ServerProcessManager(fixture.options);
    await manager.start();

    await expect(manager.getStatus()).resolves.toEqual({ connectedSessionCount: 3 });
    await expect(manager.createPairingLink('http://192.168.1.50:6767')).resolves.toEqual({
      url: `http://192.168.1.50:6767/pair#token=${PAIRING_TOKEN}`,
      expiresAt: PAIRING_EXPIRES_AT,
    });
    await expect(manager.createPairingLink('https://opentig.example.com')).resolves.toEqual({
      url: `https://opentig.example.com/pair#token=${PAIRING_TOKEN}`,
      expiresAt: PAIRING_EXPIRES_AT,
    });
    await manager.stop();
  });

  it('redacts bootstrap secrets and rotates captured utility output', async () => {
    const fixture = await createFixture([readyBehavior]);
    const manager = new ServerProcessManager({ ...fixture.options, logMaxBytes: 160, logBackups: 2 });
    await manager.start();
    const child = fixture.children[0]!;
    const secret = (child.messages[0] as Extract<OpenTigUtilityParentMessage, { type: 'bootstrap' }>).config.desktopSecret;
    child.stderr.write(`secret=${secret} ${secret} ${'x'.repeat(150)}\n`);
    child.stdout.write(`${'y'.repeat(150)}\n`);
    await manager.stop();

    const current = await readFile(fixture.options.logPath, 'utf8');
    const rotated = await readFile(`${fixture.options.logPath}.1`, 'utf8');
    expect(`${current}${rotated}`).not.toContain(secret);
    expect(`${current}${rotated}`).toContain('[redacted]');
  });

  it('kills a utility that ignores graceful shutdown', async () => {
    const fixture = await createFixture([readyBehavior], true);
    const manager = new ServerProcessManager({ ...fixture.options, shutdownTimeoutMs: 5 });
    await manager.start();
    await manager.stop();
    expect(fixture.children[0]!.killCalls).toBe(1);
  });
});

type ChildBehavior = (child: FakeUtility, message: Extract<OpenTigUtilityParentMessage, { type: 'bootstrap' }>) => void;

class FakeUtility extends EventEmitter {
  pid: number | undefined;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly messages: OpenTigUtilityParentMessage[] = [];
  spawned = false;
  exited = false;
  postedBeforeSpawn = false;
  killCalls = 0;

  constructor(
    pid: number,
    private readonly behavior: ChildBehavior,
    private readonly ignoreShutdown: boolean,
  ) {
    super();
    this.pid = pid;
  }

  spawn(): void {
    this.spawned = true;
    this.emit('spawn');
  }

  postMessage(message: OpenTigUtilityParentMessage): void {
    if (!this.spawned) this.postedBeforeSpawn = true;
    this.messages.push(message);
    if (message.type === 'bootstrap') this.behavior(this, message);
    else if (message.type === 'control') this.respondToControl(message);
    else if (!this.ignoreShutdown) queueMicrotask(() => this.exit(0));
  }

  kill(): boolean {
    this.killCalls += 1;
    queueMicrotask(() => this.exit(1));
    return true;
  }

  crash(code: number): void {
    this.exit(code);
  }

  private respondToControl(message: Extract<OpenTigUtilityParentMessage, { type: 'control' }>): void {
    const result = message.action === 'status'
      ? { action: 'status' as const, connectedSessionCount: 3 }
      : { action: 'create-pairing-link' as const, url: `http://127.0.0.1:6767/pair#token=${PAIRING_TOKEN}`, expiresAt: PAIRING_EXPIRES_AT };
    queueMicrotask(() => this.emit('message', { type: 'control-result', requestId: message.requestId, ok: true, result }));
  }

  private exit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.pid = undefined;
    this.emit('exit', code);
  }
}

async function createFixture(behaviors: ChildBehavior[], ignoreShutdown = false): Promise<{
  options: ServerProcessManagerOptions;
  children: FakeUtility[];
  calls: Array<{ modulePath: string; args: string[]; options: UtilityForkOptions }>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-process-manager-'));
  temporaryDirectories.push(directory);
  const children: FakeUtility[] = [];
  const calls: Array<{ modulePath: string; args: string[]; options: UtilityForkOptions }> = [];
  const fork: UtilityFork = (modulePath, args, options) => {
    const behavior = behaviors[children.length];
    if (!behavior) throw new Error('Unexpected utility spawn.');
    const child = new FakeUtility(10_000 + children.length, behavior, ignoreShutdown);
    children.push(child);
    calls.push({ modulePath, args, options });
    queueMicrotask(() => child.spawn());
    return child as unknown as UtilityProcessLike;
  };
  const probe = vi.fn(async () => undefined);
  return {
    children,
    calls,
    options: {
      modulePath: path.join(directory, 'utility.mjs'),
      cwd: directory,
      logPath: path.join(directory, 'logs', 'server.log'),
      settingsPath: path.join(directory, 'settings.json'),
      aiLogPath: path.join(directory, 'ai-log.jsonl'),
      serverDataPath: path.join(directory, 'server'),
      clientRoot: path.join(directory, 'client'),
      appVersion: 'test-version',
      platform: 'win32',
      env: { PATH: 'test-path' },
      fork,
      probe,
      startupTimeoutMs: 1_000,
      shutdownTimeoutMs: 50,
    },
  };
}

const readyBehavior: ChildBehavior = (child, message) => {
  queueMicrotask(() => child.emit('message', {
    type: 'ready',
    host: message.config.host,
    port: message.config.port,
    origin: `http://${message.config.host}:${message.config.port}`,
    protocolVersion: 1,
    appVersion: message.config.appVersion,
  }));
};

const portConflictBehavior: ChildBehavior = (child) => {
  queueMicrotask(() => child.emit('message', {
    type: 'error',
    code: 'EADDRINUSE',
    message: 'The requested server port is already in use.',
  }));
};

function bootstrapPort(child: FakeUtility): number {
  return (child.messages[0] as Extract<OpenTigUtilityParentMessage, { type: 'bootstrap' }>).config.port;
}

function bootstrapHost(child: FakeUtility): string {
  return (child.messages[0] as Extract<OpenTigUtilityParentMessage, { type: 'bootstrap' }>).config.host;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
