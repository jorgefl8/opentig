import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

// Only location/manager variables are imported. Never import credentials or HOME
// from shell startup files. The backend remains the owner of provider identity.
export const LOCATION_KEYS = ['PATH', 'CODEX_INSTALL_DIR', 'GROK_BIN_DIR', 'BUN_INSTALL', 'PNPM_HOME', 'VOLTA_HOME', 'NPM_CONFIG_PREFIX', 'npm_config_prefix', 'NVM_BIN', 'FNM_MULTISHELL_PATH', 'ASDF_DATA_DIR', 'MISE_DATA_DIR', 'XDG_DATA_HOME', 'APPDATA', 'LOCALAPPDATA'] as const;
export type Environment = Record<string, string>;
export interface CliHost {
  platform: NodeJS.Platform;
  home: string;
  env: Environment;
  shell?: string | undefined;
}
export interface EnvironmentSnapshot {
  env: Environment;
  inheritedPath: string[];
  refreshedPath: string[];
  warning?: string;
}
export type EnvironmentReader = (host: CliHost) => Promise<Environment>;

export function currentCliHost(): CliHost {
  let shell: string | undefined;
  try { shell = os.userInfo().shell ?? undefined; } catch { /* Containers may have no passwd entry. */ }
  return { platform: process.platform, home: os.homedir(), env: cleanEnvironment(process.env), shell: process.env.SHELL || shell };
}

export function cleanEnvironment(input: NodeJS.ProcessEnv, platform = process.platform): Environment {
  const result: Environment = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) result[platform === 'win32' && key.toUpperCase() === 'PATH' ? 'PATH' : key] = value;
  }
  return result;
}

