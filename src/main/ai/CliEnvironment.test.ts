import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliEnvironment, cleanEnvironment, parseShellLocations, pathDirectories, readUserEnvironment, windowsLocations } from './CliEnvironment';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 }))); });

describe('CLI user environment', () => {
  it('imports only delimited location values despite startup noise', () => {
    expect(parseShellLocations('noise\nPATH=bad\0OPENTIG_ENV_PATH\0/custom/bin:/bin\0\0OPENTIG_ENV_HOME\0/wrong\0\0OPENTIG_ENV_OPENAI_API_KEY\0secret\0')).toEqual({ PATH: '/custom/bin:/bin' });
  });
  it('normalizes Windows Path and rejects relative/empty PATH entries', () => {
    expect(cleanEnvironment({ Path: 'old', PATH: 'new', HOME: 'keep' }, 'win32')).toEqual({ PATH: 'new', HOME: 'keep' });
    expect(pathDirectories(';.;relative;C:\\Bin;"D:\\Tools";c:\\bin', 'win32')).toEqual(['C:\\Bin', 'D:\\Tools']);
  });
  it('expands persisted Windows variables without invoking their contents or importing credentials', () => {
    expect(windowsLocations({ Machine: { Path: '%SystemRoot%\\bin', SystemRoot: 'C:\\Windows' }, User: { Path: '%CUSTOM%\\bin;%APPDATA%\\npm', CUSTOM: 'D:\\Custom', APPDATA: 'D:\\Roaming', TOKEN: 'private' } }, {})).toEqual({ APPDATA: 'D:\\Roaming', PATH: 'C:\\Windows\\bin;D:\\Custom\\bin;D:\\Roaming\\npm' });
  });
  it('coalesces concurrent refreshes and prevents old refreshes overwriting invalidated state', async () => {
    let finish!: (value: Record<string, string>) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ PATH: '/new' });
    const environment = new CliEnvironment({ platform: 'linux', home: '/account', env: { PATH: '/base', HOME: '/account' } }, read);
    const old = environment.get(true, true), shared = environment.get(true, true);
    expect(read).toHaveBeenCalledTimes(1);
    environment.invalidate(); await environment.get(true, true); finish({ PATH: '/old' });
    await Promise.all([old, shared]);
    expect((await environment.get(true)).refreshedPath).toEqual(['/new']);
    expect((await environment.get(true)).env.HOME).toBe('/account');
  });
  it('keeps the inherited environment with a safe diagnostic when refresh fails', async () => {
    const environment = new CliEnvironment({ platform: 'linux', home: '/account', env: { PATH: '/base' } }, async () => { throw new Error('private stderr'); });
    const result = await environment.get(true);
    expect(result.env.PATH).toBe('/base'); expect(result.warning).toContain('Could not refresh'); expect(result.warning).not.toContain('private');
  });
  it.skipIf(process.platform === 'win32')('loads interactive Bash startup with its noninteractive guard and closes stdin', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-shell-')); roots.push(home);
    await mkdir(path.join(home, 'wrapper'));
    // Isolate system startup files while exercising the real Bash interactive adapter.
    const shell = path.join(home, 'wrapper', 'bash');
    await writeFile(shell, '#!/bin/sh\nexec /bin/bash --noprofile --rcfile "$HOME/.bashrc" "$@"\n', { mode: 0o755 });
    await writeFile(path.join(home, '.bashrc'), 'case $- in *i*) ;; *) return;; esac\necho noisy-startup\nexport PATH="$HOME/selected-node/bin:$PATH"\nexport NVM_BIN="$HOME/selected-node/bin"\nread ignored || true\n');
    const env = await readUserEnvironment({ platform: process.platform, home, shell, env: { HOME: home, PATH: '/usr/bin:/bin' } });
    expect(env.PATH?.split(':')[0]).toBe(path.join(home, 'selected-node/bin')); expect(env.NVM_BIN).toBe(path.join(home, 'selected-node/bin')); expect(env).not.toHaveProperty('HOME');
  });
  it.skipIf(process.platform === 'win32')('bounds a hanging shell and kills descendants', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-shell-')); roots.push(home);
    const shell = path.join(home, 'bash');
    await writeFile(shell, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
    const started = Date.now();
    await expect(readUserEnvironment({ platform: process.platform, home, shell, env: { PATH: '/usr/bin:/bin' } })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(7_000);
  }, 8_000);
  it.skipIf(process.platform !== 'win32')('reads real Windows persisted environment with the system PowerShell', async () => {
    const env = await readUserEnvironment({ platform: process.platform, home: os.homedir(), env: cleanEnvironment(process.env) });
    expect(typeof env.PATH).toBe('string'); expect(env).not.toHaveProperty('HOME');
  });
});
