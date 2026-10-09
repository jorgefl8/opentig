import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliEnvironment, cleanEnvironment, LOCATION_KEYS, readUserEnvironment, type EnvironmentReader } from './CliEnvironment';
import { CliResolver } from './CliResolver';
import { CliProcessRunner } from './CliProcessRunner';
import { OpenCodeProvider } from './providers/OpenCodeProvider';
import { CodexProvider } from './providers/CodexProvider';
import { runCandidate, selectCli } from './cli-selection';
import { SettingsStore } from '../persistence/SettingsStore';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 }))); });
async function setup(read?: EnvironmentReader) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-cli-integration-')); roots.push(home);
  const env: Record<string, string> = { ...cleanEnvironment(process.env), HOME: home, PATH: '' };
  // Installed launchers on the developer machine must not leak into the fixture.
  for (const key of LOCATION_KEYS) if (key !== 'PATH') delete env[key];
  const environment = new CliEnvironment({ platform: process.platform, home, env }, read ?? (async () => ({ PATH: path.join(home, 'runtime') })));
  const resolver = new CliResolver(environment);
  const runner = new CliProcessRunner();
  const install = async (directory: string, name: string, version = '2.0.22', customRuntime = false) => {
    const dir = path.join(home, directory); await mkdir(dir, { recursive: true });
    const script = path.join(dir, `${name}.mjs`);
    await writeFile(script, `const arg=process.argv[2]; console.log(arg==='--version' ? ${JSON.stringify(version)} : arg==='auth' ? '[{"id":"fixture","connections":[{"type":"credential","label":"account"}]}]' : arg==='models' ? 'fixture/model' : JSON.stringify({args:process.argv.slice(2),path:process.env.PATH}));`);
    const file = path.join(dir, name + (process.platform === 'win32' ? '.cmd' : ''));
    const runtime = customRuntime ? 'opentig-fixture-node' + (process.platform === 'win32' ? '.exe' : '') : process.execPath;
    await writeFile(file, process.platform === 'win32' ? `@echo off\r\n"${runtime}" "%~dp0${name}.mjs" %*\r\n` : `#!/bin/sh\nexec '${runtime.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
    return file;
  };
  return { home, env, resolver, runner, install };
}

describe('real CLI discovery and launch', () => {
  it('automatically discovers a user-PATH installation despite a persisted false preference', async () => {
    const f = await setup(async (host) => ({ PATH: path.join(host.home, 'custom') }));
    const settingsPath = path.join(f.home, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ preferences: { aiShellEnvironment: false } }));
    const settings = new SettingsStore(settingsPath);
    await settings.load();
    const executable = await f.install('custom', 'opencode');
    const resolver = new CliResolver(f.resolver.environment, () => settings.preferences);
    expect(await new OpenCodeProvider(resolver, f.runner).status()).toMatchObject({
      availability: 'ready', installed: true, executablePath: executable, executableSource: 'user-path',
    });
  });

  it.each(['inherited', 'known'] as const)('keeps a %s CLI available when environment refresh fails', async (location) => {
    const f = await setup(async () => { throw new Error('private shell output'); });
    const executable = await f.install(location === 'inherited' ? 'bin' : '.opencode/bin', 'opencode');
    if (location === 'inherited') f.env.PATH = path.dirname(executable);
    const status = await new OpenCodeProvider(f.resolver, f.runner).status();
    expect(status).toMatchObject({ availability: 'ready', installed: true, executablePath: executable,
      executableSource: location === 'inherited' ? 'process-path' : 'known-location' });
    expect(status.discoveryWarning).toContain('Using the inherited environment and known installation locations');
    expect(status.discoveryWarning).not.toContain('private shell output');
  });

  it.skipIf(process.platform === 'win32')('continues detecting an installed CLI after a real shell timeout', async () => {
    const f = await setup(readUserEnvironment);
    const shell = path.join(f.home, 'bash');
    await writeFile(shell, '#!/bin/sh\n/bin/sleep 30\n', { mode: 0o755 });
    f.resolver.environment.host.shell = shell;
    const executable = await f.install('.opencode/bin', 'opencode');
    const started = Date.now();
    const status = await new OpenCodeProvider(f.resolver, f.runner).status();
    expect(Date.now() - started).toBeLessThan(7_000);
    expect(status).toMatchObject({ availability: 'ready', executablePath: executable, executableSource: 'known-location' });
    expect(status.discoveryWarning).toContain('Could not refresh the user environment');
  }, 8_000);

  it('detects OpenCode installed after startup without changing the service PATH', async () => {
    const f = await setup(); const provider = new OpenCodeProvider(f.resolver, f.runner);
    expect(await provider.status()).toMatchObject({ installed: false });
    const executable = await f.install('.opencode/bin', 'opencode');
    expect(await provider.status(true)).toMatchObject({ installed: true, availability: 'ready', executablePath: executable, executableSource: 'known-location', installationStatus: 'available' });
    expect(f.env.PATH).toBe('');
  });
  it('skips an older installation of the same alias and selects the compatible version', async () => {
    const f = await setup(); await f.install('old', 'opencode', '1.15.0'); const executable = await f.install('current', 'opencode');
    f.env.PATH = [path.join(f.home, 'old'), path.join(f.home, 'current')].join(path.delimiter);
    expect(await new OpenCodeProvider(f.resolver, f.runner).status()).toMatchObject({ availability: 'ready', executablePath: executable, version: '2.0.22' });
  });
  it('recovers a wrapper dependency from the selected manager environment and retains it for later launches', async () => {
    const f = await setup(); await mkdir(path.join(f.home, 'runtime'));
    await copyFile(process.execPath, path.join(f.home, 'runtime', 'opentig-fixture-node' + (process.platform === 'win32' ? '.exe' : '')));
    const executable = await f.install('CLI tools & Unicode-ñ', 'opencode', '2.0.22', true);
    f.env.PATH = path.dirname(executable);
    const detected = await selectCli(f.resolver, f.runner, 'opencode');
    expect(detected.state).toBe('available');
    const result = await runCandidate(f.runner, detected.candidate!, ['echo', 'literal spaces', 'a&b', '$(never-run)', 'Unicode-ñ']);
    expect(JSON.parse(result.stdout)).toMatchObject({ args: ['echo', 'literal spaces', 'a&b', '$(never-run)', 'Unicode-ñ'] });
    expect(JSON.parse(result.stdout).path).toContain(path.join(f.home, 'runtime'));
  });
  it('keeps a working unauthenticated installation instead of switching identities', async () => {
    const f = await setup(); const executable = await f.install('first', 'codex', 'codex 1.0'); await f.install('second', 'codex', 'codex 2.0');
    f.env.PATH = [path.join(f.home, 'first'), path.join(f.home, 'second')].join(path.delimiter);
    expect(await new CodexProvider(f.resolver, f.runner).status()).toMatchObject({ executablePath: executable, authStatus: 'unauthenticated', version: 'codex 1.0' });
  });
  it.skipIf(process.platform !== 'win32')('prefers a CMD in an earlier directory to an EXE in a later one', async () => {
    const f = await setup(); const first = await f.install('first', 'opencode'); await mkdir(path.join(f.home, 'second'));
    await copyFile(process.execPath, path.join(f.home, 'second', 'opencode.exe'));
    f.env.PATH = [path.join(f.home, 'first'), path.join(f.home, 'second')].join(';');
    expect((await f.resolver.resolveAll('opencode'))[0]).toBe(first);
  });
});
