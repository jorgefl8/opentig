import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { ServerDirectoryListing } from '../../shared/contracts';
import { GitProcess } from '../git/GitProcess';

/** Authenticated browsing; inspection never opens a repository or changes recents. */
export async function browseServerDirectories(requestedPath?: string, git = new GitProcess()): Promise<ServerDirectoryListing> {
  const home = homedir();
  const input = requestedPath ?? home;
  const expanded = input === '~' ? home : /^~[/\\]/.test(input) ? join(home, input.slice(2)) : input;
  if (!isAbsolute(expanded)) throw new Error('Enter an absolute folder path.');
  const path = resolve(expanded);
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new Error('You do not have permission to browse this folder.', { cause: error });
    if (code === 'ENOENT') throw new Error('That folder was not found. Check the path and try again.', { cause: error });
    if (code === 'ENOTDIR') throw new Error('This path points to a file. Choose a folder instead.', { cause: error });
    throw new Error('Could not read this folder. Try another location.', { cause: error });
  }
  const directories: ServerDirectoryListing['directories'] = [];
  // Bound filesystem/Git concurrency even in directories with many repositories.
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
    while (index < entries.length) {
      const entry = entries[index++]!;
      const entryPath = join(path, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && await stat(entryPath).then(value => value.isDirectory(), () => false))) {
        directories.push({ name: entry.name, path: entryPath, repository: await inspectRepository(entryPath, git) });
      }
    }
  }));
  directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const locations: ServerDirectoryListing['locations'] = [{ name: 'Home', path: home, kind: 'home' }];
  for (const [name, kind] of [['Documents', 'documents'], ['Downloads', 'downloads']] as const) {
    const location = join(home, name);
    if (await stat(location).then(value => value.isDirectory(), () => false)) locations.push({ name, path: location, kind });
  }
  const parentPath = dirname(path);
  return { path, parentPath: parentPath === path ? null : parentPath, repository: await inspectRepository(path, git), locations, directories };
}

async function inspectRepository(path: string, git: GitProcess): Promise<ServerDirectoryListing['repository']> {
  // A root marker avoids mistaking every subfolder of a checkout for a repository.
  if (!await stat(join(path, '.git')).then(value => value.isDirectory() || value.isFile(), () => false)) return null;
  try {
    const result = await git.run(path, ['rev-parse', '--is-inside-work-tree', '--absolute-git-dir'], {
      operation: 'browse-repository', readOnly: true, timeoutMs: 2_000, maxOutputBytes: 32_768,
    });
    const [inside, gitDir] = result.stdout.toString('utf8').trim().split(/\r?\n/);
    if (inside !== 'true' || !gitDir || !isAbsolute(gitDir)) return null;
    // HEAD is valid for unborn branches and detached checkouts; no extra process.
    const headFile = await open(join(gitDir, 'HEAD'), 'r');
    let head: string;
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await headFile.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead).toString('utf8').trim();
    } finally { await headFile.close(); }
    return { branch: head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null };
  } catch { return null; } // Inspection failure must not prevent folder navigation.
}
