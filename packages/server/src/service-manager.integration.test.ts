import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createServiceManager, type ServiceWorker } from './service-manager';

async function cleanup(run: () => Promise<void>, failure: unknown) {
  try { await run(); }
  catch (error) {
    if (!failure) throw error;
    // Do not replace the lifecycle failure with an EBUSY from orphaned processes.
    console.error('Native service cleanup also failed:', error);
  }
}

// Opt-in: uses a unique native supervisor identity and temporary home, never the user's OpenTig service.
it.skipIf(process.env.OPENTIG_SERVICE_INTEGRATION !== '1')('installs, restarts, runs an independent update worker, and removes an isolated native service', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'OpenTig service & spaces-'));
  const manager = await createServiceManager(home, `opentig-test-${randomUUID()}`);
  const entry = path.join(home, 'fixture.mjs');
  const workerEntry = path.join(home, 'worker.mjs');
  const read = (name: string) => readFile(path.join(home, name), 'utf8');
  const wait = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) { if (await check().catch(() => false)) return; await delay(300); }
    throw new Error('Native service did not reach the expected state.');
  };
  const alive = (pid: string) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
  let worker: ServiceWorker | undefined;
  let failure: unknown;
  try {
    await writeFile(entry, `import fs from 'node:fs'; import { spawn } from 'node:child_process'; const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(path.join(home, 'child-pid'))}, String(child.pid)); fs.writeFileSync(${JSON.stringify(path.join(home, 'pid'))}, String(process.pid)); setInterval(() => {}, 1000);`);
    await writeFile(workerEntry, `import fs from 'node:fs'; import { setTimeout } from 'node:timers/promises'; fs.writeFileSync(${JSON.stringify(path.join(home, 'worker-started'))}, 'yes'); for (let i = 0; i < 600; i++) { if (fs.existsSync(${JSON.stringify(path.join(home, 'worker-continue'))})) { fs.writeFileSync(${JSON.stringify(path.join(home, 'worker-survived'))}, 'yes'); process.exit(0); } await setTimeout(100); } process.exit(1);`);
    const definition = manager.render({ nodeExecutable: process.execPath, cliEntrypoint: entry, home, host: '127.0.0.1', port: 6767, environmentPath: process.env.PATH });
    expect(manager.owns(definition)).toBe(true);
    await manager.write(definition);
    expect(await manager.read()).not.toBeNull();
    await manager.restart();
    await wait(async () => (await manager.status()).running && Number(await read('pid')) > 0);
    const firstPid = await read('pid');
    const firstChildPid = await read('child-pid');
    worker = await manager.launchWorker(process.execPath, workerEntry);
    await wait(async () => await read('worker-started') === 'yes');
    await manager.restart();
    await wait(async () => (await manager.status()).running && await read('pid') !== firstPid && !alive(firstPid) && !alive(firstChildPid));
    await writeFile(path.join(home, 'worker-continue'), 'yes');
    await wait(async () => await read('worker-survived') === 'yes');
    const finalPid = await read('pid');
    const finalChildPid = await read('child-pid');
    await manager.stop();
    await wait(async () => !alive(finalPid) && !alive(finalChildPid));
    await manager.remove();
    expect(await manager.read()).toBeNull();
  } catch (error) { failure = error; throw error; } finally { await cleanup(async () => {
    await worker?.cleanup();
    if (await manager.read() !== null) { await manager.stop(); await manager.remove(); }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }, failure); }
}, 120_000);

it.skipIf(process.env.OPENTIG_SERVICE_INTEGRATION !== '1')('installs the built CLI outside its source package and retains data after uninstall', async () => {
  const { createServer } = await import('node:net');
  const { manageCliService } = await import('./cli-service');
  const { parseCliArguments } = await import('./cli-config');
  const { readInstallation } = await import('./service-installation');
  const home = await mkdtemp(path.join(os.tmpdir(), 'OpenTig managed CLI &-'));
  const supervisor = await createServiceManager(home, `opentig-test-${randomUUID()}`);
  // Linux preflight would enable lingering for the real user. It is not needed
  // for this isolated test; CI explicitly prepares its disposable user manager.
  const manager = process.platform === 'linux' ? { ...supervisor, preflight: async () => undefined } : supervisor;
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  const config = (action: string) => parseCliArguments(['service', action, '--home', home, ...(action === 'install' ? ['--port', String(port)] : [])]);
  const io = { out: (message: string) => console.info(message) };
  let failure: unknown;
  try {
    await writeFile(path.join(home, 'retained.txt'), 'private data');
    expect(await manageCliService(config('install'), io, manager)).toBe(0);
    expect((await readInstallation(home))?.manager).toBe(manager.kind);
    expect(await manageCliService(config('status'), io, manager)).toBe(0);
    expect(await manageCliService(config('restart'), io, manager)).toBe(0);
    expect(await manageCliService(config('uninstall'), io, manager)).toBe(0);
    expect(await readFile(path.join(home, 'retained.txt'), 'utf8')).toBe('private data');
    expect(await readInstallation(home)).toBeNull();
  } catch (error) { failure = error; throw error; } finally { await cleanup(async () => {
    if (await manager.read() !== null) { await manager.stop(); await manager.remove(); }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }, failure); }
}, 180_000);
