import { describe, expect, it, vi } from 'vitest';
import { DiffParser, parseDiffInBatches, type DiffParseResponse, type DiffParseWorker } from './diff-parser';
import { largePatch, MIXED_PATCH } from './diff-parser.fixtures';
import { buildDiffFileEntries } from './patch-utils';

function fakeWorker() {
  const worker: DiffParseWorker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null };
  return worker;
}

function deliver(worker: DiffParseWorker, data: DiffParseResponse) {
  worker.onmessage?.({ data } as MessageEvent<DiffParseResponse>);
}

describe('diff parsing', () => {
  it.each([MIXED_PATCH, largePatch(9_999), largePatch(10_001), largePatch(1, 100_000), Array.from({ length: 500 }, (_, i) => largePatch(1, 8, `file-${i}.ts`)).join('')])('keeps the synchronous model in the workerless fallback', async (patch) => {
    expect(await parseDiffInBatches(patch, new AbortController().signal)).toEqual(buildDiffFileEntries(patch));
  });

  it('preserves changed and pure renames, binaries, deleted files, and conflict marker text', async () => {
    const files = await parseDiffInBatches(MIXED_PATCH, new AbortController().signal);
    expect(files).toMatchObject([
      { path: 'new.ts', previousPath: 'old.ts', changeType: 'rename-changed', additions: 2, deletions: 1 },
      { path: 'moved.txt', previousPath: 'old.txt', changeType: 'rename-pure' },
      { path: 'image.png', additions: 0, deletions: 0 },
      { path: 'removed.txt', changeType: 'deleted', deletions: 1 },
    ]);
    expect(files[0]?.fileDiff.additionLines.join('')).toContain('<<<<<<< HEAD');
  });

  it('terminates cancelled work and discards late replies without blocking a newer revision', async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const parser = new DiffParser(() => workers.shift()!);
    const firstWorker = workers[0]!;
    const secondWorker = workers[1]!;
    const first = new AbortController();
    const pending = parser.parse(largePatch(), first.signal);
    const staleHandler = firstWorker.onmessage!;
    first.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    const next = parser.parse(largePatch(10_002), new AbortController().signal);
    staleHandler({ data: { revision: 1, files: [] } } as unknown as MessageEvent<DiffParseResponse>);
    deliver(secondWorker, { revision: 1, files: [] });
    expect(secondWorker.terminate).not.toHaveBeenCalled();
    deliver(secondWorker, { revision: 2, files: buildDiffFileEntries(largePatch(10_002)) });
    expect(await next).toHaveLength(1);
    expect(secondWorker.terminate).toHaveBeenCalledOnce();
  });

  it('falls back when worker construction or loading fails', async () => {
    const patch = largePatch();
    const parser = new DiffParser(() => { throw new Error('Workers unavailable'); });
    expect(await parser.parse(patch, new AbortController().signal)).toEqual(buildDiffFileEntries(patch));
    const worker = fakeWorker();
    const pending = new DiffParser(() => worker).parse(patch, new AbortController().signal);
    worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    expect(await pending).toEqual(buildDiffFileEntries(patch));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports parser errors without retrying malformed input on the main thread', async () => {
    const worker = fakeWorker();
    const pending = new DiffParser(() => worker).parse(largePatch(), new AbortController().signal);
    deliver(worker, { revision: 1, error: 'Malformed patch' });
    await expect(pending).rejects.toThrow('Malformed patch');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('cancels fallback indexing and releases scheduled batches', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = parseDiffInBatches(largePatch(), controller.signal);
      await vi.advanceTimersToNextTimerAsync();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
