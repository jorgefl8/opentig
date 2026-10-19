import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cliCommandDirectory, installCliCommand, removeCliCommand } from './cli-command';

const execute = promisify(execFile);
let root: string, home: string, userHome: string;
const directory = () => path.join(home, 'bin');
const environment = (shell: string, extra: NodeJS.ProcessEnv = {}) => ({ HOME: userHome, SHELL: `/bin/${shell}`, PATH: '/usr/bin:/bin', ...extra });
const install = (shell: string, extra: Partial<Parameters<typeof installCliCommand>[0]> = {}) =>
  installCliCommand({ home, node: process.execPath, environment: environment(shell), platform: 'darwin', modifyPath: true, ...extra });

async function managedVersion(version: string, layout: 'flat' | 'npm') {
  const base = path.join(home, 'service', `app-${version}`);
  const entry = path.join(layout === 'npm' ? path.join(base, 'node_modules/@opentig/cli') : base, 'dist/bin.mjs');
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, `process.stdout.write(JSON.stringify({ version: ${JSON.stringify(version)}, entry: process.argv[1], args: process.argv.slice(2), home: process.env.OPENTIG_HOME }));`);
  await writeFile(path.join(home, 'service/installation.json'), JSON.stringify({ schema: 1, version, layout, host: '127.0.0.1', port: 6767, node: process.execPath }));
  return entry;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'OpenTig command-'));
  home = path.join(root, "O'Brien home & spaces", '.opentig');
  userHome = path.join(root, 'user');
  await mkdir(home, { recursive: true });
  await mkdir(userHome);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe.skipIf(process.platform === 'win32')('managed opentig command', () => {
  it('runs the active managed CLI with its arguments and follows managed updates', async () => {
    await install('zsh');
    const run = async (env: NodeJS.ProcessEnv = {}) => JSON.parse((await execute(path.join(directory(), 'opentig'), ['pair', '--flag', 'two words'], { env: { PATH: process.env.PATH, ...env } })).stdout);
    const flat = await managedVersion('1.2.3', 'flat');
    expect(await run()).toEqual({ version: '1.2.3', entry: flat, args: ['pair', '--flag', 'two words'], home });
    // Browser updates switch installation.json to an npm-layout runtime without rewriting the command.
    const updated = await managedVersion('1.2.4', 'npm');
    expect(await run({ OPENTIG_HOME: '/explicit' })).toEqual({ version: '1.2.4', entry: updated, args: ['pair', '--flag', 'two words'], home: '/explicit' });
  });

  it('explains how to recover when the managed runtime is missing', async () => {
    await install('zsh');
    const failure = await execute(path.join(directory(), 'opentig'), ['--version']).catch((error: { code: number; stderr: string }) => error);
    expect(failure).toMatchObject({ code: 1, stderr: expect.stringContaining('npx -y @opentig/cli@latest service install') });
    await managedVersion('1.2.3', 'flat');
    await rm(path.join(home, 'service/app-1.2.3'), { recursive: true });
    expect(await execute(path.join(directory(), 'opentig'), []).catch((error: { stderr: string }) => error.stderr)).toContain('Managed CLI 1.2.3 is missing');
  });

  it('adds one removable PATH block to zsh that a shell can source', async () => {
    const zdotdir = path.join(userHome, 'zsh config');
    await mkdir(zdotdir);
    await writeFile(path.join(zdotdir, '.zshrc'), 'alias ll="ls -l"');
    const options = { environment: environment('zsh', { ZDOTDIR: zdotdir }) };
    expect((await install('zsh', options)).at(-1)).toContain(`Added ${directory()} to PATH in ${path.join(zdotdir, '.zshrc')}`);
    await install('zsh', options);
    const profile = await readFile(path.join(zdotdir, '.zshrc'), 'utf8');
    expect(profile.match(/>>> opentig >>>/g)).toHaveLength(1);
    expect(profile.startsWith('alias ll="ls -l"\n\n# >>> opentig >>>')).toBe(true);
    const { stdout } = await execute('/bin/sh', ['-c', `. "$1"; command -v opentig`, 'sh', path.join(zdotdir, '.zshrc')], { env: { PATH: '/usr/bin:/bin' } });
    expect(stdout.trim()).toBe(path.join(directory(), 'opentig'));
    expect(await removeCliCommand(home, options.environment, 'darwin')).toEqual([`Removed the opentig PATH entry from ${path.join(zdotdir, '.zshrc')}.`]);
    expect(await readFile(path.join(zdotdir, '.zshrc'), 'utf8')).toBe('alias ll="ls -l"\n');
    await expect(readFile(path.join(directory(), 'opentig'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('chooses the bash profile read by each platform and keeps dotfile symlinks', async () => {
    const dotfiles = path.join(root, 'dotfiles/bashrc');
    await mkdir(path.dirname(dotfiles));
    await writeFile(dotfiles, '');
    await symlink(dotfiles, path.join(userHome, '.bashrc'));
    await install('bash', { platform: 'linux' });
    expect(await readlink(path.join(userHome, '.bashrc'))).toBe(dotfiles);
    expect(await readFile(dotfiles, 'utf8')).toContain('export PATH=');
    await install('bash');
    expect(await readFile(path.join(userHome, '.bash_profile'), 'utf8')).toContain('# >>> opentig >>>');
  });

  it('writes and removes a dedicated fish configuration file', async () => {
    await install('fish');
    const file = path.join(userHome, '.config/fish/conf.d/opentig.fish');
    expect(await readFile(file, 'utf8')).toContain("fish_add_path --global --move --path '");
    await removeCliCommand(home, environment('fish'), 'darwin');
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves profiles untouched when PATH already has the command, when opted out, or for unknown shells', async () => {
    expect(await installCliCommand({ home, node: process.execPath, environment: { ...environment('zsh'), PATH: `/bin:${directory()}/` }, platform: 'darwin', modifyPath: true }))
      .toEqual([`Installed the opentig command in ${directory()}.`]);
    expect((await install('zsh', { modifyPath: false })).at(-1)).toContain('Add it to PATH in your shell profile');
    expect((await install('tcsh')).at(-1)).toContain('Add it to PATH in your shell profile');
    await expect(readFile(path.join(userHome, '.zshrc'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes only the PATH entry that belongs to this home', async () => {
    await install('zsh');
    const other = path.join(root, 'other/.opentig');
    expect(await removeCliCommand(other, environment('zsh'), 'darwin')).toEqual([]);
    expect(await readFile(path.join(userHome, '.zshrc'), 'utf8')).toContain('# >>> opentig >>>');
  });
});

describe('managed opentig command on Windows', () => {
  const userPath = () => {
    const entries = new Set<string>();
    return { entries, add: async (entry: string) => entries.size !== entries.add(entry).size, remove: async (entry: string) => entries.delete(entry) };
  };
  const windowsEnvironment = { LOCALAPPDATA: 'C:\\Users\\José\\AppData\\Local', userprofile: 'C:\\Users\\José', ProgramFiles: 'C:\\Program Files', Path: 'C:\\Windows' };
  const installWindows = (node: string, extra: Partial<Parameters<typeof installCliCommand>[0]> = {}) =>
    installCliCommand({ home, node, environment: windowsEnvironment, platform: 'win32', modifyPath: true, ...extra });

  it('writes an ASCII command script that expands user-specific paths at run time', async () => {
    await installWindows('C:\\Users\\José\\AppData\\Local\\fnm 100%\\node.exe', { userPath: userPath() });
    const script = await readFile(path.join(directory(), 'opentig.cmd'), 'utf8');
    expect(script).toMatch(/^[\x20-\x7e\r\n]*$/);
    expect(script).toContain('if not exist "%LOCALAPPDATA%\\fnm 100%%\\node.exe" goto missing\r\n');
    expect(script).toContain('"%LOCALAPPDATA%\\fnm 100%%\\node.exe" "%~dp0opentig-launcher.mjs" %*\r\n');
    await installWindows('C:\\Program Files\\nodejs\\node.exe', { userPath: userPath() });
    expect(await readFile(path.join(directory(), 'opentig.cmd'), 'utf8')).toContain('"%ProgramFiles%\\nodejs\\node.exe"');
    await expect(installWindows('D:\\Herramientas\\Señal\\node.exe')).rejects.toMatchObject({ code: 'COMMAND_INSTALL_FAILED' });
  });

  it('adds the command to the user Path once and removes only that entry', async () => {
    const fake = userPath();
    expect((await installWindows('C:\\Program Files\\nodejs\\node.exe', { userPath: fake })).at(-1)).toBe('Added it to your user Path. Open a new terminal to use: opentig');
    expect((await installWindows('C:\\Program Files\\nodejs\\node.exe', { userPath: fake })).at(-1)).toContain('already in your user Path');
    expect([...fake.entries]).toEqual([directory()]);
    expect(await removeCliCommand(home, windowsEnvironment, 'win32', fake)).toEqual(['Removed the opentig command from your user Path.']);
    expect(fake.entries.size).toBe(0);
    await expect(readFile(path.join(directory(), 'opentig.cmd'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves the user Path unchanged when opted out or already present in this session', async () => {
    const fake = userPath();
    expect((await installWindows('C:\\Program Files\\nodejs\\node.exe', { userPath: fake, modifyPath: false })).at(-1)).toContain('Environment Variables');
    const environment = { ...windowsEnvironment, Path: `C:\\Windows;${directory().toUpperCase()}\\` };
    expect(await installCliCommand({ home, node: 'C:\\Program Files\\nodejs\\node.exe', environment, platform: 'win32', modifyPath: true, userPath: fake })).toHaveLength(1);
    expect(fake.entries.size).toBe(0);
  });

  it.skipIf(process.platform !== 'win32')('runs the managed CLI from a Unicode home with cmd metacharacters', async () => {
    home = path.join(root, 'José 100% & (x86)', '.opentig');
    await mkdir(home, { recursive: true });
    await installCliCommand({ home, node: process.execPath, environment: process.env, modifyPath: false });
    const flat = await managedVersion('1.2.3', 'flat');
    const command = path.join(directory(), 'opentig.cmd');
    const { stdout } = await execute(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${command}" pair --flag "two words""`], { windowsVerbatimArguments: true, env: { ...process.env, OPENTIG_HOME: '' } });
    expect(JSON.parse(stdout)).toEqual({ version: '1.2.3', entry: flat, args: ['pair', '--flag', 'two words'], home });
  });

  // Opt-in: edits the real user Path with a unique temporary entry and restores it.
  it.skipIf(process.platform !== 'win32' || process.env.OPENTIG_SERVICE_INTEGRATION !== '1')('updates the registry user Path without expanding existing entries', async () => {
    const query = () => execute('reg', ['query', 'HKCU\\Environment', '/v', 'Path']).then(result => result.stdout, () => null);
    const before = await query();
    const commandHome = path.join(root, 'Path test 100%');
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
    try {
      expect((await installCliCommand({ home: commandHome, node: process.execPath, environment, modifyPath: true })).at(-1)).toContain('Added it to your user Path');
      expect(await query()).toContain(cliCommandDirectory(commandHome));
      expect(await removeCliCommand(commandHome, environment, 'win32')).toHaveLength(1);
      // Byte-identical output also shows that REG_EXPAND_SZ and %VARIABLE% entries were preserved.
      if (before !== null) expect(await query()).toBe(before);
      else expect(await query() ?? '').not.toContain(cliCommandDirectory(commandHome));
    } finally { await removeCliCommand(commandHome, environment, 'win32').catch(() => undefined); }
  }, 60_000);
});
