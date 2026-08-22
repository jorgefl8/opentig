import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('runtime dependency boundary', () => {
  it('contains no Electron or native shortcut imports', async () => {
    const root = path.join(process.cwd(), 'src', 'main', 'runtime');
    const files = await typeScriptFiles(root);
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/from\s+['"](?:electron|uiohook-napi)['"]|require\(['"](?:electron|uiohook-napi)['"]\)/.test(source)) {
        offenders.push(path.relative(root, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function typeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
  }));
  return files.flat();
}
