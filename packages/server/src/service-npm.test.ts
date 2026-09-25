import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runServiceNpm } from './service-npm';
const command = vi.hoisted(() => vi.fn<(command: string, args: string[], options: unknown) => Promise<{ stdout: string }>>(async () => ({ stdout: '' })));
vi.mock('./service-installation', async original => ({ ...await original<typeof import('./service-installation')>(), execute: command }));
afterEach(() => { vi.unstubAllEnvs(); command.mockClear(); });
it('invokes npm through Node with literal arguments even for paths containing spaces and shell characters', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig npm &-'));
  try {
    const npm = path.join(directory, 'npm-cli.js');
    await writeFile(npm, 'fixture');
    vi.stubEnv('npm_execpath', npm);
    const args = ['install', '--prefix', path.join(directory, '$literal'), '--ignore-scripts'];
    await runServiceNpm(args, directory);
    expect(command).toHaveBeenCalledWith(process.execPath, [npm, ...args], expect.objectContaining({ cwd: directory, windowsHide: true }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('does not treat a bun npm_execpath as npm', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig npm-'));
  try {
    await mkdir(path.join(directory, 'node_modules/npm/bin'), { recursive: true });
    await writeFile(path.join(directory, 'node_modules/npm/bin/npm-cli.js'), 'fixture');
    vi.stubEnv('npm_execpath', path.join(directory, 'bun'));
    vi.stubEnv('PATH', directory);
    await runServiceNpm(['--version']);
    expect(command.mock.calls[0]?.[1]).not.toContain(path.join(directory, 'bun'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
