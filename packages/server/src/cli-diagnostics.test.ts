import { createServer, type Server } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli';
import { CliError, cliCommand, diagnostic, operationError } from './cli-errors';
import { parseCliArguments } from './cli-config';
import { manageCliService, waitServiceReady } from './cli-service';
import { loadOrCreateAdminToken, prepareCliHome, resolveCliPaths, writeRuntimeState, type OpenTigRuntimeState } from './cli-home';
import { requestStartup, startupReporter } from './cli-startup';
import { OPEN_TIG_APP_VERSION } from './version';
import { saveInstallation } from './service-installation';
import type { ServiceManager } from './service-manager';

const mocks = vi.hoisted(() => ({ manager: vi.fn(), git: vi.fn(async () => undefined), npm: vi.fn(async () => undefined), lockCleanup: false }));
vi.mock('node:timers/promises', async original => ({ ...await original<typeof import('node:timers/promises')>(), setTimeout: vi.fn(async () => undefined) }));
vi.mock('./service-manager', async original => ({ ...await original<typeof import('./service-manager')>(), createServiceManager: mocks.manager }));
vi.mock('./cli-runtime', async original => ({ ...await original<typeof import('./cli-runtime')>(), assertGitAvailable: mocks.git }));
vi.mock('./service-npm', async original => ({ ...await original<typeof import('./service-npm')>(), runServiceNpm: mocks.npm, resolveServiceNpm: vi.fn(async () => '/fixture/npm-cli.js') }));
// Supply only build artifacts, never require a previous local build for command tests.
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, rm: async (file: string, options: object) => {
    if (mocks.lockCleanup && file.endsWith(path.join('service', 'update-lock'))) throw Object.assign(new Error('fixture cleanup failed'), { code: 'EPERM' });
    return fs.rm(file, options);
  }, access: async (file: string, ...args: [number?]) => {
    if (file.endsWith(path.join('packages', 'server', 'dist', 'bin.mjs')) || file.endsWith(path.join('packages', 'server', 'dist', 'client', 'index.html'))) return;
    return fs.access(file, ...args);
  }, cp: async (source: string, destination: string, options: object) => {
    if (source.endsWith(path.join('packages', 'server', 'dist'))) {
      await fs.mkdir(path.join(destination, 'client'), { recursive: true });
      await fs.writeFile(path.join(destination, 'bin.mjs'), '// fixture');
      await fs.writeFile(path.join(destination, 'client/index.html'), '<!doctype html>');
      return;
    }
    return fs.cp(source, destination, options);
  } };
});

let home: string;
let manager: ServiceManager;
const sockets: Server[] = [];
const output: string[] = [], errors: string[] = [];
const io = { out: (message: string) => output.push(message), error: (message: string) => errors.push(message) };
const config = (action: string, ...args: string[]) => parseCliArguments(['service', action, '--home', home, ...args], {});
const install = () => ({ schema: 1 as const, manager: 'systemd' as const, version: OPEN_TIG_APP_VERSION,
  layout: 'flat' as const, host: '127.0.0.1', port: 6767, node: process.execPath });

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'OpenTig diagnostics & spaces-'));
  await mkdir(path.join(home, 'service'));
  output.length = errors.length = 0;
  manager = { kind: 'systemd', location: 'isolated fixture service', startup: 'Starts at login.',
    read: vi.fn(async () => null), owns: vi.fn(() => true), preflight: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined), render: vi.fn(() => 'fixture definition'), restart: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ running: false, enabled: true })),
  } as unknown as ServiceManager;
  mocks.lockCleanup = false;
  mocks.manager.mockResolvedValue(manager); mocks.git.mockReset().mockResolvedValue(undefined); mocks.npm.mockClear();
});
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const socket of sockets.splice(0)) if (socket.listening) await new Promise<void>(resolve => socket.close(() => resolve()));
  await rm(home, { recursive: true, force: true });
});
async function listen(socket: Server, host = '127.0.0.1') {
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, host, resolve); });
  return (socket.address() as { port: number }).port;
}
async function runtimeFixture(options: { legacy?: boolean; mismatch?: boolean; disabled?: boolean; invalidExpiry?: boolean } = {}) {
  const paths = resolveCliPaths(home); await prepareCliHome(paths);
  const token = await loadOrCreateAdminToken(paths.adminToken);
  const state: OpenTigRuntimeState = { version: 1, pid: process.pid, instanceId: 'b'.repeat(32), host: '127.0.0.1', port: 0,
    appVersion: OPEN_TIG_APP_VERSION, protocolVersion: 1, startedAt: new Date().toISOString() };
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const send = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url === '/readyz') return send(200, { status: 'ready', appVersion: state.appVersion, protocolVersion: 1 });
    if (request.headers['x-opentig-admin'] !== token) return send(404, {});
    if (request.url === '/api/admin/status') return options.legacy ? send(404, {})
      : send(200, { status: 'ready', protocolVersion: state.protocolVersion, pid: state.pid, instanceId: options.mismatch ? 'c'.repeat(32) : state.instanceId, appVersion: state.appVersion });
    if (request.url === '/api/admin/pair') {
      const value = JSON.parse(body);
      if (value.publicOrigin === 'invalid-origin') return send(400, { error: 'Invalid public origin.' });
      if (options.disabled) return send(403, { code: 'WEB_ACCESS_DISABLED' });
      return send(200, { url: `http://127.0.0.1:${state.port}/pair#token=${'a'.repeat(43)}`, expiresAt: options.invalidExpiry ? 'not-a-date' : new Date(Date.now() + 300_000).toISOString() });
    }
    send(404, {});
  });
  state.port = await listen(server);
  await writeRuntimeState(paths.runtimeState, state);
  vi.mocked(manager.status).mockResolvedValue({ running: true, enabled: true, pid: state.pid });
  return { state, paths, token };
}

