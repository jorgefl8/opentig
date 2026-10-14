// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';

const calls = vi.hoisted(() => ({ index: vi.fn() }));
vi.mock('./quick-open', async (importOriginal) => {
  const original = await importOriginal<typeof import('./quick-open')>();
  return { ...original, createQuickOpenIndex: (entries: FileTreeEntry[]) => { calls.index(entries); return original.createQuickOpenIndex(entries); } };
});
import { useQuickOpenResults } from './use-quick-open-results';

const file = (path: string, ignored = false): FileTreeEntry => ({ path, name: path.split('/').at(-1)!, type: 'file', ignored, size: 1, mtimeMs: 0 });
const large = Array.from({ length: 10_000 }, (_, i) => file(`src/Component${i}.tsx`, i % 7 === 0));
let root: Root;
let container: HTMLDivElement;
function Listing({ files, query = '', ignored = false, active = null, open = true }: {
  files: FileTreeEntry[] | null; query?: string; ignored?: boolean; active?: string | null; open?: boolean;
}) {
  const { results, pending } = useQuickOpenResults(files, query, ignored, active, open);
  return createElement('output', { 'data-pending': pending }, results.map((result) => result.path).join('\n'));
}
async function render(props: Parameters<typeof Listing>[0]) {
  await act(async () => { root.render(createElement(Listing, props)); });
}
async function complete() { await act(async () => { await vi.runAllTimersAsync(); }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => { now += 4; return now; });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); calls.index.mockClear(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('indexes once per snapshot, searches small snapshots immediately and invalidates rename/ignore changes', async () => {
  const files = [file('first.txt'), file('hidden.txt', true)];
  await render({ files });
  expect(container.textContent).toBe('first.txt');
  await render({ files, query: 'h', ignored: true });
  expect(container.textContent).toBe('hidden.txt');
  await render({ files, query: '', ignored: true, active: 'hidden.txt' });
  expect(container.textContent?.split('\n')[0]).toBe('hidden.txt');
  expect(calls.index).toHaveBeenCalledOnce();
  await render({ files: [file('renamed.txt'), file('hidden.txt')], query: 'first' });
  expect(container.textContent).toBe('');
  expect(calls.index).toHaveBeenCalledTimes(2);
  await render({ files: null });
  expect(container.textContent).toBe('');
});

it('clears selectable rows immediately and publishes only the latest query atomically', async () => {
  await render({ files: large, active: 'src/Component1.tsx' });
  expect(container.textContent?.split('\n')[0]).toBe('src/Component1.tsx');
  await render({ files: large, query: 'component9' });
  expect(container.querySelector('output')?.dataset.pending).toBe('true');
  expect(container.textContent).toBe('');
  await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
  expect(container.textContent).toBe('');
  await render({ files: large, query: 'component10.tsx' });
  await complete();
  expect(container.querySelector('output')?.dataset.pending).toBe('false');
  expect(container.textContent?.split('\n')[0]).toBe('src/Component10.tsx');
  expect(calls.index).toHaveBeenCalledOnce();
});

it('cancels obsolete repository/snapshot and ignored-visibility searches', async () => {
  await render({ files: large, query: 'component0.tsx', ignored: true });
  await complete();
  expect(container.textContent?.split('\n')[0]).toBe('src/Component0.tsx');
  await render({ files: large, query: 'component0.tsx', ignored: false });
  expect(container.textContent).toBe('');
  await render({ files: large, query: 'component0.tsx', ignored: true });
  const next = [file('other-repository.txt')];
  await render({ files: next, query: 'other' });
  expect(container.textContent).toBe('other-repository.txt');
  await complete();
  expect(container.textContent).toBe('other-repository.txt');
  expect(calls.index).toHaveBeenCalledTimes(2);
});

it('aborts on close and unmount without publishing or leaving a timer', async () => {
  await render({ files: large, query: 'component9' });
  await render({ files: large, query: 'component9', open: false });
  expect(container.textContent).toBe('');
  expect(vi.getTimerCount()).toBe(0);
  await render({ files: large, query: 'component9' });
  await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
  await act(async () => { root.unmount(); });
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(container);
});

it('defers indexing closed snapshots and reuses an opened snapshot until it changes', async () => {
  const files = [file('first.txt')];
  await render({ files, open: false });
  expect(calls.index).not.toHaveBeenCalled();
  await render({ files });
  expect(container.textContent).toBe('first.txt');
  expect(calls.index).toHaveBeenCalledOnce();
  await render({ files, open: false });
  await render({ files });
  expect(calls.index).toHaveBeenCalledOnce();
  const next = [file('second.txt')];
  await render({ files: next, open: false });
  expect(calls.index).toHaveBeenCalledOnce();
  await render({ files: next });
  expect(container.textContent).toBe('second.txt');
  expect(calls.index).toHaveBeenCalledTimes(2);
});
