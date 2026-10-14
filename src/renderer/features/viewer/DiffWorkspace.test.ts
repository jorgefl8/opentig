// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DiffWorkspace } from './DiffWorkspace';
import { largePatch, MIXED_PATCH } from './diff-parser.fixtures';
import { buildDiffFileEntries } from './patch-utils';
import type { DiffParseRequest, DiffParseResponse } from './diff-parser';

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
  Virtualizer: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
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

async function render(patch: string, initiallyCollapsed = false) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(DiffWorkspace, {
    contentKey: 'test', diff: { path: '', patch, binary: false, truncated: false, lineCount: 10_001 },
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
  expect(container.textContent).not.toContain('second.ts');
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
