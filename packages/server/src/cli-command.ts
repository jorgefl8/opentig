import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError, errorCode } from './cli-errors';
import { encodedPowerShell, psQuote } from './service-definitions';
import { execute } from './service-installation';

const BLOCK_START = '# >>> opentig >>>';
const BLOCK_END = '# <<< opentig <<<';
const MANAGED_NOTE = '# Added by "opentig service install"; removed by "opentig service uninstall".';
const REINSTALL = 'Reinstall it with: npx -y @opentig/cli@latest service install';
const LAUNCHER = 'opentig-launcher.mjs';

/** The Windows user Path lives in the registry rather than a shell profile. */
export interface UserPath {
  add(directory: string): Promise<boolean>;
  remove(directory: string): Promise<boolean>;
}

export interface CliCommandOptions {
  home: string;
  node: string;
  environment: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  modifyPath: boolean;
  userPath?: UserPath;
}

interface ShellProfile { file: string; fish: boolean }

export const cliCommandDirectory = (home: string) => path.join(home, 'bin');

/**
 * Installs a stable `opentig` command for the managed service runtime, so npx
 * installations need neither a global npm prefix nor administrator rights.
 */
export async function installCliCommand(options: CliCommandOptions): Promise<string[]> {
  const windows = (options.platform ?? process.platform) === 'win32';
  const directory = cliCommandDirectory(options.home);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, LAUNCHER), renderLauncher(options.home));
    const command = path.join(directory, windows ? 'opentig.cmd' : 'opentig');
    await writeFile(command, windows ? renderCmdShim(options.node, options.environment) : renderShim(options.node, options.home, directory));
    if (!windows) await chmod(command, 0o755);
  } catch (cause) {
    throw new CliError('COMMAND_INSTALL_FAILED', `The service is running, but the opentig command could not be created in ${directory}.`, [
      cause instanceof CliError ? cause.message : `Check permissions for ${directory}, then run service install again.`,
    ], { cause });
  }
  const messages = [`Installed the opentig command in ${directory}.`];
  if (onPath(options.environment, directory, windows)) return messages;
  if (windows) {
    const manual = `Add ${directory} to your user Path in Settings → System → About → Advanced system settings → Environment Variables.`;
    if (!options.modifyPath) return [...messages, manual];
    let added: boolean;
    try { added = await (options.userPath ?? windowsUserPath).add(directory); }
    catch (cause) { throw new CliError('PATH_UPDATE_FAILED', 'The opentig command was installed, but your user Path could not be updated.', [manual], { cause }); }
    return [...messages, `${added ? 'Added it to' : 'It is already in'} your user Path. Open a new terminal to use: opentig`];
  }
  const profile = options.modifyPath ? shellProfile(options.environment, options.platform ?? process.platform) : null;
  if (!profile) {
    messages.push(`Add it to PATH in your shell profile: export PATH=${posixQuote(directory)}:"$PATH"`);
    return messages;
  }
  try { await writeProfile(profile, directory); }
  catch (cause) {
    throw new CliError('PATH_UPDATE_FAILED', `The opentig command was installed, but ${profile.file} could not be updated.`, [
      `Add it to PATH manually: export PATH=${posixQuote(directory)}:"$PATH"`,
    ], { cause });
  }
  messages.push(`Added ${directory} to PATH in ${profile.file}. Open a new terminal to use: opentig`);
  return messages;
}

/** Removes the command and only the PATH entries that point to this home. */
export async function removeCliCommand(home: string, environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, userPath: UserPath = windowsUserPath, later = removeAfterParentExits): Promise<string[]> {
  const directory = cliCommandDirectory(home);
  const script = path.join(directory, 'opentig.cmd');
  // cmd.exe reads opentig.cmd line by line while it runs: deleting the script
  // that started this process makes it print "The batch file cannot be found."
  // and exit 1 once Node returns, so that file goes after its cmd.exe.
  const running = platform === 'win32' && sameFile(variable(environment, 'OPENTIG_COMMAND_SCRIPT'), script);
  for (const name of ['opentig', 'opentig.cmd', LAUNCHER]) if (!(running && name === 'opentig.cmd')) await rm(path.join(directory, name), { force: true });
  if (running) later(script, process.ppid);
  else await rm(directory).catch(() => undefined);
  if (platform === 'win32') return await userPath.remove(directory) ? ['Removed the opentig command from your user Path.'] : [];
  const updated: string[] = [];
  for (const profile of shellProfiles(environment, platform)) {
    if (await removeProfileEntry(profile, directory)) updated.push(profile.file);
  }
  return updated.map(file => `Removed the opentig PATH entry from ${file}.`);
}

/**
 * Deletes a file, and then its folder if that is empty, from a detached
 * process once the parent process has exited and two more seconds have
 * passed, or after a minute when the parent is an interactive window. The
 * file is deleted only if it is still the one seen now: a file written
 * since, as by installing again in the meantime, is another install's.
 */
