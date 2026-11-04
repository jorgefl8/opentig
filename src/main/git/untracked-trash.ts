import path from 'node:path';
import { rmdir } from 'node:fs/promises';
import type { GitProcess } from './GitProcess';

/**
 * Discarding untracked files moves them to the system Trash. Done one file at
 * a time, a build folder of thousands of files took minutes, filled the Trash
 * with loose entries that are impractical to restore, and left its empty
 * folder tree behind. Folders whose whole content is being discarded are
 * trashed as one item instead, and folders emptied by the discard are removed.
 */

export interface UntrackedTrashLayout {
  /** Git's collapsed untracked entries (`ls-files --others --directory`), folders without the trailing slash. */
  untrackedRoots: readonly string[];
  /** Ignored entries, collapsed the same way: a folder holding any of them is never trashed whole. */
  ignored: readonly string[];
}

export interface UntrackedTrashPlan {
  /** Repository-relative paths to move to the Trash, folders and files, outermost first. */
  targets: string[];
  /** The subset of `targets` that are folders. */
  directories: Set<string>;
}

function ancestors(filePath: string): string[] {
  const parts = filePath.split('/');
  const result: string[] = [];
  for (let index = 1; index < parts.length; index++) result.push(parts.slice(0, index).join('/'));
  return result;
}

function stripSlash(entry: string): string {
  return entry.endsWith('/') ? entry.slice(0, -1) : entry;
}

/**
 * Picks, for each selected untracked file, the outermost folder that can go to
 * the Trash whole: it has no tracked content (it lies inside one of Git's
 * collapsed untracked entries), no ignored content, and every untracked file
 * under it is selected. Files with no such folder are trashed on their own.
 */
export function planUntrackedTrash(input: {
  selected: readonly string[];
  untracked: readonly string[];
  layout: UntrackedTrashLayout;
}): UntrackedTrashPlan {
  const roots = new Set(input.layout.untrackedRoots.map(stripSlash));
  const holdsIgnored = new Set<string>();
  for (const entry of input.layout.ignored.map(stripSlash)) {
    holdsIgnored.add(entry);
    for (const folder of ancestors(entry)) holdsIgnored.add(folder);
  }
  const whollyUntracked = (folder: string) => roots.has(folder) || ancestors(folder).some((parent) => roots.has(parent));

  const total = new Map<string, number>();
  for (const file of input.untracked) for (const folder of ancestors(file)) total.set(folder, (total.get(folder) ?? 0) + 1);
  const selected = [...new Set(input.selected)];
  const chosen = new Map<string, number>();
  for (const file of selected) for (const folder of ancestors(file)) chosen.set(folder, (chosen.get(folder) ?? 0) + 1);

  const targets = new Set<string>();
  const directories = new Set<string>();
  for (const file of selected) {
    const folder = ancestors(file).find((candidate) => whollyUntracked(candidate)
      && !holdsIgnored.has(candidate)
      && (total.get(candidate) ?? 0) > 0
      && total.get(candidate) === chosen.get(candidate));
    if (folder) { targets.add(folder); directories.add(folder); }
    else targets.add(file);
  }
  return { targets: [...targets].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)), directories };
}

export async function readUntrackedTrashLayout(git: GitProcess, cwd: string): Promise<UntrackedTrashLayout> {
  const list = async (args: string[], operation: string) => (await git.run(cwd, ['ls-files', '-z', '--others', '--exclude-standard', '--directory', ...args], {
    operation, readOnly: true, maxOutputBytes: 32 * 1024 * 1024,
  })).stdout.toString('utf8').split('\0').filter(Boolean);
  const [untrackedRoots, ignored] = await Promise.all([
    list(['--no-empty-directory'], 'discard-untracked-layout'),
    list(['--ignored'], 'discard-ignored-layout'),
  ]);
  return { untrackedRoots, ignored };
}

/** Removes the folders left empty above trashed items, deepest first, never the repository root. */
export async function removeEmptyParents(root: string, trashed: readonly string[]): Promise<void> {
  const folders = new Set<string>();
  for (const item of trashed) for (const folder of ancestors(item)) folders.add(folder);
  const deepestFirst = [...folders].sort((a, b) => b.split('/').length - a.split('/').length);
  const kept = new Set<string>();
  for (const folder of deepestFirst) {
    if (kept.has(folder)) continue;
    try {
      await rmdir(path.join(root, ...folder.split('/')));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      // Not empty: it and every folder above it stay.
      for (const parent of [folder, ...ancestors(folder)]) kept.add(parent);
    }
  }
}
