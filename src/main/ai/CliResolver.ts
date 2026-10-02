import { access } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED = new Set(['codex', 'claude', 'opencode', 'gh']);
const ALIASES: Record<string, readonly string[]> = {
  codex: ['codex'],
  claude: ['claude'],
  // Current v2 uses opencode; older distributions also provide opencode2.
  opencode: ['opencode', 'opencode2'],
  gh: ['gh'],
};

export class CliResolver {
  private readonly cache = new Map<string, string[]>();

  async resolve(name: 'codex' | 'claude' | 'opencode' | 'gh', forceRefresh = false): Promise<string | null> {
    return (await this.resolveAll(name, forceRefresh))[0] ?? null;
  }

  async resolveAll(name: 'codex' | 'claude' | 'opencode' | 'gh', forceRefresh = false): Promise<string[]> {
    if (!ALLOWED.has(name)) return [];
    if (!forceRefresh && this.cache.has(name)) return [...this.cache.get(name)!];
    const resolved: string[] = [];
    for (const alias of ALIASES[name] ?? [name]) {
      const executable = await findOnPath(alias);
      if (executable && !resolved.includes(executable)) resolved.push(executable);
    }
    this.cache.set(name, resolved);
    return [...resolved];
  }
}

async function findOnPath(name: string): Promise<string | null> {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? ['.exe', '.cmd', '.bat']
    : [''];
  for (const extension of extensions) {
    for (const directory of directories) {
      const candidate = path.resolve(directory.replace(/^"|"$/g, ''), `${name}${extension}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Continue through PATH candidates.
      }
    }
  }
  return null;
}
