import { execFile } from 'node:child_process';
import { access, chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { OpenTigCliConfig } from './cli-config';
import { OPEN_TIG_APP_VERSION } from './version';

const UNIT_NAME = 'opentig.service';

export interface ServiceIo {
  out(value: string): void;
}

export async function manageCliService(config: OpenTigCliConfig, io: ServiceIo): Promise<number> {
  if (process.platform !== 'linux') {
    throw new Error('Background service management currently supports Linux with systemd. On this platform, start OpenTig with your preferred service manager.');
  }
  const action = config.serviceAction;
  if (!action) throw new Error('A service action is required.');
  const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', UNIT_NAME);
  if (action === 'status') return serviceStatus(unitPath, io);
  if (action === 'uninstall') return uninstallService(config.home, unitPath, io);
  return installService(config, unitPath, io);
}

async function installService(config: OpenTigCliConfig, unitPath: string, io: ServiceIo): Promise<number> {
  const packageRoot = await findPackageRoot(fileURLToPath(import.meta.url));
  await assertPackageBuild(packageRoot);
  const serviceRoot = path.join(config.home, 'service');
  const target = path.join(serviceRoot, `app-${OPEN_TIG_APP_VERSION}`);
  const temporary = path.join(serviceRoot, `.install-${process.pid}-${Date.now()}`);
  await mkdir(serviceRoot, { recursive: true, mode: 0o700 });
  await rm(temporary, { recursive: true, force: true });
  try {
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    await cp(path.join(packageRoot, 'dist'), path.join(temporary, 'dist'), { recursive: true, force: true });
    for (const name of ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      await cp(path.join(packageRoot, name), path.join(temporary, name), { force: true });
    }
    await installProductionDependencies(temporary);
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }

  const unit = renderSystemdUnit({
    nodeExecutable: process.execPath,
    cliEntrypoint: path.join(target, 'dist', 'bin.mjs'),
    host: config.host,
    port: config.port,
    home: config.home,
  });
  await mkdir(path.dirname(unitPath), { recursive: true, mode: 0o700 });
  const temporaryUnit = `${unitPath}.${process.pid}.tmp`;
  await writeFile(temporaryUnit, unit, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryUnit, unitPath);
  await chmod(unitPath, 0o600);

  await runRequired('systemctl', ['--user', 'daemon-reload']);
  await runRequired('systemctl', ['--user', 'enable', '--now', UNIT_NAME]);
  await runRequired('loginctl', ['enable-linger']);
  io.out(`OpenTig service installed and started on ${config.host}:${config.port}.`);
  io.out(`Unit: ${unitPath}`);
  io.out(`Pair another browser with: opentig pair --home ${config.home}`);
  return 0;
}

async function serviceStatus(unitPath: string, io: ServiceIo): Promise<number> {
  try { await access(unitPath); }
  catch {
    io.out('OpenTig service is not installed.');
    return 1;
  }
  const enabled = await run('systemctl', ['--user', 'is-enabled', UNIT_NAME]);
  const active = await run('systemctl', ['--user', 'is-active', UNIT_NAME]);
  io.out(`OpenTig service: ${active.stdout.trim() || 'unknown'} (${enabled.stdout.trim() || 'unknown'}).`);
  io.out(`Unit: ${unitPath}`);
  return active.code === 0 ? 0 : 1;
}

async function uninstallService(home: string, unitPath: string, io: ServiceIo): Promise<number> {
  await run('systemctl', ['--user', 'disable', '--now', UNIT_NAME]);
  await rm(unitPath, { force: true });
  await runRequired('systemctl', ['--user', 'daemon-reload']);
  await rm(path.join(home, 'service'), { recursive: true, force: true });
  io.out('OpenTig service removed. Repository settings and paired sessions were kept.');
  return 0;
}

export function renderSystemdUnit(input: {
  nodeExecutable: string;
  cliEntrypoint: string;
  host: string;
  port: number;
  home: string;
}): string {
  const args = [
    input.nodeExecutable,
    input.cliEntrypoint,
    'serve',
    '--host', input.host,
    '--port', String(input.port),
    '--home', input.home,
  ];
  return `[Unit]
Description=OpenTig browser Git client
After=network.target

[Service]
Type=simple
WorkingDirectory=${systemdWorkingDirectory(input.home)}
ExecStart=${args.map(systemdQuote).join(' ')}
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=10

[Install]
WantedBy=default.target
`;
}

function systemdQuote(value: string): string {
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) throw new Error('Service paths and arguments cannot contain control characters.');
  return `"${value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function systemdWorkingDirectory(value: string): string {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('Service home must be an absolute single-line path.');
  // Unlike ExecStart, this setting is a literal path, not a list of quoted
  // arguments. A final slash also protects trailing spaces/backslashes from
  // the unit file's whitespace trimming and line continuation handling.
  return `${value.replaceAll('%', '%%')}/`;
}

async function assertPackageBuild(packageRoot: string): Promise<void> {
  await Promise.all([
    access(path.join(packageRoot, 'dist', 'bin.mjs')),
    access(path.join(packageRoot, 'dist', 'client', 'index.html')),
    readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  ]).catch(() => {
    throw new Error('The OpenTig package is incomplete and cannot be installed as a service.');
  });
}

async function findPackageRoot(modulePath: string): Promise<string> {
  let directory = path.dirname(modulePath);
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      await Promise.all([
        access(path.join(directory, 'package.json')),
        access(path.join(directory, 'dist', 'bin.mjs')),
      ]);
      return directory;
    } catch { /* keep walking out of src/dist/chunks */ }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('Could not locate the installed OpenTig package.');
}

async function installProductionDependencies(directory: string): Promise<void> {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    await runRequired(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
    return;
  }
  await runRequired('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
}

function runRequired(command: string, args: string[], cwd?: string): Promise<void> {
  return run(command, args, cwd).then((result) => {
    if (result.code !== 0) throw new Error(`${command} failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`}`);
  });
}

function run(command: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: 120_000, windowsHide: true }, (error, stdout, stderr) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === 'number'
        ? (error as NodeJS.ErrnoException & { code: number }).code
        : error ? 1 : 0;
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(`${command} is required but was not found.`));
      resolve({ code, stdout, stderr });
    });
  });
}