export function removeAfterParentExits(file: string, parent: number): void {
  let seen: string;
  try { seen = fileVersion(statSync(file)); } catch { return; }
  const script = `const fs = require('node:fs'); const path = require('node:path');
const [file, parent, seen] = process.argv.slice(1); const started = Date.now();
const alive = () => { try { process.kill(Number(parent), 0); return true; } catch { return false; } };
const version = () => { try { const stats = fs.statSync(file); return stats.mtimeMs + ':' + stats.size + ':' + stats.ino; } catch { return null; } };
const remove = () => { if (version() !== seen) return; fs.rmSync(file, { force: true }); try { fs.rmdirSync(path.dirname(file)); } catch {} };
const wait = () => alive() && Date.now() - started < 60000 ? setTimeout(wait, 200) : setTimeout(remove, 2000);
wait();`;
  spawn(process.execPath, ['-e', script, file, String(parent), seen], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** What tells one writing of a file from the next: when it was written, its size and the file it is on disk. */
function fileVersion(stats: { mtimeMs: number; size: number; ino: number }): string {
  return `${stats.mtimeMs}:${stats.size}:${stats.ino}`;
}

function sameFile(candidate: string | undefined, file: string): boolean {
  if (!candidate) return false;
  // The script's path can reach Node in its short 8.3 form.
  try { return realpathSync.native(candidate).toLowerCase() === realpathSync.native(file).toLowerCase(); }
  catch { return false; }
}

function shellProfile(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): ShellProfile | null {
  const index = ['zsh', 'bash', 'fish'].indexOf(path.basename(environment.SHELL ?? ''));
  return index < 0 ? null : shellProfiles(environment, platform)[index] ?? null;
}

function shellProfiles(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): ShellProfile[] {
  const userHome = absolute(environment.HOME);
  if (!userHome) return [];
  const config = absolute(environment.XDG_CONFIG_HOME) ?? path.join(userHome, '.config');
  return [
    { file: path.join(absolute(environment.ZDOTDIR) ?? userHome, '.zshrc'), fish: false },
    // macOS Terminal starts bash as a login shell; Linux terminals read .bashrc.
    { file: path.join(userHome, platform === 'darwin' ? '.bash_profile' : '.bashrc'), fish: false },
    { file: path.join(config, 'fish/conf.d/opentig.fish'), fish: true },
  ];
}

async function writeProfile(profile: ShellProfile, directory: string): Promise<void> {
  if (profile.fish) {
    await mkdir(path.dirname(profile.file), { recursive: true });
    await writeFile(profile.file, `${MANAGED_NOTE}\nfish_add_path --global --move --path ${fishQuote(directory)}\n`);
    return;
  }
  const block = `${BLOCK_START}\n${MANAGED_NOTE}\nexport PATH=${posixQuote(directory)}:"$PATH"\n${BLOCK_END}\n`;
  const current = await readProfile(profile.file);
  const existing = findBlock(current);
  // Writing in place keeps dotfile-manager symlinks intact.
  await writeFile(profile.file, existing
    ? current.slice(0, existing.start) + block + current.slice(existing.end)
    : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}${block}`);
}

async function removeProfileEntry(profile: ShellProfile, directory: string): Promise<boolean> {
  const current = await readProfile(profile.file);
  if (profile.fish) {
    if (!current.includes(fishQuote(directory))) return false;
    await rm(profile.file, { force: true });
    return true;
  }
  const existing = findBlock(current);
  if (!existing || !current.slice(existing.start, existing.end).includes(posixQuote(directory))) return false;
  const before = current.slice(0, existing.start).replace(/\n\n$/, '\n');
  await writeFile(profile.file, before + current.slice(existing.end));
  return true;
}

function findBlock(text: string): { start: number; end: number } | null {
  const start = text.indexOf(`${BLOCK_START}\n`);
  if (start < 0) return null;
  const close = text.indexOf(BLOCK_END, start);
  if (close < 0) return null;
  const end = close + BLOCK_END.length;
  return { start, end: text[end] === '\n' ? end + 1 : end };
}

async function readProfile(file: string): Promise<string> {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (errorCode(error) === 'ENOENT') return ''; throw error; }
}

function renderShim(node: string, home: string, directory: string): string {
  return `#!/bin/sh
# Managed by OpenTig; regenerated by "opentig service install".
node=${posixQuote(node)}
if [ ! -x "$node" ]; then
  echo "OpenTig: Node.js was not found at $node. ${REINSTALL}" >&2
  exit 127
fi
if [ -z "\${OPENTIG_HOME:-}" ]; then OPENTIG_HOME=${posixQuote(home)}; export OPENTIG_HOME; fi
exec "$node" ${posixQuote(path.join(directory, LAUNCHER))} "$@"
`;
}

/**
 * cmd.exe decodes scripts with the OEM code page, so the script embeds no
 * user-specific text: the home comes from its own location and Node from
 * environment variables that expand to Unicode at run time.
 *
 * OPENTIG_COMMAND_SCRIPT tells "service uninstall" which script cmd.exe is
 * running, so that it removes that file only after cmd.exe has finished.
 */
function renderCmdShim(node: string, environment: NodeJS.ProcessEnv): string {
  const executable = cmdPath(node, environment);
  return `@echo off\r
rem Managed by OpenTig; regenerated by "opentig service install".\r
setlocal\r
set "OPENTIG_COMMAND_SCRIPT=%~f0"\r
if not defined OPENTIG_HOME for %%I in ("%~dp0..") do set "OPENTIG_HOME=%%~fI"\r
if not exist "${executable}" goto missing\r
"${executable}" "%~dp0${LAUNCHER}" %*\r
exit /b\r
:missing\r
echo OpenTig: Node.js was not found at "${executable}". ${REINSTALL} 1>&2\r
exit /b 127\r
`;
}

function cmdPath(file: string, environment: NodeJS.ProcessEnv): string {
  const prefixes = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'ProgramFiles', 'ProgramFiles(x86)']
    .map(name => ({ name, value: variable(environment, name)?.replace(/\\+$/, '') }))
    .filter((entry): entry is { name: string; value: string } => !!entry.value && path.win32.isAbsolute(entry.value))
    .sort((a, b) => b.value.length - a.value.length);
  const prefix = prefixes.find(entry => file.toLowerCase().startsWith(`${entry.value.toLowerCase()}\\`));
  const rendered = prefix ? `%${prefix.name}%${file.slice(prefix.value.length).replaceAll('%', '%%')}` : file.replaceAll('%', '%%');
  if (/[^\x20-\x7e]/.test(rendered)) throw new CliError('COMMAND_PATH_UNSUPPORTED', `Node.js is installed in a path a Windows command script cannot represent: ${file}`);
  return rendered;
}

const windowsUserPath: UserPath = {
  add: directory => updateWindowsUserPath(directory, true),
  remove: directory => updateWindowsUserPath(directory, false),
};

/**
 * Edits the raw registry value: setx truncates long values and .NET's
 * SetEnvironmentVariable expands %VARIABLE% entries into fixed paths.
 */
async function updateWindowsUserPath(directory: string, add: boolean): Promise<boolean> {
  const script = `$directory = ${psQuote(directory)}
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
  if ($key.GetValueNames() -contains 'Path') { $kind = $key.GetValueKind('Path') }
  $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  # Keep empty segments so removal restores the value byte for byte, including a trailing ';'.
  $entries = @($raw -split ';')
  $same = { param($entry) $entry -and [Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\\') -ieq $directory.TrimEnd('\\') }
  $present = @($entries | Where-Object { & $same $_ }).Count -gt 0
  if (${add ? '$present' : '-not $present'}) { 'unchanged'; return }
  $next = ${add
    ? "if (-not $raw) { $directory } elseif ($raw.EndsWith(';')) { $raw + $directory + ';' } else { $raw + ';' + $directory }"
    : "@($entries | Where-Object { -not (& $same $_) }) -join ';'"}
  $key.SetValue('Path', $next, $kind)
} finally { $key.Close() }
Add-Type -Namespace OpenTigNative -Name User32 -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
$result = [UIntPtr]::Zero
# Tell Explorer and new terminals that the user environment changed.
[void][OpenTigNative.User32]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
'changed'`;
  const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const { stdout } = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(`$ErrorActionPreference = 'Stop'; ${script}`)], { timeout: 30_000, windowsHide: true });
  return stdout.trim() === 'changed';
}

/** Version-independent: managed updates switch versions through installation.json. */
function renderLauncher(home: string): string {
  return `// Managed by OpenTig; regenerated by "opentig service install".
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const home = ${JSON.stringify(home)};
const fail = (message) => { process.stderr.write(\`OpenTig: \${message}\\n${REINSTALL}\\n\`); process.exit(1); };
let installation;
try { installation = JSON.parse(await readFile(path.join(home, 'service/installation.json'), 'utf8')); }
catch { fail(\`The managed OpenTig CLI is not installed in \${home}.\`); }
if (!/^\\d+\\.\\d+\\.\\d+$/.test(String(installation?.version)) || !['flat', 'npm'].includes(installation.layout)) fail('Invalid managed service installation metadata.');
const base = path.join(home, 'service', \`app-\${installation.version}\`);
const entry = path.join(installation.layout === 'npm' ? path.join(base, 'node_modules/@opentig/cli') : base, 'dist/bin.mjs');
try { await access(entry); } catch { fail(\`Managed CLI \${installation.version} is missing from \${base}.\`); }
process.argv[1] = entry;
await import(pathToFileURL(entry).href);
`;
}

const absolute = (value: string | undefined) => value && path.isAbsolute(value) ? value : null;
// Windows environment names are case-insensitive, even when a plain object is supplied.
const variable = (environment: NodeJS.ProcessEnv, name: string) => Object.entries(environment).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
function onPath(environment: NodeJS.ProcessEnv, directory: string, windows: boolean): boolean {
  const normalize = (entry: string) => windows ? entry.replace(/\\+$/, '').toLowerCase() : entry.replace(/\/+$/, '');
  return ((windows ? variable(environment, 'PATH') : environment.PATH) ?? '').split(windows ? ';' : ':').map(normalize).includes(normalize(directory));
}
const posixQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const fishQuote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
