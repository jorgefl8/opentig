// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommitInfo } from '@shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { clearCommitFilesCache } from './commit-files-cache';
import { HistoryView } from './HistoryView';

vi.mock('@/lib/opentig-api', () => ({ opentig: { commits: { files: async () => [] } } }));
let root: Root;
let container: HTMLDivElement;
const observers = new Set<TestResizeObserver>();

class TestResizeObserver implements ResizeObserver {
  readonly elements = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {}
  observe(element: Element) { this.elements.add(element); observers.add(this); }
  unobserve(element: Element) { this.elements.delete(element); }
  disconnect() { this.elements.clear(); observers.delete(this); }
}

// Model DOM sizes while keeping the real component and TanStack measurements.
// Resize notifications are delivered only when a row actually changes size.
function height(element: HTMLElement): number {
  if (element.classList.contains('history-scroll')) return 400;
  if (element.classList.contains('virtual-row')) return element.querySelector('[aria-expanded="true"]') ? 180 : 42;
  return 0;
}
function commit(oid: string, parentOids: string[], subject: string): CommitInfo {
  return { oid, shortOid: oid.slice(0, 7), parentOids, parentCount: parentOids.length, subject, body: 'Commit description',
    author: 'Sample author', email: 'sample@example.invalid', date: '2026-01-01T12:00:00Z', decorations: [], upstreamState: 'published', isHead: false };
}
const commits = [commit('merge', ['main', 'feature'], 'Merge feature'), commit('main', ['base'], 'Main'), commit('feature', ['base'], 'Feature'), commit('base', [], 'Base')];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); observers.clear(); clearCommitFilesCache(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mountAndExpand() {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(HistoryView, {
    repositoryId: 'history-measure-test', upstream: 'origin/main', readOnly: true, operation: null,
    canPublish: false, pushBusy: false, onPublish: vi.fn(), commits, nextCursor: null, loading: false, undoing: false,
    onSelectCommit: vi.fn(), onSelectFile: vi.fn(), onUndo: vi.fn(), onMore: vi.fn(),
  }))));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand commit"]')!.click());
  await act(async () => {
    for (const observer of [...observers]) {
      const entries = [...observer.elements].map(element => ({ target: element, borderBoxSize: [{ inlineSize: 500, blockSize: height(element as HTMLElement) }] } as unknown as ResizeObserverEntry));
      if (entries.length) observer.callback(entries, observer);
    }
  });
  expectNextRowBelowExpansion();
}
function expectNextRowBelowExpansion() {
  expect(container.querySelector('[data-index="0"] [aria-label="Collapse commit"]')).not.toBeNull();
  expect(container.querySelector<HTMLElement>('[data-index="1"]')!.style.transform).toBe('translateY(180px)');
}
async function search(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Search loaded commits"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('keeps measured expanded rows below their headers when search is entered, edited, and cleared', async () => {
  await mountAndExpand();
  for (const value of ['Merge feature', 'Merge', '']) {
    await search(value);
    expectNextRowBelowExpansion();
  }
});

it('keeps an expanded merge measured when grouping is toggled and search reveals its branch', async () => {
  await mountAndExpand();
  const grouping = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Group merges')!;
  await act(async () => grouping.click());
  expect(container.querySelectorAll('.commit-item')).toHaveLength(3);
  expectNextRowBelowExpansion();
  await search('Merge');
  expect(container.querySelectorAll('.commit-item')).toHaveLength(4);
  expectNextRowBelowExpansion();
  await search('');
  expect(container.querySelectorAll('.commit-item')).toHaveLength(3);
  expectNextRowBelowExpansion();
  await act(async () => grouping.click());
  expect(container.querySelectorAll('.commit-item')).toHaveLength(4);
  expectNextRowBelowExpansion();
});
