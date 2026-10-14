import ParseWorker from './diff-parse.worker?worker';
import { buildDiffFileEntry, type DiffFileEntry } from './patch-utils';

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

/** One parser per mounted workspace. Cancellation releases worker-held text
 * and metadata, rather than leaving superseded work queued behind a big file. */
export class DiffParser {
  private revision = 0;
  constructor(private readonly workerFactory: DiffParseWorkerFactory = () => new ParseWorker()) {}

  async parse(patch: string, signal: AbortSignal): Promise<DiffFileEntry[]> {
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
