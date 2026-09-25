import { access, cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { OpenTigCliConfig } from './cli-config';
import { OPEN_TIG_APP_VERSION } from './version';
import { newerVersion, packageDirectory, readInstallation, saveInstallation, type ServiceInstallation } from './service-installation';
import { assertManager, createServiceManager, type ServiceManager } from './service-manager';
import { runServiceNpm } from './service-npm';
export { renderSystemdUnit } from './service-definitions';

export interface ServiceIo { out(value: string): void }

export async function manageCliService(config: OpenTigCliConfig, io: ServiceIo, managerOverride?: ServiceManager): Promise<number> {
  const manager = managerOverride ?? await createServiceManager(config.home);
  const action = config.serviceAction;
  if (!action) throw new Error('A service action is required.');
  const installed = await readInstallation(config.home);
  if (action !== 'status' && installed && newerVersion(installed.version, OPEN_TIG_APP_VERSION)) throw new Error('A newer managed service is installed. Use its CLI to administer it; downgrades are not automatic.');
  const definition = await manager.read();
  if (definition && !manager.owns(definition)) throw new Error('Another OpenTig home owns this service. Use its --home before changing or removing it.');
  if (installed) assertManager(installed, manager.kind);
  if (action === 'status') {
    if (!definition) { io.out('OpenTig service is not installed.'); return 1; }
    const state = await manager.status();
    io.out(`OpenTig service: ${state.running ? 'running' : 'stopped'} (${state.enabled ? 'enabled' : 'disabled'}).`);
    io.out(manager.location); io.out(manager.startup);
    return state.running && state.enabled ? 0 : 1;
  }
  if (action === 'uninstall' && !definition && !installed) { io.out('OpenTig service is not installed.'); return 0; }
  await mkdir(path.join(config.home, 'service'), { recursive: true, mode: 0o700 });
  const lock = path.join(config.home, 'service/update-lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A service installation or update is already in progress.', { cause: error });
    throw error;
  }
  try {
    if (action === 'restart') {
      if (!definition || !installed) throw new Error('OpenTig service is not installed.');
      await manager.restart();
      await waitServiceReady(config.home, installed, manager);
      io.out('OpenTig service restarted.');
      return 0;
    }
    if (action === 'uninstall') {
      if (definition) { await manager.stop(); await manager.remove(); }
      await rm(path.join(config.home, 'service'), { recursive: true, force: true });
      io.out('OpenTig service removed. Repository settings and paired sessions were kept.');
      return 0;
    }
    await manager.preflight();
    return await installService(config, manager, installed, definition, io);
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function installService(config: OpenTigCliConfig, manager: ServiceManager, installed: ServiceInstallation | null, previousDefinition: string | null, io: ServiceIo): Promise<number> {
  const packageRoot = await findPackageRoot(fileURLToPath(import.meta.url));
  await assertPackageBuild(packageRoot);
  const serviceRoot = path.join(config.home, 'service');
  const reuse = installed?.version === OPEN_TIG_APP_VERSION;
  const target = reuse ? packageDirectory(config.home, installed) : path.join(serviceRoot, `app-${OPEN_TIG_APP_VERSION}`);
  const temporary = path.join(serviceRoot, `.install-${process.pid}-${Date.now()}`);
  try {
    if (!reuse) {
      await mkdir(temporary, { recursive: true, mode: 0o700 });
      await cp(path.join(packageRoot, 'dist'), path.join(temporary, 'dist'), { recursive: true });
      for (const name of ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(path.join(packageRoot, name), path.join(temporary, name));
      await runServiceNpm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], temporary);
      await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  await assertPackageBuild(target);
  const next: ServiceInstallation = { schema: 1, manager: manager.kind, version: OPEN_TIG_APP_VERSION, layout: reuse ? installed.layout : 'flat', host: config.host, port: config.port, node: process.execPath, environmentPath: process.env.PATH };
  const definition = manager.render({ nodeExecutable: next.node, cliEntrypoint: path.join(target, 'dist/bin.mjs'), home: config.home, host: next.host, port: next.port, environmentPath: next.environmentPath });
  try {
    await manager.write(definition);
    await saveInstallation(config.home, next);
    await manager.restart();
    await waitServiceReady(config.home, next, manager);
  } catch (error) {
    // Restore both the supervisor definition and launcher metadata before restarting.
    if (previousDefinition) {
      await manager.write(previousDefinition);
      if (installed) await saveInstallation(config.home, installed);
      else await rm(path.join(serviceRoot, 'installation.json'), { force: true });
      await manager.restart();
    } else {
      await manager.stop();
      await manager.remove();
      await rm(path.join(serviceRoot, 'installation.json'), { force: true });
    }
    throw error;
  }
  io.out(`OpenTig service installed and started on ${config.host}:${config.port}.`);
  io.out(manager.location); io.out(manager.startup);
  io.out(`Pair another browser with: opentig pair --home ${JSON.stringify(config.home)}`);
  return 0;
}

export async function waitServiceReady(home: string, installation: ServiceInstallation, manager: ServiceManager): Promise<void> {
  const host = ['0.0.0.0', '::'].includes(installation.host) ? (installation.host === '::' ? '[::1]' : '127.0.0.1') : installation.host.includes(':') ? `[${installation.host}]` : installation.host;
  for (let i = 0; i < 30; i++) {
    try {
      const state = await manager.status();
      const runtime = JSON.parse(await readFile(path.join(home, 'runtime.json'), 'utf8'));
      const response = await fetch(`http://${host}:${installation.port}/readyz`, { signal: AbortSignal.timeout(1_000) });
      const value = await response.json() as { status?: string; appVersion?: string };
      if (state.running && (!state.pid || state.pid === runtime.pid) && runtime.appVersion === installation.version && response.ok && value.status === 'ready' && value.appVersion === installation.version) return;
    } catch { /* The service may still be starting. */ }
    await delay(1_000);
  }
  throw new Error('The managed service did not become ready. Inspect service status and logs; check Git, Node.js, and the configured port.');
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
