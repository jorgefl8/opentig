import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderLaunchAgent, renderWindowsTask, windowsServerScript } from './service-definitions';
import { assertManager, createServiceManager, managerKind, type ServiceManager } from './service-manager';
import { manageCliService } from './cli-service';
import { parseCliArguments } from './cli-config';
import { saveInstallation } from './service-installation';

const command = vi.hoisted(() => vi.fn());
vi.mock('./service-installation', async original => ({ ...await original<typeof import('./service-installation')>(), execute: command }));
const platform = process.platform;
const uidDescriptor = Object.getOwnPropertyDescriptor(process, 'getuid');
const homes: string[] = [];
afterEach(async () => { Object.defineProperty(process, 'platform', { value: platform }); if (uidDescriptor) Object.defineProperty(process, 'getuid', uidDescriptor); else Reflect.deleteProperty(process, 'getuid'); vi.unstubAllEnvs(); vi.restoreAllMocks(); command.mockReset(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
const input = { nodeExecutable: '/opt/node path/node', cliEntrypoint: '/tmp/a&b/<app>/bin.mjs', home: '/tmp/a&b/"home"', host: '127.0.0.1', port: 6767, environmentPath: '/local/bin:/usr/bin' };

describe('native service definitions', () => {
  it('uses literal plist arguments, a captured PATH, and a user LaunchAgent', () => {
    const plist = renderLaunchAgent(input, 'com.opentig.cli');
    expect(plist).toContain('<string>/tmp/a&amp;b/&lt;app&gt;/bin.mjs</string>');
    expect(plist).toContain('<key>PATH</key><string>/local/bin:/usr/bin</string>');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
    expect(plist).not.toContain('<key>UserName</key>');
    expect(() => renderLaunchAgent({ ...input, home: '/tmp/\0bad' }, 'test')).toThrow();
  });
  it('uses a passwordless least-privilege Windows task without a time or battery limit', () => {
    const script = windowsServerScript({ ...input, nodeExecutable: "C:\\Program Files\\nodejs\\node.exe", home: "C:\\Users\\O'Brien\\$data;&", environmentPath: 'C:\\Tools;C:\\Windows' });
    const task = renderWindowsTask({ name: 'test', sid: 'S-1-5-21-1', powershell: 'C:\\Windows\\powershell.exe', home: input.home, script });
    expect(task).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(task).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(task).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(task).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
    const encoded = task.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)![1]!;
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script);
    expect(script).toContain("'C:\\Users\\O''Brien\\$data;&'");
    expect(task).not.toContain('Password');
  });
  it('does not restart or persist the one-shot updater at login', () => {
    const task = renderWindowsTask({ name: 'update', sid: 'S-1-5-1', powershell: 'powershell.exe', home: input.home, script: 'exit 0', worker: true });
    expect(task).toContain('<Triggers></Triggers>');
    expect(task).not.toContain('RestartOnFailure');
  });
  it('retains compatibility with older Linux installations only on Linux', () => {
    const old = { schema: 1 as const, version: '0.1.4', layout: 'flat' as const, host: '127.0.0.1', port: 6767, node: process.execPath };
    expect(() => assertManager(old, 'systemd')).not.toThrow();
    expect(() => assertManager(old, 'launchd')).toThrow();
    expect(() => managerKind('freebsd')).toThrow();
  });
});

describe('service ownership', () => {
  it('refuses another home before calling stop, remove, or writing anything', async () => {
    const config = parseCliArguments(['service', 'uninstall']);
    const manager = { read: async () => 'other home', owns: () => false, stop: vi.fn(), remove: vi.fn() } as unknown as ServiceManager;
    await expect(manageCliService(config, { out: vi.fn() }, manager)).rejects.toThrow('Another OpenTig home');
    expect(manager.stop).not.toHaveBeenCalled();
    expect(manager.remove).not.toHaveBeenCalled();
  });
  it('keeps private data, refuses an active update, and never removes files if stopping fails', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-service-test-')); homes.push(home);
    await mkdir(path.join(home, 'service'));
    await saveInstallation(home, { schema: 1, version: '0.1.0', layout: 'flat', host: '127.0.0.1', port: 6767, node: process.execPath });
    await writeFile(path.join(home, 'settings.json'), 'private data');
    const manager = { kind: 'systemd', read: async () => 'owned', owns: () => true, stop: vi.fn(async () => { throw new Error('stop failed'); }), remove: vi.fn() } as unknown as ServiceManager;
    const config = parseCliArguments(['service', 'uninstall', '--home', home]);
    await mkdir(path.join(home, 'service/update-lock'));
    await expect(manageCliService(config, { out: vi.fn() }, manager)).rejects.toThrow('already in progress');
    expect(manager.stop).not.toHaveBeenCalled();
    await rm(path.join(home, 'service/update-lock'), { recursive: true });
    await expect(manageCliService(config, { out: vi.fn() }, manager)).rejects.toThrow('stop failed');
    expect(manager.remove).not.toHaveBeenCalled();
    expect(await readFile(path.join(home, 'service/installation.json'), 'utf8')).toContain('0.1.0');
    vi.mocked(manager.stop).mockResolvedValueOnce();
    expect(await manageCliService(config, { out: vi.fn() }, manager)).toBe(0);
    expect(await readFile(path.join(home, 'settings.json'), 'utf8')).toBe('private data');
  });
  it('uses encoded PowerShell, registers for the current SID, and never invokes cmd.exe', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    command.mockImplementation(async (_exe, args: string[]) => {
      const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
      return { stdout: script.includes('GetCurrent().User.Value') ? 'S-1-5-21-123' : '' };
    });
    const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-task-')); homes.push(home);
    const manager = await createServiceManager(home);
    const definition = manager.render({ ...input, home });
    await manager.write(definition);
    expect(manager.owns(definition)).toBe(true);
    expect(manager.owns(definition.replace(Buffer.from(home).toString('base64'), Buffer.from('/different home').toString('base64')))).toBe(false);
    const [exe, args] = command.mock.calls.at(-1)!;
    expect(exe).toMatch(/powershell\.exe$/);
    expect(args).toContain('-EncodedCommand');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    expect(script).toContain("6, 'S-1-5-21-123', $null, 3, $null");
  });
});

it('loads a LaunchAgent in the GUI domain and submits updates as a separate launchd job', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'getuid', { value: () => 501, configurable: true });
  const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-launchd-')); homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  command.mockResolvedValue({ stdout: `state = running\npid = ${process.pid}\n` });
  const manager = await createServiceManager(home);
  await manager.write(manager.render({ ...input, home }));
  expect(manager.owns((await manager.read())!)).toBe(true);
  await manager.restart();
  expect(command).toHaveBeenCalledWith('/bin/launchctl', ['bootout', 'gui/501/com.opentig.cli'], expect.anything());
  expect(command).toHaveBeenCalledWith('/bin/launchctl', ['bootstrap', 'gui/501', path.join(home, 'Library/LaunchAgents/com.opentig.cli.plist')], expect.anything());
  vi.stubEnv('OPENTIG_SERVICE_HOME', home);
  expect(await manager.ownsProcess()).toBe(true);
  await manager.launchWorker('/usr/bin/node', '/tmp/service-update.mjs');
  const args = command.mock.calls.at(-1)![1];
  expect(args.slice(0, 2)).toEqual(['submit', '-l']);
  expect(args[2]).toMatch(/^com\.opentig\.update\./);
  expect(args.slice(3, 6)).toEqual(['--', '/usr/bin/node', '/tmp/service-update.mjs']);
});
