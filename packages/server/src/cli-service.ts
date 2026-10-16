import { access, cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { OpenTigCliConfig } from './cli-config';
import { OPEN_TIG_APP_VERSION } from './version';
import { newerVersion, packageDirectory, readInstallation, saveInstallation, type ServiceInstallation } from './service-installation';
import { assertManager, createServiceManager, type ServiceManager } from './service-manager';
import { resolveServiceNpm, runServiceNpm } from './service-npm';
import { CliError, cliCommand, diagnostic, errorCode, serviceError } from './cli-errors';
import { assertListenerAvailable, cliNetwork, sameListener } from './cli-network';
import { assertGitAvailable, isProcessRunning, probeRuntime, publicOrigin } from './cli-runtime';
import { readRuntimeState, resolveCliPaths, type OpenTigRuntimeState } from './cli-home';
import { readStartup, requestStartup, startupTimeout } from './cli-startup';
export { renderSystemdUnit } from './service-definitions';

export interface ServiceIo { out(value: string): void }

export async function manageCliService(config: OpenTigCliConfig, io: ServiceIo, managerOverride?: ServiceManager): Promise<number> {
  try { return await manage(config, io, managerOverride ?? await createServiceManager(config.home)); }
  catch (error) { throw serviceError(error, config.home, config.serviceAction ?? 'manage'); }
}

async function manage(config: OpenTigCliConfig, io: ServiceIo, manager: ServiceManager): Promise<number> {
  const action = config.serviceAction;
  if (!action) throw new CliError('SERVICE_ACTION_REQUIRED', 'A service action is required.', ['Use install, status, restart, or uninstall.']);
  const installed = await readInstallation(config.home);
  if (action !== 'status' && installed && newerVersion(installed.version, OPEN_TIG_APP_VERSION)) throw new CliError('SERVICE_VERSION_NEWER', 'A newer managed service is installed; downgrades are not automatic.', [
    'Update the global CLI to that version or later before administering this service.', `Check versions: ${cliCommand(config.home, '--version')}`,
  ]);
  const definition = await manager.read();
  if (definition && !manager.owns(definition)) throw new CliError('SERVICE_HOME_MISMATCH', 'Another OpenTig home owns this service.', [
    'Use the original installation\'s --home for status, restart, or uninstall. No service was changed.',
    `Service definition: ${manager.location}`,
  ]);
  if (installed) assertManager(installed, manager.kind);
  if (action === 'status') {
    if (!definition) { io.out('OpenTig service is not installed.'); io.out(`Install: ${cliCommand(config.home, 'service', 'install')}`); return 1; }
    const state = await manager.status();
    let status = state.starting ? 'starting' : state.running ? 'running' : 'stopped';
    let ready = false;
    if (state.running) {
      try { await verifiedServiceRuntime(config.home, manager); ready = true; }
      catch { status = 'running, backend not ready or identity not verified'; }
    }
    io.out(`OpenTig service: ${status} (${state.enabled ? 'enabled' : 'disabled'}).`);
    io.out(manager.location); io.out(manager.startup);
    if (!ready) io.out(`Inspect ${path.join(config.home, 'logs/server.log')}; restart with ${cliCommand(config.home, 'service', 'restart')}`);
    return ready && state.enabled ? 0 : 1;
  }
  if (action === 'uninstall' && !definition && !installed) { io.out('OpenTig service is not installed.'); return 0; }
  await mkdir(path.join(config.home, 'service'), { recursive: true, mode: 0o700 });
  const lock = path.join(config.home, 'service/update-lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (cause) {
    if (errorCode(cause) === 'EEXIST') throw new CliError('SERVICE_BUSY', 'A service installation or update is already in progress.', [
      `Check ${cliCommand(config.home, 'service', 'status')} and wait for the operation to finish.`,
      'Do not delete its lock until you have verified that no installation or update is active.',
    ], { cause });
    throw cause;
  }
  return withServiceLock(config.home, lock, async () => {
    if (action === 'restart') {
      if (!definition || !installed) throw new CliError('SERVICE_MISSING', 'OpenTig service is not installed.', [`Install: ${cliCommand(config.home, 'service', 'install')}`]);
      const attempt = await requestStartup(config.home);
      io.out('Restarting the OpenTig service...');
      await manager.restart();
      const runtime = await waitServiceReady(config.home, installed, manager, attempt);
      io.out(`OpenTig service restarted. Connection URL: ${publicOrigin(runtime.host, runtime.port)}`);
      return 0;
    }
    if (action === 'uninstall') {
      if (definition) { await manager.stop(); await manager.remove(); }
      await rm(path.join(config.home, 'service'), { recursive: true, force: true });
      io.out('OpenTig service removed. Repository settings and paired sessions were kept.');
      return 0;
    }
    io.out('Checking service configuration and listening address...');
    const network = await cliNetwork(config);
    let ownRuntime: OpenTigRuntimeState | null = null;
    try {
      const runtime = await readRuntimeState(resolveCliPaths(config.home).runtimeState);
      if (isProcessRunning(runtime.pid)) {
        if (definition && installed) ownRuntime = await verifiedServiceRuntime(config.home, manager);
        else throw new CliError('HOME_ACTIVE', 'OpenTig is already running for this home.', [
          `Pair a browser: ${cliCommand(config.home, 'pair')}`,
          'To install a service for this home, stop the foreground instance in its terminal and retry.',
          'No service was installed and the existing process was left running.',
        ]);
      }
    } catch (error) { if (!(error instanceof CliError && error.code === 'RUNTIME_MISSING')) throw error; }
    // Reinstalling our own verified service may reuse its occupied listener.
    if (!ownRuntime || !await sameListener(network, ownRuntime)) {
      try { await assertListenerAvailable(config, network, 'service install'); }
      catch (error) {
        if (error instanceof CliError) throw new CliError(error.code, error.message, [...error.actions, 'No service was installed or replaced.'], { cause: error });
        throw error;
      }
    }
    await assertGitAvailable();
    await resolveServiceNpm();
    await manager.preflight();
    return await installService(config, manager, installed, definition, io);
  });
}

async function withServiceLock(home: string, lock: string, run: () => Promise<number>): Promise<number> {
  let result = 1;
  let failed = false;
  let failure: unknown;
  try { result = await run(); }
  catch (error) { failed = true; failure = error; }
  try { await rm(lock, { recursive: true, force: true }); }
  catch (cleanup) {
    throw new CliError('SERVICE_LOCK_CLEANUP_FAILED', failed ? diagnostic(serviceError(failure, home, 'complete the operation')) : 'The service operation completed, but its lock could not be removed.', [
      `Lock cleanup also failed: check permissions on ${lock}.`,
      `Inspect ${cliCommand(home, 'service', 'status')} and verify no operation is active before repairing the lock.`,
    ], { cause: failed ? new AggregateError([failure, cleanup], 'Service operation and lock cleanup failed.') : cleanup });
  }
  if (failed) throw failure;
  return result;
}

async function installService(config: OpenTigCliConfig, manager: ServiceManager, installed: ServiceInstallation | null, previousDefinition: string | null, io: ServiceIo): Promise<number> {
  const packageRoot = await findPackageRoot(fileURLToPath(import.meta.url));
  await assertPackageBuild(packageRoot);
  const serviceRoot = path.join(config.home, 'service');
  const reuse = installed?.version === OPEN_TIG_APP_VERSION;
  const target = reuse ? packageDirectory(config.home, installed) : path.join(serviceRoot, `app-${OPEN_TIG_APP_VERSION}`);
  const temporary = path.join(serviceRoot, `.install-${process.pid}-${Date.now()}`);
  io.out('Preparing the managed CLI and dependencies...');
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
  let runtime: OpenTigRuntimeState;
  try {
    io.out('Registering the OpenTig user service...');
    await manager.write(definition);
    await saveInstallation(config.home, next);
    const attempt = await requestStartup(config.home);
    io.out('Starting the service and verifying its identity...');
    await manager.restart();
    runtime = await waitServiceReady(config.home, next, manager, attempt);
  } catch (error) {
    const original = serviceError(error, config.home, 'install');
    try {
      if (previousDefinition) {
        await manager.write(previousDefinition);
        if (installed) await saveInstallation(config.home, installed);
        else await rm(path.join(serviceRoot, 'installation.json'), { force: true });
        const attempt = await requestStartup(config.home);
        await manager.restart();
        if (!installed) throw new CliError('RECOVERY_UNVERIFIED', 'The previous service definition has no installation metadata.');
        await waitServiceReady(config.home, installed, manager, attempt);
      } else {
        await manager.stop();
        await manager.remove();
        await rm(path.join(serviceRoot, 'installation.json'), { force: true });
      }
    } catch (recovery) {
      throw new CliError('SERVICE_RECOVERY_FAILED', diagnostic(original), [
        `Recovery also failed: ${diagnostic(serviceError(recovery, config.home, 'restore or remove'))}`,
        `The final service state is not verified. Inspect ${cliCommand(config.home, 'service', 'status')} before retrying.`,
      ], { cause: new AggregateError([original, recovery], 'Installation and recovery both failed.') });
    }
    throw new CliError(original.code, diagnostic(original), [previousDefinition
      ? 'The previous service was restored and verified.' : 'The newly registered service was removed. Existing applications were left running.'], { cause: original });
  }
  io.out(`OpenTig service installed and started on ${runtime.host}:${runtime.port}.`);
  io.out(`Connection URL: ${publicOrigin(runtime.host, runtime.port)}`);
  io.out(manager.location); io.out(manager.startup);
  io.out(`Pair another browser with: ${cliCommand(config.home, 'pair')}`);
  return 0;
}

export async function verifiedServiceRuntime(home: string, manager: ServiceManager): Promise<OpenTigRuntimeState & { legacy?: boolean }> {
  const runtime = await readRuntimeState(resolveCliPaths(home).runtimeState);
  const state = await manager.status();
  const owned = state.pid ? state.pid === runtime.pid : await manager.ownsRuntime?.(runtime.pid);
  if (!state.running || !owned) throw new CliError('SERVICE_PROCESS_MISMATCH', 'The running OpenTig instance is not verified as this managed service.', [
    `Check ${cliCommand(home, 'service', 'status')}. If a foreground instance uses this home, stop it in its terminal before installing the service.`,
    'No unknown process was stopped.',
  ]);
  return probeRuntime(home, runtime, true);
}

export async function waitServiceReady(home: string, installation: ServiceInstallation, manager: ServiceManager, attempt?: string): Promise<OpenTigRuntimeState> {
  for (let i = 0; i < 30; i++) {
    const startup = await readStartup(home);
    if (attempt && startup?.attempt === attempt && startup.phase === 'failed') {
      throw new CliError(startup.code ?? 'STARTUP_FAILED', startup.message ?? 'The service failed during startup.');
    }
    try {
      const runtime = await verifiedServiceRuntime(home, manager);
      if (runtime.appVersion === installation.version && (!attempt || startup?.attempt === attempt && startup.phase === 'ready'
        && startup.pid === runtime.pid && startup.instanceId === runtime.instanceId
        || runtime.legacy && startup?.attempt === attempt && startup.phase === 'pending' && Date.parse(runtime.startedAt) >= Date.parse(startup.requestedAt))) return runtime;
    } catch { /* Starting, or an unrelated listener; never accept public readiness alone. */ }
    await delay(1_000);
  }
  throw startupTimeout(home);
}

async function assertPackageBuild(packageRoot: string): Promise<void> {
  await Promise.all([
    access(path.join(packageRoot, 'dist/bin.mjs')),
    access(path.join(packageRoot, 'dist/client/index.html')),
    readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  ]).catch(cause => { throw new CliError('PACKAGE_INCOMPLETE', 'The OpenTig package is incomplete and cannot be installed as a service.', ['Reinstall the same CLI version from npm, then retry.'], { cause }); });
}

async function findPackageRoot(moduleUrl: string): Promise<string> {
  let directory = path.dirname(moduleUrl);
  for (let depth = 0; depth < 4; depth++) {
    try { await Promise.all([access(path.join(directory, 'package.json')), access(path.join(directory, 'dist/bin.mjs'))]); return directory; }
    catch { /* keep walking out of src/dist/chunks */ }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new CliError('PACKAGE_INCOMPLETE', 'Could not locate the installed OpenTig package.', ['Reinstall the CLI from npm, then retry.']);
}
