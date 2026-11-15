import type { DiffResult, FileResult } from '../../../shared/contracts';
import type { CommitFile } from '../../../shared/git-types';
import { isKnownImagePath } from '../../../shared/image-types';
import { ByteBudgetLru } from '@/lib/ByteBudgetLru';
import { opentig } from '@/lib/opentig-api';
import { inBackground, withSignal } from '@/lib/websocket-transport';
import { readCommitFilesCache, writeCommitFilesCache } from '@/features/history/commit-files-cache';
import { changeGeneration, keptFile, type FileStamp } from './content-cache';

// What a commit contains never changes, so its diffs are kept, per repository
// and commit, across repository switches. Patches are JS strings, so two bytes
// per code unit is a practical upper-bound estimate. Oversized patches remain
// visible but bypass this cache entirely.
export const IMMUTABLE_DIFF_ENTRIES = 64;
export const IMMUTABLE_DIFF_BYTES = 16 * 1024 * 1024;
const diffCache = new ByteBudgetLru<string, DiffResult>({
  maxEntries: IMMUTABLE_DIFF_ENTRIES,
  maxBytes: IMMUTABLE_DIFF_BYTES,
  sizeOf: (value) => value.patch.length * 2 + value.path.length * 2 + 256,
});

interface SharedRead<T> {
  promise: Promise<T>;
  controller: AbortController;
  /** Callers still waiting for it; one that cannot give up counts for ever. */
  interested: number;
}

/** Reads still on their way, so a click on a row being read ahead joins that read instead of starting another. */
const pendingDiffs = new Map<string, SharedRead<DiffResult>>();
const pendingCommitFiles = new Map<string, SharedRead<CommitFile[]>>();
/**
 * Rows the pointer passed over are not worth a queue: past this many reads ahead
 * on their way the next rest reads nothing, and a click never waits behind a
 * line of rows that were only passed over.
 */
const MAX_READS_AHEAD = 2;
let diffsAhead = 0;
let filesAheadInFlight = 0;

function abortError(): Error {
  return new DOMException('The request was cancelled.', 'AbortError');
}

/**
 * Joins the read under `key`, or starts it. The read is cancelled, on the server
 * too, once every caller that joined it has given up through its `signal`; a
 * caller without one keeps it going.
 */
function joinShared<T>(pending: Map<string, SharedRead<T>>, key: string, read: () => Promise<T>, keep: (value: T) => void, signal: AbortSignal | undefined): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  let shared = pending.get(key);
  if (!shared) {
    const controller = new AbortController();
    const created: SharedRead<T> = {
      controller,
      interested: 0,
      promise: withSignal(controller.signal, read).then((value) => { keep(value); return value; })
        .finally(() => { if (pending.get(key) === created) pending.delete(key); }),
    };
    // Whoever gave up has gone; nobody else is left to hear how it ended.
    created.promise.catch(() => undefined);
    pending.set(key, created);
    shared = created;
  }
  const current = shared;
  if (!signal) {
    current.interested = Number.POSITIVE_INFINITY;
    return current.promise;
  }
  current.interested += 1;
  return new Promise<T>((resolve, reject) => {
    const leave = () => {
      reject(abortError());
      current.interested -= 1;
      if (current.interested > 0) return;
      if (pending.get(key) === current) pending.delete(key);
      current.controller.abort();
    };
    signal.addEventListener('abort', leave, { once: true });
    current.promise.then(
      (value) => { signal.removeEventListener('abort', leave); resolve(value); },
      (reason: unknown) => { signal.removeEventListener('abort', leave); reject(reason); },
    );
  });
}

/** A diff that never changes, such as a commit's: read once per `key`, then kept. */
export function immutableDiff(key: string, read: () => Promise<DiffResult>, signal?: AbortSignal): Promise<DiffResult> {
  const kept = diffCache.get(key);
  if (kept) return Promise.resolve(kept);
  return joinShared(pendingDiffs, key, read, (value) => { diffCache.set(key, value); }, signal);
}

