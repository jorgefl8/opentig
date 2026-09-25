import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertManager, createServiceManager } from './service-manager';
import { atomicWrite, newerVersion, packageDirectory, readInstallation, saveInstallation, type ServiceInstallation } from './service-installation';

export interface UpdateTransaction {
  activate(): Promise<void>;
  restart(): Promise<void>;
  healthy(): Promise<boolean>;
  restore(): Promise<void>;
}
/** The worker is owned by a separate supervisor job, so stopping the server cannot kill it. */
export async function runUpdateTransaction(transaction: UpdateTransaction): Promise<boolean> {
  try {
    await transaction.activate();
    await transaction.restart();
    if (!await transaction.healthy()) throw new Error('New server did not become ready.');
    return true;
  } catch {
    await transaction.restore();
    await transaction.restart();
    return false;
  }
}
export async function applyServiceUpdate(home: string): Promise<void> {
  const manager = await createServiceManager(home);
  const lock = path.join(home, 'service/update-lock');
  const resultFile = path.join(home, 'service/update-result.json');
  const plan = JSON.parse(await readFile(path.join(lock, 'plan.json'), 'utf8')) as {
    home: string; current: ServiceInstallation; next: ServiceInstallation; previousUnit: string; integrity: string;
  };
  if (plan.home !== home || !path.isAbsolute(home) || !newerVersion(plan.next.version, plan.current.version)
    || JSON.stringify(await readInstallation(home)) !== JSON.stringify(plan.current)
    || await manager.read() !== plan.previousUnit || !manager.owns(plan.previousUnit)) throw new Error('Service changed since the update was requested.');
  assertManager(plan.current, manager.kind);
  assertManager(plan.next, manager.kind);
  const marker = JSON.parse(await readFile(path.join(home, 'service', `app-${plan.next.version}`, 'update-integrity.json'), 'utf8'));
  if (marker.version !== plan.next.version || marker.integrity !== plan.integrity) throw new Error('Prepared service identity changed.');
  const nextEntry = path.join(packageDirectory(home, plan.next), 'dist/bin.mjs');
  const result = (success: boolean) => atomicWrite(resultFile, JSON.stringify({ success, version: success ? plan.next.version : plan.current.version }));
  // Let the HTTP response reach the initiating browser before closing the server.
  await delay(1_000);
  try {
    await runUpdateTransaction({
      activate: async () => {
        await manager.write(manager.render({ nodeExecutable: plan.next.node, cliEntrypoint: nextEntry, home, host: plan.next.host, port: plan.next.port, environmentPath: plan.next.environmentPath }));
        await saveInstallation(home, plan.next);
      },
      restart: () => manager.restart(),
      healthy: async () => {
        const host = ['0.0.0.0', '::'].includes(plan.next.host) ? (plan.next.host === '::' ? '[::1]' : '127.0.0.1') : plan.next.host.includes(':') ? `[${plan.next.host}]` : plan.next.host;
        for (let i = 0; i < 30; i++) {
          try {
            const response = await fetch(`http://${host}:${plan.next.port}/readyz`, { signal: AbortSignal.timeout(1000) });
            const identity = await response.json() as { appVersion?: string; status?: string };
            if (response.ok && identity.appVersion === plan.next.version && identity.status === 'ready') { await result(true); return true; }
          } catch { /* Server may still be starting. */ }
          await delay(1_000);
        }
        return false;
      },
      restore: async () => {
        await manager.write(plan.previousUnit);
        await saveInstallation(home, plan.current);
        await result(false);
      },
    });
  } finally { await rm(lock, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await applyServiceUpdate(process.argv[2]!).catch(() => {
    process.stderr.write('OpenTig service update failed. Inspect the managed service before retrying.\n');
    process.exitCode = 1;
  }).finally(async () => {
    if (process.argv[3]) await (await createServiceManager(process.argv[2]!)).cleanupWorker(process.argv[3]).catch(() => undefined);
  });
}
