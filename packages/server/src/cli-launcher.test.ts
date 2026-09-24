import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { delegateToService } from './cli-launcher';
import { manageCliService } from './cli-service';
import { packageDirectory, readInstallation, saveInstallation } from './service-installation';

const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-launcher-')); homes.push(home);
  const install = { schema: 1 as const, version: '99.0.0', layout: 'npm' as const, host: '127.0.0.1', port: 17667, node: process.execPath };
  const directory = packageDirectory(home, install);
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await saveInstallation(home, install);
  await writeFile(path.join(directory, 'dist/bin.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(path.join(home, 'delegation.json'))}, JSON.stringify({ args: process.argv.slice(2), delegated: process.env.OPENTIG_DELEGATED }));`);
  return home;
}
it('delegates administration from an older global launcher to the managed version', async () => {
  const home = await fixture();
  expect(await delegateToService(['service', 'install', '--home', home], fileURLToPath(import.meta.url))).toBe(0);
  expect(JSON.parse(await readFile(path.join(home, 'delegation.json'), 'utf8'))).toEqual({ args: ['service', 'install', '--home', home], delegated: '1' });
});
it('reports both versions for a custom service home', async () => {
  const home = await fixture();
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  expect(await delegateToService(['--version', '--home', home], fileURLToPath(import.meta.url))).toBe(0);
  expect(output).toHaveBeenCalledWith(expect.stringContaining('OpenTig service 99.0.0\nGlobal launcher'));
});
it('refuses to reinstall an older runtime even if delegation was bypassed', async () => {
  const home = await fixture();
  await expect(manageCliService({ command: 'service', serviceAction: 'install', home, host: '127.0.0.1', port: 6767, openBrowser: false }, { out: vi.fn() })).rejects.toThrow('newer managed service');
  expect((await readInstallation(home))?.version).toBe('99.0.0');
});
it('lets the CLI report invalid arguments without consulting a managed installation', async () => {
  expect(await delegateToService(['--port', 'invalid'], fileURLToPath(import.meta.url))).toBeNull();
});
it('does not recurse after delegation', async () => {
  const home = await fixture();
  vi.stubEnv('OPENTIG_DELEGATED', '1');
  expect(await delegateToService(['pair', '--home', home], fileURLToPath(import.meta.url))).toBeNull();
});
