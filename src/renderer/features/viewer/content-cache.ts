import type { DiffResult, FileResult } from '../../../shared/contracts';
import { ByteBudgetLru } from '@/lib/ByteBudgetLru';

/**
 * What the viewer read from the working tree and the index, kept so opening the
 * same file or change again asks for nothing.
 *
 * Every entry records the change generation it was read at. The generation goes
 * up whenever something may have changed what it read: the file watcher reports
 * a change, or the client sends a change of its own (see `noteChange`). An entry
 * read at the current generation is current, as far as the watcher can tell.
 *
 * A file can also outlive later changes elsewhere: its entry is good while the
 * file tree, read after the last change, still gives it the size and
 * modification time it had when it was read. That alone cannot tell two writes
 * apart that keep the size and land within the file system's timestamp
 * granularity, so it only applies to a read taken at least `RACY_MARGIN_MS`
 * after the file was last modified, by the server's clock: a later write then
 * necessarily carries a later time. This is Git's rule for racily clean index
 * entries. Tools that put back an older time on purpose are not caught.
 *
 * Without a working watcher none of this is trusted, and every open reads again.
 */

/** Wider than the coarsest common timestamp granularity, FAT's two seconds. */
export const RACY_MARGIN_MS = 3_000;
/** At most this many working-tree documents of each kind, and this many bytes, as UTF-16 text. */
export const CONTENT_CACHE_ENTRIES = 32;
export const CONTENT_CACHE_BYTES = 16 * 1024 * 1024;

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

interface Entry<Value> {
  generation: number;
  value: Value;
}

let generation = 0;
let watching = true;

const files = new ByteBudgetLru<string, Entry<FileResult>>({
  maxEntries: CONTENT_CACHE_ENTRIES,
  maxBytes: CONTENT_CACHE_BYTES,
  sizeOf: (entry) => entry.value.content.length * 2 + entry.value.path.length * 2 + 256,
});
const diffs = new ByteBudgetLru<string, Entry<DiffResult>>({
  maxEntries: CONTENT_CACHE_ENTRIES,
  maxBytes: CONTENT_CACHE_BYTES,
  sizeOf: (entry) => entry.value.patch.length * 2 + entry.value.path.length * 2 + 256,
});

/** Something in a working tree or an index may have changed. */
export function noteChange(): void {
  generation += 1;
}

/** The generation to record before a read is sent: a change during the read makes it out of date. */
export function changeGeneration(): number {
  return generation;
}

/** The server watches the open repository again, or has stopped doing so. */
export function setWatching(value: boolean): void {
  if (watching === value) return;
  watching = value;
  noteChange();
}

const fileKey = (repositoryId: string, path: string) => `${repositoryId}\0${path}`;
const diffKey = (repositoryId: string, kind: 'staged' | 'unstaged', path: string) => `${repositoryId}\0${kind}\0${path}`;

export function keepFile(repositoryId: string, value: FileResult, readAt: number): void {
  // A preview limited by size, or read past that limit on request, is read again each time.
  if (value.tooLarge || value.binary) return;
  files.set(fileKey(repositoryId, value.path), { generation: readAt, value });
}

/**
 * The file as last read, if nothing can have changed it since. `stamp` is the
 * size and time the file tree gives it, or null when the tree is not known to
 * be current.
 */
export function keptFile(repositoryId: string, path: string, stamp: FileStamp | null): FileResult | null {
  if (!watching) return null;
  const entry = files.get(fileKey(repositoryId, path));
  if (!entry) return null;
  if (entry.generation === generation) return entry.value;
  const { value } = entry;
  const settled = value.readAtMs !== undefined && value.readAtMs - value.mtimeMs >= RACY_MARGIN_MS;
  return settled && stamp && stamp.size === value.size && stamp.mtimeMs === value.mtimeMs ? value : null;
}

export function keepDiff(repositoryId: string, kind: 'staged' | 'unstaged', path: string, value: DiffResult, readAt: number): void {
  diffs.set(diffKey(repositoryId, kind, path), { generation: readAt, value });
}

/** A change's diff as last read, if nothing has changed in any working tree or index since. */
export function keptDiff(repositoryId: string, kind: 'staged' | 'unstaged', path: string): DiffResult | null {
  if (!watching) return null;
  const entry = diffs.get(diffKey(repositoryId, kind, path));
  return entry && entry.generation === generation ? entry.value : null;
}

/** Forgets everything, as a new session would. */
export function clearContentCache(): void {
  files.clear();
  diffs.clear();
  generation += 1;
  watching = true;
}
