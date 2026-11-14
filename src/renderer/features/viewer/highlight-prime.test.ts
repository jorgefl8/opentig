import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDiffMetadata } from '@pierre/diffs';
import { primeDiffsWhenIdle } from './diff-idle-prime';
import { largePatch } from './diff-parser.fixtures';
import { prepareDiffHighlight, withinBudget } from './highlight-prime';
import { buildDiffFileEntries } from './patch-utils';

vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({ default: class {} }));

function fakePool(workers = 4) {
  const primed: string[] = [];
  const pending: Array<() => void> = [];
  return {
    primed,
    /** Finishes the oldest highlight still running. */
    finish: () => pending.shift()?.(),
    isWorkingPool: () => true,
    initialize: async () => undefined,
    getStats: () => ({ totalWorkers: workers }),
    primeFileHighlightCache: async () => undefined,
    primeDiffHighlightCache: (diff: FileDiffMetadata) => { primed.push(diff.name); return new Promise<void>((resolve) => { pending.push(resolve); }); },
  };
}
const patchOf = (count: number, lines = 3) => Array.from({ length: count }, (_, index) => largePatch(lines, 12, `file-${index}.ts`)).join('');

describe('highlighting before a document is shown', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('waits for the colors only as long as its budget', async () => {
    let shown = false;
    void withinBudget(new Promise(() => undefined), 120).then(() => { shown = true; });
    await vi.advanceTimersByTimeAsync(119);
    expect(shown).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(shown).toBe(true);
  });

  it('shows the document as soon as its colors are ready, or the highlight has failed', async () => {
    const order: string[] = [];
    void withinBudget(Promise.resolve(), 120).then(() => order.push('ready'));
    void withinBudget(Promise.reject(new Error('worker gone')), 120).then(() => order.push('failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['ready', 'failed']);
  });

  it('highlights the first files of a diff and shows it when they are done', async () => {
    const pool = fakePool();
    let shown = false;
    void prepareDiffHighlight(patchOf(6), pool).then(() => { shown = true; });
    expect(pool.primed).toEqual(['file-0.ts', 'file-1.ts', 'file-2.ts', 'file-3.ts']);
    for (let index = 0; index < 4; index++) pool.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toBe(true);
  });

  it('leaves a patch that is parsed in a worker to its workspace', async () => {
    const pool = fakePool();
    await prepareDiffHighlight(largePatch(), pool);
    expect(pool.primed).toEqual([]);
  });
});

describe('highlighting folded files while idle', () => {
  const diffsOf = (count: number) => buildDiffFileEntries(patchOf(count)).map((file) => file.fileDiff);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('takes one file at a time, in order, and stops when the diff closes', async () => {
    const pool = fakePool();
    const idle: Array<() => void> = [];
    const stop = primeDiffsWhenIdle(pool, diffsOf(3), (run) => { idle.push(run); });
    await settle();
    expect(pool.primed).toEqual([]);
    idle.shift()!();
    expect(pool.primed).toEqual(['file-0.ts']);
    expect(idle).toHaveLength(0);
    pool.finish();
    await settle();
    idle.shift()!();
    expect(pool.primed).toEqual(['file-0.ts', 'file-1.ts']);
    stop();
    pool.finish();
    await settle();
    idle.shift()?.();
    expect(pool.primed).toEqual(['file-0.ts', 'file-1.ts']);
  });

  it('never takes the only worker', async () => {
    const pool = fakePool(1);
    const idle: Array<() => void> = [];
    primeDiffsWhenIdle(pool, diffsOf(2), (run) => { idle.push(run); });
    await settle();
    expect(idle).toHaveLength(0);
    expect(pool.primed).toEqual([]);
  });
});
