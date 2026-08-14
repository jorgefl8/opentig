import { access } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED = new Set(['codex', 'claude', 'opencode', 'gh']);

export class CliResolver {
  private readonly cache = new Map<string, string | null>();

  async resolve(name: 'codex' | 'claude' | 'opencode' | 'gh', forceRefresh = false): Promise<string | null> {
    if (!ALLOWED.has(name)) return null;
    if (!forceRefresh && this.cache.has(name)) return this.cache.get(name) ?? null;
    const resolved = await findOnPath(name);
    this.cache.set(name, resolved);
    return resolved;
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
