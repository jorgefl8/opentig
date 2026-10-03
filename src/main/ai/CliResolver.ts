import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AiHarnessId, Preferences } from '../../shared/contracts';
import { CliEnvironment, pathDirectories, type Environment, type EnvironmentSnapshot } from './CliEnvironment';

export type CliName = AiHarnessId | 'gh';
export type CliSource = 'configured' | 'process-path' | 'user-path' | 'known-location';
export interface CliCandidate {
  executable: string;
  alias: string;
  source: CliSource;
  env: Environment;
  problem?: 'not-found' | 'not-executable';
  warning?: string;
}
const ALIASES: Record<CliName, readonly string[]> = {
  codex: ['codex'], claude: ['claude'], opencode: ['opencode', 'opencode2'], grok: ['grok'], gh: ['gh'],
};
type DiscoveryPreferences = Pick<Preferences, 'aiExecutablePaths' | 'aiShellEnvironment'>;

export class CliResolver {
  private cache = new Map<string, { at: number; candidates: CliCandidate[] }>();
  private settingsKey = '';
  private generation = 0;
  constructor(readonly environment = new CliEnvironment(), private readonly preferences: () => DiscoveryPreferences = () => ({ aiExecutablePaths: {}, aiShellEnvironment: true })) {}

  invalidate(): void { this.generation++; this.cache.clear(); this.environment.invalidate(); }

  async resolve(name: CliName, forceRefresh = false): Promise<string | null> {
    return (await this.resolveAll(name, forceRefresh))[0] ?? null;
  }

  async resolveAll(name: CliName, forceRefresh = false): Promise<string[]> {
    return (await this.discover(name, forceRefresh)).filter((item) => !item.problem).map((item) => item.executable);
  }

  async discover(name: CliName, forceRefresh = false, expanded = false): Promise<CliCandidate[]> {
    if (!Object.hasOwn(ALIASES, name)) return [];
    const preferences = this.preferences();
    const settingsKey = JSON.stringify(preferences);
    if (settingsKey !== this.settingsKey) { this.settingsKey = settingsKey; this.invalidate(); }
    const refreshEnvironment = preferences.aiShellEnvironment && (expanded || forceRefresh);
    const key = `${name}:${refreshEnvironment}`;
    if (forceRefresh) { this.generation++; this.cache.delete(`${name}:false`); this.cache.delete(`${name}:true`); }
    const generation = this.generation;
    const cached = this.cache.get(key);
    if (!forceRefresh && cached && Date.now() - cached.at < 30_000) {
      if ((await Promise.all(cached.candidates.map((item) => this.problem(item.executable)))).every((problem, index) => problem === cached.candidates[index]?.problem)) {
        return structuredClone(cached.candidates);
      }
    }
    const snapshot = await this.environment.get(refreshEnvironment, forceRefresh);
    const host = this.environment.host;
    const p = host.platform === 'win32' ? path.win32 : path.posix;
    const known = knownCliDirectories(name, host.home, host.platform, snapshot.env);
    // Include other provider/manager directories for wrapper dependencies, but
    // preserve the active Unix shell's runtime selection without mutating process.env.
    const allKnown = [...new Set(Object.keys(ALIASES).flatMap((id) => knownCliDirectories(id as CliName, host.home, host.platform, snapshot.env)))];
    const runtimePath = host.platform === 'win32' ? [...snapshot.inheritedPath, ...snapshot.refreshedPath] : [...snapshot.refreshedPath, ...snapshot.inheritedPath];
    const env: Environment = { ...snapshot.env, PATH: pathDirectories([...runtimePath, ...allKnown].join(p.delimiter), host.platform).join(p.delimiter) };
    if (host.env.XDG_DATA_HOME === undefined) delete env.XDG_DATA_HOME;
    else env.XDG_DATA_HOME = host.env.XDG_DATA_HOME;
    const configured = name === 'gh' ? undefined : preferences.aiExecutablePaths[name];
    const candidates: CliCandidate[] = [];
    const seen = new Set<string>();
    const add = async (executable: string, alias: string, source: CliSource) => {
      const problem = await this.problem(executable);
      if (problem === 'not-found' && source !== 'configured') return;
      const canonical = await realpath(executable).catch(() => executable);
      const identity = host.platform === 'win32' ? canonical.toLowerCase() : canonical;
      if (seen.has(identity)) return;
      seen.add(identity);
      candidates.push({ executable, alias, source, env, ...(problem ? { problem } : {}), ...(snapshot.warning ? { warning: snapshot.warning } : {}) });
    };
    if (configured) {
      await add(configured, p.basename(configured), 'configured');
    } else {
      for (const [directories, source] of [[snapshot.inheritedPath, 'process-path'], [snapshot.refreshedPath, 'user-path'], [known, 'known-location']] as const) {
        for (const directory of directories) {
          for (const alias of ALIASES[name]) {
            for (const extension of executableExtensions(host.platform, snapshot.env)) await add(p.join(directory, `${alias}${extension}`), alias, source);
          }
        }
      }
    }
    if (generation === this.generation) this.cache.set(key, { at: Date.now(), candidates });
    return structuredClone(candidates);
  }