export function pathDirectories(value: string | undefined, platform: NodeJS.Platform): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const seen = new Set<string>();
  return (value ?? '').split(platform === 'win32' ? ';' : ':').map((item) => item.replace(/^"(.*)"$/, '$1')).filter((item) => {
    if (!p.isAbsolute(item)) return false; // Never search the repository through empty/relative PATH entries.
    const key = platform === 'win32' ? p.normalize(item).toLowerCase() : p.normalize(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class CliEnvironment {
  private cached: { at: number; value: EnvironmentSnapshot } | undefined;
  private pending: Promise<EnvironmentSnapshot> | undefined;
  private generation = 0;
  constructor(readonly host = currentCliHost(), private readonly read: EnvironmentReader = readUserEnvironment) {}

  invalidate(): void { this.generation++; this.cached = undefined; this.pending = undefined; }

  async get(force = false): Promise<EnvironmentSnapshot> {
    const env = cleanEnvironment(this.host.env, this.host.platform);
    const inheritedPath = pathDirectories(env.PATH, this.host.platform);
    if (this.pending) return this.pending;
    if (!force && this.cached && Date.now() - this.cached.at < 30_000) return this.cached.value;
    const generation = this.generation;
    const pending = (async () => {
      let locations: Environment = {};
      let warning: string | undefined;
      try { locations = await this.read(this.host); }
      catch { warning = 'Could not refresh the user environment. Using the inherited environment and known installation locations. Check your shell configuration or set an executable path.'; }
      const refreshedPath = pathDirectories(locations.PATH, this.host.platform);
      const value = { env: { ...env, ...locations }, inheritedPath, refreshedPath, ...(warning ? { warning } : {}) };
      if (generation === this.generation) this.cached = { at: Date.now(), value };
      return value;
    })();
    this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = undefined; }
  }
}

export async function readUserEnvironment(host: CliHost): Promise<Environment> {
  // Cold Windows PowerShell startup can exceed five seconds under load. Keep
  // the query bounded while giving its runtime time to initialize.
  const options = { cwd: host.home, env: host.env, extendEnv: false, input: '', timeout: host.platform === 'win32' ? 15_000 : 5_000, maxBuffer: 128 * 1024,
    cleanup: true, killDescendants: true, windowsHide: true, reject: false, stripFinalNewline: false } as const;
  if (host.platform === 'win32') {
    const root = host.env.SystemRoot || host.env.SYSTEMROOT;
    if (!root || !path.win32.isAbsolute(root)) throw new Error('SystemRoot unavailable');
    const shell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = '$ErrorActionPreference="Stop"; $r=@{}; foreach($scope in @("Machine","User")){ $r[$scope]=[Environment]::GetEnvironmentVariables($scope) }; ConvertTo-Json -InputObject $r -Compress';
    const result = await execa(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], options);
    if (result.timedOut) throw new Error('Environment query timed out');
    if (result.exitCode !== 0 || result.isMaxBuffer) throw new Error('Environment query failed');
    return windowsLocations(JSON.parse(result.stdout), host.env);
  }
  const shell = host.shell;
  if (!shell || !path.posix.isAbsolute(shell)) throw new Error('User shell unavailable');
  const kind = path.posix.basename(shell);
  if (!['bash', 'zsh', 'fish'].includes(kind)) throw new Error('Unsupported user shell');
  const started = Date.now();
  // Bash login files need not source .bashrc. Query both modes within one budget.
  const modes = kind === 'bash' ? ['-lic', '-ic'] : ['-lic'];
  let merged: Environment = {};
  let succeeded = false;
  for (const mode of modes) {
    const timeout = 5_000 - (Date.now() - started);
    if (timeout <= 0) break;
    const script = LOCATION_KEYS.map((key) => kind === 'fish'
      ? `printf '\\0OPENTIG_ENV_${key}\\0%s\\0' (string join ':' -- $${key})`
      : `printf '\\0OPENTIG_ENV_${key}\\0%s\\0' "$${key}"`).join('; ');
    const result = await execa(shell, [mode, script], { ...options, timeout });
    if (result.exitCode !== 0 || result.timedOut || result.isMaxBuffer) continue;
    const locations = parseShellLocations(result.stdout);
    if (!locations.PATH) continue;
    succeeded = true;
    // The interactive mode supplies .bashrc additions without discarding login PATH.
    merged = { ...merged, ...locations, PATH: [locations.PATH, merged.PATH].filter(Boolean).join(':') };
  }
  if (!succeeded) throw new Error('Shell environment query failed');
  return merged;
}

export function parseShellLocations(output: string): Environment {
  const locations: Environment = {};
  for (const key of LOCATION_KEYS) {
    const marker = `\0OPENTIG_ENV_${key}\0`;
    const start = output.lastIndexOf(marker);
    if (start < 0) continue;
    const end = output.indexOf('\0', start + marker.length);
    if (end < 0) continue;
    const value = output.slice(start + marker.length, end);
    if (value && !/[\r\n]/.test(value)) locations[key] = value;
  }
  return locations;
}

export function windowsLocations(raw: unknown, inherited: Environment): Environment {
  const data = raw as { Machine?: Environment; User?: Environment };
  if (!data || typeof data !== 'object' || !data.Machine || !data.User) throw new Error('Invalid environment response');
  const upper = (input: Environment) => Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.toUpperCase(), v]));
  const machine = upper(data.Machine), user = upper(data.User);
  const variables = { ...upper(inherited), ...machine, ...user };
  const expand = (input: string) => {
    let value = input;
    for (let i = 0; i < 10; i++) {
      const next = value.replace(/%([^%]+)%/g, (match, key: string) => variables[key.toUpperCase()] ?? match);
      if (next === value) break;
      value = next;
    }
    return value;
  };
  const result: Environment = {};
  for (const key of LOCATION_KEYS) if (key !== 'PATH' && variables[key.toUpperCase()]) result[key] = expand(variables[key.toUpperCase()]!);
  result.PATH = [machine.PATH, user.PATH].filter((value): value is string => !!value).map(expand).join(';');
  return result;
}
