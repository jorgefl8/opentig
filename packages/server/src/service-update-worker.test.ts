import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyServiceUpdate } from './service-update-worker';
import { readInstallation, saveInstallation, type ServiceInstallation } from './service-installation';
import { renderSystemdUnit } from './cli-service';

const manager = vi.hoisted(() => ({ unit: '', systemctl: vi.fn() }));
vi.mock('./service-installation', async (original) => ({
  ...await original<typeof import('./service-installation')>(),
  serviceUnitPath: () => manager.unit,
  systemctl: manager.systemctl,
}));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

let home: string;
let previousUnit: string;
const current: ServiceInstallation = { schema: 1, version: '0.1.2', layout: 'flat', host: '127.0.0.1', port: 16867, node: process.execPath, environmentPath: '/home/me/.local/bin:/usr/bin' };
const next: ServiceInstallation = { ...current, version: '0.1.3', layout: 'npm' };
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'opentig-update-transaction-'));
  manager.unit = path.join(home, 'opentig.service');
  manager.systemctl.mockReset();
  await mkdir(path.join(home, 'service/update-lock'), { recursive: true });
  await mkdir(path.join(home, 'service/app-0.1.3'), { recursive: true });
  previousUnit = renderSystemdUnit({ nodeExecutable: current.node, cliEntrypoint: path.join(home, 'service/app-0.1.2/dist/bin.mjs'), home, host: current.host, port: current.port, environmentPath: current.environmentPath });
  await writeFile(manager.unit, previousUnit);
  await saveInstallation(home, current);
  await writeFile(path.join(home, 'service/app-0.1.3/update-integrity.json'), JSON.stringify({ version: next.version, integrity: 'verified-download' }));
  await writeFile(path.join(home, 'service/update-lock/plan.json'), JSON.stringify({ home, current, next, previousUnit, integrity: 'verified-download' }));
  // A private data sentinel must survive activation and rollback unchanged.
  await writeFile(path.join(home, 'private-data.json'), 'paired sessions and repositories');
});
afterEach(async () => { vi.unstubAllGlobals(); await rm(home, { recursive: true, force: true }); });

it('switches the unit and launcher metadata together and keeps the address and private data', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ready', appVersion: next.version })));
  manager.systemctl.mockImplementation(async (action) => {
    if (action === 'restart') expect(await readInstallation(home)).toEqual(next);
  });
  await applyServiceUpdate(home);
  const unit = await readFile(manager.unit, 'utf8');
  expect(unit.replaceAll('\\\\', '/')).toContain('app-0.1.3/node_modules/@opentig/cli/dist/bin.mjs');
  expect(unit).toContain('Environment="PATH=/home/me/.local/bin:/usr/bin"');
  expect(unit).toContain('"--host" "127.0.0.1" "--port" "16867"');
  expect(await readInstallation(home)).toEqual(next);
  expect(JSON.parse(await readFile(path.join(home, 'service/update-result.json'), 'utf8')).success).toBe(true);
  expect(await readFile(path.join(home, 'private-data.json'), 'utf8')).toBe('paired sessions and repositories');
  await expect(readFile(path.join(home, 'service/update-lock/plan.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['wrong-version', 'restart-failure'])('restores the actual unit and metadata after %s', async (failure) => {
  const restarted: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ready', appVersion: current.version })));
  manager.systemctl.mockImplementation(async (action) => {
    if (action !== 'restart') return;
    restarted.push((await readInstallation(home))!.version);
    if (failure === 'restart-failure' && restarted.length === 1) throw new Error('failed to start');
    if (restarted.length === 2) expect(JSON.parse(await readFile(path.join(home, 'service/update-result.json'), 'utf8')).success).toBe(false);
  });
  await applyServiceUpdate(home);
  expect(restarted).toEqual([next.version, current.version]);
  expect(await readFile(manager.unit, 'utf8')).toBe(previousUnit);
  expect(await readInstallation(home)).toEqual(current);
  expect(await readFile(path.join(home, 'private-data.json'), 'utf8')).toBe('paired sessions and repositories');
});

it('refuses to overwrite a unit changed after the update was requested', async () => {
  await writeFile(manager.unit, 'externally changed unit');
  await expect(applyServiceUpdate(home)).rejects.toThrow('Service changed');
  expect(manager.systemctl).not.toHaveBeenCalled();
  expect(await readFile(manager.unit, 'utf8')).toBe('externally changed unit');
  expect(await readInstallation(home)).toEqual(current);
});