  async warning(): Promise<string | undefined> {
    if (!this.preferences().aiShellEnvironment) return undefined;
    return (await this.environment.get(true)).warning;
  }

  private async problem(executable: string): Promise<CliCandidate['problem']> {
    try {
      if (!(await stat(executable)).isFile()) return 'not-executable';
      if (this.environment.host.platform === 'win32') {
        if (!['.exe', '.com', '.cmd', '.bat'].includes(path.win32.extname(executable).toLowerCase())) return 'not-executable';
      } else await access(executable, constants.X_OK);
      return undefined;
    } catch (error) { return (error as NodeJS.ErrnoException).code === 'EACCES' ? 'not-executable' : 'not-found'; }
  }
}

export function executableExtensions(platform: NodeJS.Platform, env: Environment): string[] {
  if (platform !== 'win32') return [''];
  const value = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATHEXT')?.[1] ?? '.COM;.EXE;.BAT;.CMD';
  return [...new Set(value.split(';').map((item) => item.toLowerCase()).filter((item) => ['.exe', '.com', '.cmd', '.bat'].includes(item)))];
}

/** Public launchers only: never select an arbitrary internal Node/CLI version. */
export function knownCliDirectories(name: CliName, home: string, platform: NodeJS.Platform, env: EnvironmentSnapshot['env']): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs: Array<string | undefined> = [p.join(home, '.local', 'bin')];
  if (name === 'opencode') dirs.push(p.join(home, '.opencode', 'bin'));
  if (name === 'grok') dirs.push(env.GROK_BIN_DIR, p.join(home, '.grok', 'bin'));
  if (name === 'codex') dirs.push(env.CODEX_INSTALL_DIR);
  dirs.push(env.PNPM_HOME, env.NVM_BIN, p.join(env.BUN_INSTALL || p.join(home, '.bun'), 'bin'));
  if (env.FNM_MULTISHELL_PATH) dirs.push(platform === 'win32' ? env.FNM_MULTISHELL_PATH : p.join(env.FNM_MULTISHELL_PATH, 'bin'));
  const prefix = env.npm_config_prefix || env.NPM_CONFIG_PREFIX;
  if (prefix) dirs.push(platform === 'win32' ? prefix : p.join(prefix, 'bin'));
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(p.join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) {
      dirs.push(p.join(env.LOCALAPPDATA, 'Volta', 'bin'), p.join(env.LOCALAPPDATA, 'pnpm'), p.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
      if (name === 'codex') dirs.push(p.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'));
    }
    if (env.VOLTA_HOME) dirs.push(p.join(env.VOLTA_HOME, 'bin'));
  } else {
    dirs.push(p.join(env.VOLTA_HOME || p.join(home, '.volta'), 'bin'), p.join(home, '.npm-global', 'bin'), p.join(home, '.yarn', 'bin'));
    dirs.push(p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'pnpm'));
    dirs.push('/usr/local/bin', '/usr/bin', '/bin', platform === 'darwin' ? '/opt/homebrew/bin' : '/home/linuxbrew/.linuxbrew/bin');
  }
  return [...new Set(dirs.filter((item): item is string => !!item && p.isAbsolute(item)))];
}
