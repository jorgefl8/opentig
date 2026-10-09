import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clipboard } from 'electron';

export async function readClipboardFilePaths(systemClipboard: Pick<Clipboard, 'read' | 'readText'>): Promise<string[]> {
  const candidates: string[] = [];
  for (const item of await systemClipboard.read()) {
    if (!item.types.includes('text/uri-list')) continue;
    try {
      const payload = await item.getType('text/uri-list');
      candidates.push(...parseClipboardPathText(await payload.text()));
    } catch {
      // A clipboard owner can stop providing a format after it is advertised.
      // Keep examining other items and the plain-text fallback.
    }
  }
  candidates.push(...parseClipboardPathText(await systemClipboard.readText()));

  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    const resolved = path.resolve(candidate);
    const key = process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
    if (unique.has(key)) continue;
    try {
      await lstat(resolved);
      unique.set(key, resolved);
    } catch {
      // Text that merely resembles a path must not become a paste source.
    }
  }
  return [...unique.values()];
}

export function parseClipboardPathText(value: string, platform: NodeJS.Platform = process.platform): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const paths: string[] = [];
  for (const raw of value.split(/\0|\r?\n/)) {
    let candidate = raw.trim();
    if (!candidate || candidate.startsWith('#')) continue;
    if (candidate.length >= 2 && candidate.startsWith('"') && candidate.endsWith('"')) {
      candidate = candidate.slice(1, -1);
    }
    if (/^file:\/\//i.test(candidate)) {
      try {
        candidate = fileURLToPath(candidate, { windows: platform === 'win32' });
      } catch {
        continue;
      }
    }
    if (pathApi.isAbsolute(candidate)) paths.push(candidate);
  }
  return paths;
}
