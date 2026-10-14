// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DiffWorkspace } from './DiffWorkspace';
import { largePatch, MIXED_PATCH } from './diff-parser.fixtures';
import { buildDiffFileEntries } from './patch-utils';
import { DiffParser, type DiffParseRequest, type DiffParseResponse } from './diff-parser';

const state = vi.hoisted(() => ({ workers: [] as Array<{ request?: DiffParseRequest; onmessage: ((event: MessageEvent<DiffParseResponse>) => void) | null; terminate: ReturnType<typeof vi.fn> }> }));
vi.mock('./diff-parse.worker?worker', () => ({ default: class {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  terminate = vi.fn();
  constructor() { state.workers.push(this); }
  postMessage(request: DiffParseRequest) { Object.assign(this, { request }); }
} }));
vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: ({ children, className, style }: { children: React.ReactNode; className: string; style: React.CSSProperties }) => createElement('div', { className, style }, children),
  FileDiff: ({ fileDiff, disableWorkerPool }: { fileDiff: { name: string }; disableWorkerPool: boolean }) => createElement('div', { 'data-code-file': fileDiff.name, 'data-worker-disabled': disableWorkerPool }, fileDiff.name),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.workers.length = 0;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(patch: string, initiallyCollapsed = false, contentKey = 'test', lineCount = 10_001) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(DiffWorkspace, {
    contentKey, diff: { path: '', patch, binary: false, truncated: false, lineCount },
    diffView: 'unified', themeType: 'light', wrapLines: false, initiallyCollapsed,
  }))));
}
async function finish(index: number, patch: string) {
  const worker = state.workers[index]!;
  await act(async () => worker.onmessage?.({ data: { revision: worker.request!.revision, files: buildDiffFileEntries(patch) } } as MessageEvent<DiffParseResponse>));
}

it('publishes complete files atomically, retains the highlighting guard and initializes collapse after parsing', async () => {
  const patch = MIXED_PATCH + largePatch();
  await render(patch, true);
  expect(container.textContent).toContain('Preparing diff…');
  expect(container.querySelectorAll('.diff-file-section')).toHaveLength(0);
  await finish(0, patch);
  expect(container.querySelectorAll('.diff-file-section')).toHaveLength(5);
  expect(container.querySelectorAll('[data-code-file]')).toHaveLength(0);
  const button = container.querySelector<HTMLButtonElement>('.diff-file-header')!;
  await act(async () => button.click());
  expect(container.querySelector('[data-worker-disabled="true"]')).not.toBeNull();
});

it('hides superseded content immediately and ignores a late revision after switching and unmounting', async () => {
  const first = largePatch(10_001, 24, 'first.ts');
  const second = largePatch(10_001, 24, 'second.ts');
  await render(first);
  const staleHandler = state.workers[0]!.onmessage!;
  await render(second);
  expect(state.workers[0]!.terminate).toHaveBeenCalledOnce();
  await act(async () => staleHandler({ data: { revision: 1, files: buildDiffFileEntries(first) } } as MessageEvent<DiffParseResponse>));
  expect(container.textContent).not.toContain('first.ts');
  await finish(1, second);
  expect(container.textContent).toContain('second.ts');
  await render(first);
  expect(container.querySelector<HTMLElement>('.diff-workspace-scroll')?.style.visibility).toBe('hidden');
  expect(container.querySelector('[inert][aria-hidden="true"]')).not.toBeNull();
  const last = state.workers[2]!;
  const handler = last.onmessage!;
  await act(async () => root.unmount());
  expect(last.terminate).toHaveBeenCalledOnce();
  await act(async () => handler({ data: { revision: 3, files: buildDiffFileEntries(first) } } as MessageEvent<DiffParseResponse>));
  expect(container.textContent).toBe('');
});

it('shows parse failures instead of stale file rows', async () => {
  await render(largePatch());
  const worker = state.workers[0]!;
  await act(async () => worker.onmessage?.({ data: { revision: 1, error: 'Invalid diff' } } as MessageEvent<DiffParseResponse>));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid diff');
  expect(container.querySelectorAll('.diff-file-section')).toHaveLength(0);
});