// These assertions check the command's output, exit status and effects, not just the bind helper.
describe('service installation preflight', () => {
  it.each(['127.0.0.1', '0.0.0.0'])('refuses an occupied %s listener before npm or supervisor changes', async host => {
    const port = await listen(createServer(), host);
    const result = await runCli(['service', 'install', '--home', home, '--host', host, '--port', String(port)], {}, io);
    expect(result).toBe(1);
    expect(errors.join('\n')).toContain(`Port ${port} is already in use`);
    expect(errors.join('\n')).toContain('OpenTig Desktop or another process');
    expect(errors.join('\n')).toContain(cliCommand(home, 'service', 'install', '--host', host, '--port', String(port + 1)));
    expect(errors.join('\n')).not.toContain('reset-access');
    expect(mocks.npm).not.toHaveBeenCalled(); expect(manager.preflight).not.toHaveBeenCalled();
    expect(manager.write).not.toHaveBeenCalled(); expect(manager.stop).not.toHaveBeenCalled(); expect(manager.remove).not.toHaveBeenCalled();
    expect(sockets[0]!.listening).toBe(true);
  });
  it('resolves the saved port before checking the startup flags', async () => {
    const port = await listen(createServer());
    await mkdir(path.join(home, 'server'));
    await writeFile(path.join(home, 'server/web-access.json'), JSON.stringify({ version: 1, listenerHost: '127.0.0.1', listenerPort: port }));
    expect(await runCli(['service', 'install', '--home', home, '--port', '1'], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain(`Port ${port}`);
    expect(errors.join('\n')).toContain('saved Settings');
    expect(errors.join('\n')).toContain('removes saved access switches');
    expect(manager.write).not.toHaveBeenCalled();
  });
  it('does not suggest ignored port flags when saved values equal startup values', async () => {
    const port = await listen(createServer());
    await mkdir(path.join(home, 'server'));
    await writeFile(path.join(home, 'server/web-access.json'), JSON.stringify({ version: 1, listenerHost: '127.0.0.1', listenerPort: port }));
    expect(await runCli(['service', 'install', '--home', home, '--port', String(port)], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('saved Settings');
    expect(errors.join('\n')).not.toContain('Choose another port, for example');
  });
  it('handles IPv6 listener conflicts without changing the port', async context => {
    let port: number;
    try { port = await listen(createServer(), '::1'); }
    catch (error) { if (['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes((error as NodeJS.ErrnoException).code ?? '')) return context.skip(); throw error; }
    expect(await runCli(['service', 'install', '--home', home, '--host', '::1', '--port', String(port)], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain(`[::1]:${port}`); expect(manager.write).not.toHaveBeenCalled();
  });
  it('does not exempt a live PID that does not belong to the service', async () => {
    await runtimeFixture(); await saveInstallation(home, install());
    vi.mocked(manager.read).mockResolvedValue('owned definition');
    vi.mocked(manager.status).mockResolvedValue({ running: true, enabled: true, pid: process.pid + 1 });
    expect(await runCli(['service', 'install', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('not verified as this managed service'); expect(manager.stop).not.toHaveBeenCalled();
  });
  it('uses environment host/port when flags are absent', async () => {
    const port = await listen(createServer());
    expect(await runCli(['service', 'install'], { OPENTIG_HOME: home, OPENTIG_HOST: '127.0.0.1', OPENTIG_PORT: String(port) }, io)).toBe(1);
    expect(errors.join('\n')).toContain(`Port ${port}`); expect(manager.write).not.toHaveBeenCalled();
  });
  it('does not mistake a live foreground home for an owned service', async () => {
    await runtimeFixture();
    expect(await runCli(['service', 'install', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('stop the foreground instance');
    expect(errors.join('\n')).toContain(cliCommand(home, 'pair'));
    expect(manager.stop).not.toHaveBeenCalled();
  });
  it('checks Git before preparing dependencies or replacing the service', async () => {
    mocks.git.mockRejectedValueOnce(new CliError('GIT_UNAVAILABLE', 'Git is required.', ['Install Git and retry.']));
    const port = await listen(createServer()); await new Promise<void>(resolve => sockets[0]!.close(() => resolve()));
    expect(await runCli(['service', 'install', '--home', home, '--port', String(port)], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('Install Git'); expect(mocks.npm).not.toHaveBeenCalled(); expect(manager.write).not.toHaveBeenCalled();
  });
  it('refuses invalid saved settings with explicit reset consequences', async () => {
    await mkdir(path.join(home, 'server')); await writeFile(path.join(home, 'server/web-access.json'), '{');
    expect(await runCli(['service', 'install', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('preserves paired browsers'); expect(manager.write).not.toHaveBeenCalled();
  });
});

describe('service startup and recovery', () => {
  async function stagedInstall(options: Parameters<typeof runtimeFixture>[0] = {}) {
    const { state } = await runtimeFixture(options);
    await saveInstallation(home, install());
    const target = path.join(home, `service/app-${OPEN_TIG_APP_VERSION}/dist/client`);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'index.html'), '<!doctype html>');
    await writeFile(path.join(target, '../bin.mjs'), '// fixture');
    await writeFile(path.join(target, '../../package.json'), '{}');
    vi.mocked(manager.read).mockResolvedValue('previous owned definition');
    vi.mocked(manager.restart).mockImplementation(async () => {
      vi.stubEnv('OPENTIG_SERVICE_HOME', home);
      const report = await startupReporter(home); await report!.ready(state.instanceId);
    });
    return state;
  }
  it('reinstalls its own occupied listener and reports the actual URL after authenticated readiness', async () => {
    const state = await stagedInstall();
    expect(await manageCliService(config('install', '--port', String(state.port)), io, manager)).toBe(0);
    expect(output.join('\n')).toContain(`Connection URL: http://127.0.0.1:${state.port}`);
    expect(output.join('\n')).toContain('Starts at login.');
    expect(output.at(-1)).toContain(cliCommand(home, 'pair'));
    expect(manager.write).toHaveBeenCalledOnce();
  });
  it('creates the managed command and prints a pairing link after a successful install', async () => {
    const state = await stagedInstall();
    const userHome = path.join(home, 'user');
    await mkdir(userHome);
    // Never edit the real Windows registry Path from unit tests.
    const pathOption = process.platform === 'win32' ? ['--no-modify-path'] : [];
    expect(await runCli(['service', 'install', '--home', home, '--port', String(state.port), ...pathOption], { HOME: userHome, SHELL: '/bin/zsh' }, io)).toBe(0);
    const text = output.join('\n');
    if (process.platform !== 'win32') {
      expect(text).toContain(`Added ${path.join(home, 'bin')} to PATH in ${path.join(userHome, '.zshrc')}`);
      expect(await readFile(path.join(userHome, '.zshrc'), 'utf8')).toContain('# >>> opentig >>>');
    }
    expect(text).toContain(`http://127.0.0.1:${state.port}/pair#token=`);
    expect(errors).toEqual([]);
    expect(await runCli(['service', 'uninstall', '--home', home], { HOME: userHome, SHELL: '/bin/zsh' }, io)).toBe(0);
    if (process.platform !== 'win32') expect(await readFile(path.join(userHome, '.zshrc'), 'utf8')).not.toContain('opentig');
  });
  it('keeps a successful install when no pairing link can be created', async () => {
    const state = await stagedInstall({ disabled: true });
    expect(await runCli(['service', 'install', '--home', home, '--port', String(state.port), '--no-modify-path'], {}, io)).toBe(0);
    expect(errors.join('\n')).toContain('No pairing link was created. Web access is paused');
  });
  it('retains the startup failure and verifies the previous service after rollback', async () => {
    const state = await stagedInstall();
    vi.mocked(manager.restart).mockImplementationOnce(async () => {
      vi.stubEnv('OPENTIG_SERVICE_HOME', home);
      const report = await startupReporter(home); await report!.failed(new CliError('PORT_IN_USE', 'Port was taken during startup.'));
    });
    expect(await runCli(['service', 'install', '--home', home, '--port', String(state.port)], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('Port was taken during startup');
    expect(errors.join('\n')).toContain('previous service was restored and verified');
    expect(output.join('\n')).not.toContain('installed and started');
    expect(manager.write).toHaveBeenLastCalledWith('previous owned definition');
  });
  it('keeps both failures when recovery also fails', async () => {
    const state = await stagedInstall();
    vi.mocked(manager.restart).mockRejectedValueOnce(new CliError('START_FAILED', 'Original startup failure.'));
    vi.mocked(manager.write).mockResolvedValueOnce().mockRejectedValueOnce(new CliError('RESTORE_FAILED', 'Cannot restore task.'));
    expect(await runCli(['service', 'install', '--home', home, '--port', String(state.port)], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('Original startup failure'); expect(errors.join('\n')).toContain('Cannot restore task');
    expect(errors.join('\n')).toContain('final service state is not verified');
  });
  it('removes a newly installed service after an early failure without deleting settings', async () => {
    const port = await listen(createServer()); await new Promise<void>(resolve => sockets[0]!.close(() => resolve()));
    await writeFile(path.join(home, 'settings.json'), 'sentinel');
    vi.mocked(manager.restart).mockImplementationOnce(async () => {
      vi.stubEnv('OPENTIG_SERVICE_HOME', home);
      const report = await startupReporter(home); await report!.failed(new CliError('PORT_IN_USE', 'Port taken after preflight.'));
    });
    expect(await runCli(['service', 'install', '--home', home, '--port', String(port)], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('Port taken after preflight'); expect(errors.join('\n')).toContain('newly registered service was removed');
    expect(manager.stop).toHaveBeenCalledOnce(); expect(manager.remove).toHaveBeenCalledOnce();
    expect(await readFile(path.join(home, 'settings.json'), 'utf8')).toBe('sentinel');
  });
  it('rejects a same-version listener with the wrong instance ID until timeout', async () => {
    await runtimeFixture({ mismatch: true });
    const attempt = await requestStartup(home);
    await expect(waitServiceReady(home, install(), manager, attempt)).rejects.toMatchObject({ code: 'STARTUP_TIMEOUT' });
  });
  it('ignores a failure from an older startup attempt', async () => {
    const attempt = await requestStartup(home);
    await writeFile(path.join(home, 'service/startup.json'), JSON.stringify({ attempt: 'older-attempt', requestedAt: new Date().toISOString(), phase: 'failed', message: 'Old failure must not be reported.' }));
    await expect(waitServiceReady(home, install(), manager, attempt)).rejects.toMatchObject({ code: 'STARTUP_TIMEOUT' });
  });
  it('supports old service identity checks without creating a pairing token', async () => {
    await runtimeFixture({ legacy: true });
    vi.mocked(manager.read).mockResolvedValue('owned');
    expect(await manageCliService(config('status'), io, manager)).toBe(0);
    expect(output.join('\n')).toContain('running (enabled)');
  });
});

describe('remaining command recovery', () => {
  it('reports an occupied port for start without starting another instance', async () => {
    const port = await listen(createServer());
    expect(await runCli(['start', '--home', home, '--port', String(port)], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain(`Port ${port}`); expect(sockets[0]!.listening).toBe(true);
  });
  it('reports paused web access instead of a generic pairing refusal', async () => {
    await runtimeFixture({ disabled: true });
    expect(await runCli(['pair', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('Web access is paused'); expect(errors.join('\n')).toContain(cliCommand(home, 'reset-access'));
    expect(output).toEqual([]);
  });
  it('rejects a pairing response with an invalid expiration date', async () => {
    await runtimeFixture({ invalidExpiry: true });
    expect(await runCli(['pair', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('invalid pairing link'); expect(output).toEqual([]);
  });
  it('prints a usable pairing link for an existing instance', async () => {
    await runtimeFixture();
    expect(await runCli(['pair', '--home', home], {}, io)).toBe(0); expect(output.join('\n')).toContain('/pair#token=');
  });
  it('shows how to install a missing service, while uninstall stays idempotent', async () => {
    expect(await runCli(['service', 'restart', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain(cliCommand(home, 'service', 'install'));
    expect(await runCli(['service', 'uninstall', '--home', home], {}, io)).toBe(0);
    expect(await runCli(['service', 'status', '--home', home], { OPENTIG_PORT: 'bad' }, io)).toBe(1);
    expect(output.join('\n')).toContain('not installed');
  });
  it('explains supervisor access failures without claiming the service is absent', async () => {
    vi.mocked(manager.read).mockRejectedValueOnce(Object.assign(new Error('private subprocess output'), { code: 'EPERM' }));
    expect(await runCli(['service', 'status', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('permission was denied'); expect(output.join('\n')).not.toContain('not installed');
    expect(errors.join('\n')).not.toContain('private subprocess output');
  });
  it('does not remove files when service stop fails', async () => {
    await saveInstallation(home, install()); vi.mocked(manager.read).mockResolvedValue('owned');
    vi.mocked(manager.stop).mockRejectedValue(new Error('fixture stop failed'));
    expect(await runCli(['service', 'uninstall', '--home', home], {}, io)).toBe(1);
    expect(manager.remove).not.toHaveBeenCalled(); expect(await readFile(path.join(home, 'service/installation.json'), 'utf8')).toContain(OPEN_TIG_APP_VERSION);
  });
  it('preserves the original failure when removing the operation lock also fails', async () => {
    await saveInstallation(home, install()); vi.mocked(manager.read).mockResolvedValue('owned');
    vi.mocked(manager.stop).mockRejectedValue(new CliError('STOP_FAILED', 'Could not stop the original service.'));
    mocks.lockCleanup = true;
    expect(await runCli(['service', 'uninstall', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('Could not stop the original service');
    expect(errors.join('\n')).toContain('Lock cleanup also failed');
    expect(manager.remove).not.toHaveBeenCalled();
  });
  it.each(['stopped', 'starting', 'disabled'])('reports %s service state distinctly', async status => {
    vi.mocked(manager.read).mockResolvedValue('owned');
    vi.mocked(manager.status).mockResolvedValue({ running: false, enabled: status !== 'disabled', starting: status === 'starting' });
    expect(await runCli(['service', 'status', '--home', home], {}, io)).toBe(1);
    expect(output.join('\n')).toContain(status === 'starting' ? 'starting' : status === 'disabled' ? 'disabled' : 'stopped');
    expect(output.join('\n')).not.toContain('not installed');
  });
  it('reports an unverified backend rather than treating public readiness as proof', async () => {
    await runtimeFixture({ mismatch: true }); vi.mocked(manager.read).mockResolvedValue('owned');
    expect(await runCli(['service', 'status', '--home', home], {}, io)).toBe(1);
    expect(output.join('\n')).toContain('backend not ready or identity not verified');
  });
  it('explains corrupted runtime data without suggesting deletion of the home', async () => {
    await writeFile(path.join(home, 'runtime.json'), '{}');
    expect(await runCli(['pair', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('runtime state is invalid'); expect(errors.join('\n')).toContain('do not delete the home');
  });
  it('reports identity mismatch before printing any pairing link', async () => {
    await runtimeFixture();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ready', appVersion: 'other', protocolVersion: 1 })));
    expect(await runCli(['pair', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('does not match'); expect(output).toEqual([]);
  });
  it('reports malformed pairing responses without printing their contents', async () => {
    await runtimeFixture();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/readyz')
      ? Response.json({ status: 'ready', appVersion: OPEN_TIG_APP_VERSION, protocolVersion: 1 })
      : new Response('private malformed response', { status: 200 })));
    expect(await runCli(['pair', '--home', home], {}, io)).toBe(1);
    expect(errors.join('\n')).toContain('invalid pairing link'); expect(errors.join('\n')).not.toContain('private malformed'); expect(output).toEqual([]);
  });
  it('retains the home in failure recommendations and never prints credentials', () => {
    const message = diagnostic(operationError(new Error('fetch failed'), home, 'pair a browser'));
    expect(message).toContain(cliCommand(home, 'service', 'status'));
    expect(diagnostic(new CliError('FIXTURE', 'token=secretvalue', ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz']))).not.toContain('secretvalue');
  });
});
