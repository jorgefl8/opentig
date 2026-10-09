// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileChange } from '@shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChangesView } from './ChangesView';

let root: Root;
let container: HTMLDivElement;
let mobile = false;
const observers = new Set<TestResizeObserver>();
const onSelect = vi.fn();
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

class TestResizeObserver implements ResizeObserver {
  readonly elements = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {}
  observe(element: Element) { this.elements.add(element); observers.add(this); }
  unobserve(element: Element) { this.elements.delete(element); }
  disconnect() { this.elements.clear(); observers.delete(this); }
}

// jsdom has no layout engine. Model the section flow and viewport dimensions,
// while leaving React, TanStack Virtual, and the component's observers intact.
function height(element: HTMLElement): number {
  if (element.classList.contains('changes-scroll')) return 600;
  if (element.classList.contains('section-heading')) return mobile ? 44 : 40;
  if (element.classList.contains('empty-list')) return 40;
  if (element.classList.contains('virtual-list')) return Number.parseFloat(element.style.height) || 0;
  if (element.classList.contains('change-section')) return Array.from(element.children).reduce((sum, child) => sum + height(child as HTMLElement), 0);
  return 0;
}

function listOffset(list: HTMLElement): number {
  const section = list.parentElement;
  if (!section) return 0;
  let offset = height(section.querySelector<HTMLElement>('.section-heading')!);
  for (let sibling = section.previousElementSibling; sibling; sibling = sibling.previousElementSibling) offset += height(sibling as HTMLElement);
  return offset;
}

function rectangle(element: HTMLElement): DOMRect {
  const scroll = element.closest<HTMLElement>('.changes-scroll');
  const top = element.classList.contains('virtual-list') ? listOffset(element) - (scroll?.scrollTop ?? 0) : 0;
  return { x: 0, y: top, top, left: 0, right: 500, bottom: top + height(element), width: 500, height: height(element), toJSON() {} };
}

function files(prefix: string, count: number, staged = false): FileChange[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `${prefix}${String(index).padStart(2, '0')}.ts`, indexStatus: staged ? 'A' : ' ', worktreeStatus: staged ? ' ' : 'M',
    kind: 'modified', staged, unstaged: !staged, conflict: false, submodule: '',
  }));
}
const staged = files('staged/file-', 24, true);
const changed = files('changed-', 21);
type DisplayMode = 'list' | 'tree';

async function render(stagedFiles: FileChange[], changedFiles: FileChange[], displayMode: DisplayMode = 'list', conflicts: FileChange[] = []) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(ChangesView, {
    conflicts, staged: stagedFiles, changed: changedFiles, displayMode, readOnly: true, onSelect,
    onOpenFile: vi.fn(), onDiscard: vi.fn(), onConflict: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn(), onStageAll: vi.fn(), onUnstageAll: vi.fn(),
  }))));
}

async function resize() {
  await act(async () => {
    for (const observer of [...observers]) {
      const entries = [...observer.elements].map(element => ({ target: element, contentRect: rectangle(element as HTMLElement), borderBoxSize: [] } as unknown as ResizeObserverEntry));
      if (entries.length) observer.callback(entries, observer);
    }
  });
}

async function showStartOfChanges() {
  const list = container.querySelector<HTMLElement>('.virtual-list[aria-label="Changes"]')!;
  const scroll = container.querySelector<HTMLElement>('.changes-scroll')!;
  await act(async () => { scroll.scrollTop = Math.max(0, listOffset(list) - 60); scroll.dispatchEvent(new Event('scroll')); });
  const firstFile = list.querySelector<HTMLButtonElement>('[aria-label="View changes for changed-00.ts"]');
  expect(firstFile, 'the first unstaged file must be drawn directly below its heading').not.toBeNull();
  expect(firstFile!.closest<HTMLElement>('.virtual-row')!.style.transform).toBe('translateY(0px)');
  return firstFile!;
}

beforeEach(() => {
  mobile = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) { return rectangle(this); });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: function(this: HTMLElement, options: ScrollToOptions | number) {
    if (typeof options === 'object') this.scrollTop = options.top ?? this.scrollTop;
  } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); observers.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

it.each<[DisplayMode, boolean]>([['list', false], ['tree', false], ['list', true], ['tree', true]])('draws the start of Changes after loading empty sections (%s, mobile=%s)', async (mode, phone) => {
  mobile = phone;
  await render([], [], mode);
  await render(staged, changed, mode);
  const firstFile = await showStartOfChanges();
  await act(async () => firstFile.click());
  expect(onSelect).toHaveBeenCalledWith('changed-00.ts', 'unstaged');
});

it('measures the new list after it empties and is populated again', async () => {
  await render(staged, changed);
  await render(staged, []);
  await render(files('other-staged-', 40, true), changed);
  await resize();
  await showStartOfChanges();
});

it('updates later sections when conflicts appear, grow, and disappear', async () => {
  await render(staged, changed);
  const conflicts = files('conflict-', 24).map(file => ({ ...file, conflict: true }));
  await render(staged, changed, 'list', conflicts);
  await showStartOfChanges();
  await render(staged, changed, 'list', [...conflicts, ...files('extra-conflict-', 16).map(file => ({ ...file, conflict: true }))]);
  await resize();
  await showStartOfChanges();
  await render(staged, changed);
  await showStartOfChanges();
});

it('updates later sections when the staged tree is collapsed and expanded', async () => {
  await render(staged, changed, 'tree');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse folder"]')!.click());
  await resize();
  await showStartOfChanges();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand folder"]')!.click());
  await resize();
  await showStartOfChanges();
});