it('reuses results within a document and clears the cache on document changes and unmount', async () => {
  const clear = vi.spyOn(DiffParser.prototype, 'clearCache');
  const first = largePatch(10_001, 24, 'first.ts');
  const second = largePatch(10_001, 24, 'second.ts');
  await render(first);
  await finish(0, first);
  await render(second);
  await finish(1, second);
  await render(first);
  expect(state.workers).toHaveLength(2);
  expect(container.textContent).toContain('first.ts');
  await render(first, false, 'other-document');
  expect(clear).toHaveBeenCalledOnce();
  expect(state.workers).toHaveLength(3);
  expect(container.textContent).toContain('Preparing diff…');
  await act(async () => root.unmount());
  expect(clear).toHaveBeenCalledTimes(2);
  expect(state.workers[2]!.terminate).toHaveBeenCalledOnce();
  clear.mockRestore();
});

it('preserves collapse choices and the scroll container across background patch refreshes', async () => {
  const first = MIXED_PATCH + largePatch();
  const second = MIXED_PATCH + largePatch(10_002);
  await render(first);
  await finish(0, first);
  const header = container.querySelector<HTMLButtonElement>('.diff-file-header')!;
  await act(async () => header.click());
  expect(header.getAttribute('aria-expanded')).toBe('false');
  const scroll = container.querySelector<HTMLElement>('.diff-workspace-scroll')!;
  scroll.scrollTop = 600;
  await render(second);
  expect(container.querySelector('.diff-workspace-scroll')).toBe(scroll);
  expect(scroll.style.visibility).toBe('hidden');
  expect(scroll.closest('[inert]')).not.toBeNull();
  await finish(1, second);
  expect(scroll.style.visibility).toBe('');
  expect(scroll.closest('[inert]')).toBeNull();
  expect(container.querySelector('.diff-workspace-scroll')).toBe(scroll);
  expect(scroll.scrollTop).toBe(600);
  expect(container.querySelector('.diff-file-header')?.getAttribute('aria-expanded')).toBe('false');
  await render(second, false, 'other-document');
  await finish(2, second);
  expect(container.querySelector('.diff-workspace-scroll')).not.toBe(scroll);
  expect(container.querySelector('.diff-file-header')?.getAttribute('aria-expanded')).toBe('true');
});

it('keeps the previous revision hidden through a failed refresh and restores state on recovery', async () => {
  const first = MIXED_PATCH + largePatch();
  await render(first, true);
  await finish(0, first);
  await act(async () => container.querySelector<HTMLButtonElement>('.diff-file-header')!.click());
  const scroll = container.querySelector<HTMLElement>('.diff-workspace-scroll')!;
  const second = MIXED_PATCH + largePatch(10_002);
  await render(second, true);
  const worker = state.workers[1]!;
  await act(async () => worker.onmessage?.({ data: { revision: worker.request!.revision, error: 'Invalid diff' } } as MessageEvent<DiffParseResponse>));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid diff');
  expect(scroll.style.visibility).toBe('hidden');
  expect(scroll.closest('[inert][aria-hidden="true"]')).not.toBeNull();
  await render(first, true);
  expect(container.querySelector('.diff-workspace-scroll')).toBe(scroll);
  expect(scroll.style.visibility).toBe('');
  expect(container.querySelector('.diff-file-header')?.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('retains the highlighting guard for the hidden revision until its replacement is ready', async () => {
  const first = largePatch();
  const second = largePatch(1, 150_000);
  await render(first);
  await finish(0, first);
  expect(container.querySelector('[data-worker-disabled="true"]')).not.toBeNull();
  await render(second, false, 'test', 1);
  expect(container.querySelector('[data-worker-disabled="true"]')).not.toBeNull();
  expect(container.querySelector('[data-worker-disabled="false"]')).toBeNull();
  await finish(1, second);
  expect(container.querySelector('[data-worker-disabled="false"]')).not.toBeNull();
});
