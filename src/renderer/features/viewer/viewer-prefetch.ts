import type { DiffResult, FileResult } from '../../../shared/contracts';
import { isKnownImagePath } from '../../../shared/image-types';
import { ByteBudgetLru } from '@/lib/ByteBudgetLru';
import { opentig } from '@/lib/opentig-api';
import { inBackground } from '@/lib/websocket-transport';

// Commit contents are immutable per oid; only those diffs are kept.
// Patches are JS strings, so two bytes per code unit is a practical upper-bound
// estimate. Oversized patches remain visible but bypass this cache entirely.
const diffCache = new ByteBudgetLru<string, DiffResult>({
  maxEntries: 8,
  maxBytes: 16 * 1024 * 1024,
  sizeOf: (value) => value.patch.length * 2 + value.path.length * 2 + 256,
});
/** Reads still on their way, so a click on a row being read ahead joins that read instead of starting another. */
const pendingDiffs = new Map<string, Promise<DiffResult>>();
let diffCacheRepositoryId: string | null = null;
/**
 * Rows the pointer passed over are not worth a queue. Nothing read ahead can
 * be called off, so past this many on their way the next rest reads nothing,
 * and a click never waits behind a line of rows that were only passed over.
 */
const MAX_READS_AHEAD = 2;
let diffsAhead = 0;
let filesAheadInFlight = 0;

/** The kept diffs belong to one repository at a time. */
export function scopeDiffCache(repositoryId: string): void {
  if (diffCacheRepositoryId === repositoryId) return;
  diffCache.clear();
  pendingDiffs.clear();
  diffCacheRepositoryId = repositoryId;
}

/** A diff that never changes, such as a commit's: read once per `key`, then kept. */
export function immutableDiff(key: string, read: () => Promise<DiffResult>): Promise<DiffResult> {
  const kept = diffCache.get(key);
  if (kept) return Promise.resolve(kept);
  const pending = pendingDiffs.get(key);
  if (pending) return pending;
  const repositoryId = diffCacheRepositoryId;
  const reading = read().then((value) => {
    if (diffCacheRepositoryId === repositoryId) diffCache.set(key, value);
    return value;
  }).finally(() => { if (pendingDiffs.get(key) === reading) pendingDiffs.delete(key); });
  pendingDiffs.set(key, reading);
  return reading;
}

export function commitDiffKey(repositoryId: string, oid: string): string {
  return `${repositoryId}:commit:${oid}`;
}

/** Reads a commit before it is opened, behind anything the user is waiting for. */
export function prefetchCommitDiff(repositoryId: string, oid: string): void {
  if (diffCacheRepositoryId !== repositoryId || diffsAhead >= MAX_READS_AHEAD) return;
  const key = commitDiffKey(repositoryId, oid);
  if (diffCache.get(key) || pendingDiffs.has(key)) return;
  diffsAhead += 1;
  void immutableDiff(key, () => inBackground(() => opentig.diff.getCommit(repositoryId, oid)))
    .catch(() => undefined).finally(() => { diffsAhead -= 1; });
}

/** A file read ahead is only good for the click that follows: after this long it is read again. */
const FILE_AHEAD_MS = 10_000;
const filesAhead = new Map<string, { at: number; read: Promise<FileResult> }>();
const fileKey = (repositoryId: string, path: string) => `${repositoryId}\0${path}`;

/** Reads a file before it is opened. Images and PDFs load over HTTP, where the browser keeps them. */
export function prefetchFile(repositoryId: string, path: string): void {
  if (isKnownImagePath(path) || /\.pdf$/i.test(path)) return;
  const key = fileKey(repositoryId, path);
  const ahead = filesAhead.get(key);
  if (ahead && Date.now() - ahead.at < FILE_AHEAD_MS) return;
  if (filesAheadInFlight >= MAX_READS_AHEAD) return;
  filesAheadInFlight += 1;
  const read = inBackground(() => opentig.repository.readFile(repositoryId, path, false));
  // A failure is the click's to report, with a read of its own.
  read.catch(() => { if (filesAhead.get(key)?.read === read) filesAhead.delete(key); }).finally(() => { filesAheadInFlight -= 1; });
  filesAhead.set(key, { at: Date.now(), read });
  // Only the rows the pointer rested on last can be the next click.
  if (filesAhead.size > 4) filesAhead.delete(filesAhead.keys().next().value!);
}

/** A change in the working tree makes every file read ahead of it out of date. */
export function dropFilesAhead(repositoryId: string): void {
  for (const key of [...filesAhead.keys()]) if (key.startsWith(`${repositoryId}\0`)) filesAhead.delete(key);
}

/** The read started for a file the pointer rested on, once: the viewer's own refreshes always read again. */
export function takeFileAhead(repositoryId: string, path: string): Promise<FileResult> | null {
  const key = fileKey(repositoryId, path);
  const ahead = filesAhead.get(key);
  filesAhead.delete(key);
  return ahead && Date.now() - ahead.at < FILE_AHEAD_MS ? ahead.read : null;
}
