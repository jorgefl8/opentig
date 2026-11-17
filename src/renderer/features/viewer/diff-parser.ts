import { ParsedDiffCache } from './parsed-diff-cache';
import ParseWorker from './diff-parse.worker?worker';
import { buildDiffFileEntries, buildDiffFileEntry, type DiffFileEntry } from './patch-utils';

export interface DiffParseRequest { revision: number; patch: string }
export type DiffParseResponse = { revision: number; files: DiffFileEntry[] } | { revision: number; error: string };
export interface DiffParseWorker {
  postMessage(request: DiffParseRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<DiffParseResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export type DiffParseWorkerFactory = () => DiffParseWorker;
export const DIFF_PARSE_WORKER_THRESHOLD = 128 * 1024;

function abortError() { return new DOMException('Diff parsing was cancelled.', 'AbortError'); }

/** Yield between indexing batches and files when workers are unavailable.
 * Pierre's single-file parser is synchronous: one file remains indivisible. */
export async function parseDiffInBatches(patch: string, signal: AbortSignal): Promise<DiffFileEntry[]> {
  const headers: number[] = [];
  let position = 0;
  let batchStart = 0;
  await yieldToUI(signal);
  while (position < patch.length) {
    if (patch.startsWith('diff --git ', position)) headers.push(position);
    const newline = patch.indexOf('\n', position);
    position = newline < 0 ? patch.length : newline + 1;
    if (position - batchStart >= 64 * 1024) {
      await yieldToUI(signal);
      batchStart = position;
    }
  }
  signal.throwIfAborted();
  if (headers.length <= 1) {
    return patch.trim() ? [buildDiffFileEntry(patch, 0)] : [];
  }
  const files: DiffFileEntry[] = [];
  let batchTime = performance.now();
  for (let index = 0; index < headers.length; index++) {
    signal.throwIfAborted();
    files.push(buildDiffFileEntry(patch.slice(headers[index], headers[index + 1] ?? patch.length), index));
    if (performance.now() - batchTime >= 8) {
      await yieldToUI(signal);
      batchTime = performance.now();
    }
  }
  return files;
}

function yieldToUI(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 0);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * What closed documents parsed last, so the same diff opened again, by Back or
 * by returning to its tab, shows at once instead of being parsed again. Keyed
 * by the whole patch, so a diff whose content changed never matches.
 */
const closedDocuments = new ParsedDiffCache();

/** Forgets what closed documents parsed, as a new session would. */
export function forgetClosedDiffs(): void {
  closedDocuments.clear();
}

/** One parser per mounted workspace. Cancellation releases worker-held text
 * and metadata, rather than leaving superseded work queued behind a big file. */
export class DiffParser {
  private revision = 0;
  private cacheGeneration = 0;
  private readonly cache = new ParsedDiffCache();
  /** The patch parsed last, which outlives the document when it closes. */
  private latest: { patch: string; files: DiffFileEntry[] } | null = null;
  constructor(private readonly workerFactory: DiffParseWorkerFactory = () => new ParseWorker()) {}

  clearCache() {
    this.cacheGeneration++;
    this.cache.clear();
    this.latest = null;
  }

  /** The document closed: its last parsed diff is kept among the closed documents', the rest let go. */
  release() {
    const latest = this.latest;
    this.clearCache();
    if (latest) closedDocuments.set(latest.patch, latest.files);
  }

  /** The files of a patch already parsed, by this document or by one closed since; undefined otherwise. */
  parsed(patch: string): DiffFileEntry[] | undefined {
    const files = this.cache.get(patch) ?? closedDocuments.get(patch);
    if (files) this.keep(patch, files);
    return files;
  }

  private keep(patch: string, files: DiffFileEntry[]) {
    this.cache.set(patch, files);
    this.latest = { patch, files };
  }

  /**
   * Parses where it is called. Meant for patches under `DIFF_PARSE_WORKER_THRESHOLD`,
   * which take a few milliseconds: their files are there on the first render.
   */
  parseNow(patch: string): DiffFileEntry[] {
    const cached = this.parsed(patch);
    if (cached) return cached;
    const files = buildDiffFileEntries(patch);
    this.keep(patch, files);
    return files;
  }

  async parse(patch: string, signal: AbortSignal): Promise<DiffFileEntry[]> {
    signal.throwIfAborted();
    const cached = this.parsed(patch);
    if (cached) return cached;
    const generation = this.cacheGeneration;
    const files = await this.parseUncached(patch, signal);
    signal.throwIfAborted();
    if (generation === this.cacheGeneration) this.keep(patch, files);
    return files;
  }

  private async parseUncached(patch: string, signal: AbortSignal): Promise<DiffFileEntry[]> {
    signal.throwIfAborted();
    const revision = ++this.revision;
    if (patch.length < DIFF_PARSE_WORKER_THRESHOLD) return parseDiffInBatches(patch, signal);
    let worker: DiffParseWorker;
    try { worker = this.workerFactory(); }
    catch { return parseDiffInBatches(patch, signal); }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        settled = true;
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        signal.removeEventListener('abort', abort);
        worker.terminate();
      };
      const abort = () => { if (!settled) { finish(); reject(abortError()); } };
      const fallback = () => {
        if (settled) return;
        finish();
        void parseDiffInBatches(patch, signal).then(resolve, reject);
      };
      worker.onmessage = ({ data }: MessageEvent<DiffParseResponse>) => {
        if (settled || data.revision !== revision) return;
        finish();
        if (signal.aborted) reject(abortError());
        else if ('error' in data) reject(new Error(data.error));
        else resolve(data.files);
      };
      worker.onerror = (event) => { event.preventDefault(); fallback(); };
      worker.onmessageerror = fallback;
      signal.addEventListener('abort', abort, { once: true });
      try { worker.postMessage({ revision, patch } satisfies DiffParseRequest); }
      catch { fallback(); }
    });
  }
}
