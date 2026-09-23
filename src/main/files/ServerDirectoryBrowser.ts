import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { ServerDirectoryListing } from '../../shared/contracts';

/** Authenticated server browsing, with the same filesystem access as opening a path. */
export async function browseServerDirectories(requestedPath?: string): Promise<ServerDirectoryListing> {
  const input = requestedPath ?? homedir();
  const expanded = input === '~' ? homedir() : /^~[/\\]/.test(input) ? join(homedir(), input.slice(2)) : input;
  if (!isAbsolute(expanded)) throw new Error('Enter an absolute folder path on the server.');
  const path = resolve(expanded);
  const entries = await readdir(path, { withFileTypes: true });
  const directories: ServerDirectoryListing['directories'] = [];
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory() || (entry.isSymbolicLink() && await stat(entryPath).then((value) => value.isDirectory(), () => false))) {
      directories.push({ name: entry.name, path: entryPath });
    }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parentPath = dirname(path);
  return { path, parentPath: parentPath === path ? null : parentPath, directories };
}