/** Puts a diff read some other way where `immutableDiff` finds it, such as one file cut from a whole commit's patch. */
export function keepImmutableDiff(key: string, value: DiffResult): void {
  diffCache.set(key, value);
}

export function hasImmutableDiff(key: string): boolean {
  return diffCache.get(key) !== undefined;
}

export function commitDiffKey(repositoryId: string, oid: string): string {
  return `${repositoryId}:commit:${oid}`;
}

/** The same key the viewer gives a file picked from a commit, so unfolding it in the commit and opening it alone share one read. */
export function commitFileDiffKey(repositoryId: string, oid: string, path: string, oldPath?: string | null): string {
  return `${repositoryId}:commit-file:${oid}:${oldPath ?? ''}:${path}`;
}

/** The files a commit changed, with their line counts: what opening a commit shows before any diff. */
export function commitFiles(repositoryId: string, oid: string, signal?: AbortSignal): Promise<CommitFile[]> {
  const key = `${repositoryId}:${oid}`;
  const kept = readCommitFilesCache(key);
  if (kept) return Promise.resolve(kept);
  return joinShared(pendingCommitFiles, key, () => opentig.commits.files(repositoryId, oid), (value) => writeCommitFilesCache(key, value), signal);
}

/** Reads a commit's files before it is opened, behind anything the user is waiting for. */
export function prefetchCommitFiles(repositoryId: string, oid: string): void {
  const key = `${repositoryId}:${oid}`;
  if (diffsAhead >= MAX_READS_AHEAD || readCommitFilesCache(key) || pendingCommitFiles.has(key)) return;
  diffsAhead += 1;
  void inBackground(() => commitFiles(repositoryId, oid)).catch(() => undefined).finally(() => { diffsAhead -= 1; });
}

/** A file read ahead is only good for the click that follows: after this long it is read again. */
const FILE_AHEAD_MS = 10_000;
const filesAhead = new Map<string, { at: number; generation: number; read: Promise<FileResult> }>();
const fileKey = (repositoryId: string, path: string) => `${repositoryId}\0${path}`;

/** Reads a file before it is opened. Images and PDFs load over HTTP, where the browser keeps them. */
export function prefetchFile(repositoryId: string, path: string, stamp: FileStamp | null = null): void {
  if (isKnownImagePath(path) || /\.pdf$/i.test(path)) return;
  // Already read, and nothing says it changed since: the click needs nothing.
  if (keptFile(repositoryId, path, stamp)) return;
  const key = fileKey(repositoryId, path);
  const ahead = filesAhead.get(key);
  if (ahead && Date.now() - ahead.at < FILE_AHEAD_MS) return;
  if (filesAheadInFlight >= MAX_READS_AHEAD) return;
  filesAheadInFlight += 1;
  const generation = changeGeneration();
  const read = inBackground(() => opentig.repository.readFile(repositoryId, path, false));
  // A failure is the click's to report, with a read of its own.
  read.catch(() => { if (filesAhead.get(key)?.read === read) filesAhead.delete(key); }).finally(() => { filesAheadInFlight -= 1; });
  filesAhead.set(key, { at: Date.now(), generation, read });
  // Only the rows the pointer rested on last can be the next click.
  if (filesAhead.size > 4) filesAhead.delete(filesAhead.keys().next().value!);
}

/** A change in the working tree makes every file read ahead of it out of date. */
export function dropFilesAhead(repositoryId: string): void {
  for (const key of [...filesAhead.keys()]) if (key.startsWith(`${repositoryId}\0`)) filesAhead.delete(key);
}

/** The read started for a file the pointer rested on, once, with the change generation it started at. */
export function takeFileAhead(repositoryId: string, path: string): { read: Promise<FileResult>; generation: number } | null {
  const key = fileKey(repositoryId, path);
  const ahead = filesAhead.get(key);
  filesAhead.delete(key);
  return ahead && Date.now() - ahead.at < FILE_AHEAD_MS ? { read: ahead.read, generation: ahead.generation } : null;
}
