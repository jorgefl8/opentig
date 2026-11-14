// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkerPool } from '@pierre/diffs/react';
import { highlightCacheOverflow, highlightPoolSettings } from './pierre-pool';
import { PierreWorkerPool } from './PierreWorkerPool';

const state = vi.hoisted(() => ({ workers: [] as Array<{ terminate: ReturnType<typeof import('vitest').vi.fn> }> }));
// Stands in for the real worker script: it answers the pool's start-up message and nothing else.
vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({ default: class {
  terminate = vi.fn();
  private listeners: Array<(event: { data: unknown }) => void> = [];
  constructor() { state.workers.push(this); }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) { if (type === 'message') this.listeners.push(listener); }
  postMessage(request: { type: string; id: string }) {
    if (request.type !== 'initialize') return;
    queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: { type: 'success', requestType: 'initialize', id: request.id, sentAt: Date.now() } })));
  }
} }));

const desktop = 'Mozilla/5.0 (X11; Linux x86_64)';
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';

describe('highlighting pool size', () => {
  it('uses a worker for every two cores, never fewer than two or more than six', () => {
    const workers = (hardwareConcurrency: number | undefined) => highlightPoolSettings(hardwareConcurrency === undefined ? { userAgent: desktop } : { userAgent: desktop, hardwareConcurrency }).poolSize;
    expect([1, 2, 4, 8, 12, 32, undefined].map(workers)).toEqual([2, 2, 2, 4, 6, 6, 2]);
  });

  it('stays at one worker and a short memory on a low-end phone', () => {
    const lowEnd = highlightPoolSettings({ userAgent: android, hardwareConcurrency: 4, deviceMemory: 4 });
    const capable = highlightPoolSettings({ userAgent: android, hardwareConcurrency: 8, deviceMemory: 8 });
    expect(lowEnd.poolSize).toBe(1);
    expect(lowEnd.cacheEntries).toBeLessThan(capable.cacheEntries);
    expect(lowEnd.cacheLines).toBeLessThan(capable.cacheLines);
    expect(capable.poolSize).toBe(4);
  });
});

describe('highlight cache line budget', () => {
  it('drops the oldest entries once the newest ones fill the budget', () => {
    const entries = [['oldest', 400], ['older', 300], ['newer', 500], ['newest', 200]] as const;
    expect(highlightCacheOverflow(entries, 2_000)).toEqual([]);
    expect(highlightCacheOverflow(entries, 1_000)).toEqual(['oldest']);
    expect(highlightCacheOverflow(entries, 700)).toEqual(['oldest', 'older']);
  });

  it('does not keep an entry too long to fit on its own', () => {
    expect(highlightCacheOverflow([['small', 10], ['huge', 90_000]], 40_000)).toEqual(['small', 'huge']);
  });
});

describe('the session pool', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('Worker', class {});
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

  it('keeps its workers when the last viewer closes and hands them to the next one', async () => {
    const pools: unknown[] = [];
    function Viewer() { pools.push(useWorkerPool()); return null; }
    const mount = async () => {
      const root = createRoot(container);
      await act(async () => root.render(createElement(PierreWorkerPool, null, createElement(Viewer))));
      return root;
    };

    const first = await mount();
    await vi.waitFor(() => expect(state.workers.length).toBeGreaterThanOrEqual(2));
    const started = state.workers.length;
    await act(async () => first.unmount());
    expect(state.workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true);

    const second = await mount();
    expect(pools.at(-1)).toBe(pools[0]);
    expect(pools[0]).toBeDefined();
    expect(state.workers).toHaveLength(started);
    await act(async () => second.unmount());
    expect(state.workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true);
  });
});
