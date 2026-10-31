// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  if (element.classList.contains('change-group-label')) return mobile ? 44 : 28;
  if (element.classList.contains('virtual-list')) return Number.parseFloat(element.style.height) || 0;
  if (element.classList.contains('change-section')) return Array.from(element.children).reduce((sum, child) => sum + height(child as HTMLElement), 0);
  return 0;
}

function listOffset(list: HTMLElement): number {
  const section = list.parentElement;
  if (!section) return 0;
  const label = section.querySelector<HTMLElement>('.change-group-label');
  let offset = label ? height(label) : 0;
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

const handlers = { onPublish: vi.fn(), onStageAll: vi.fn(), onUnstageAll: vi.fn() };

async function render(stagedFiles: FileChange[], changedFiles: FileChange[], displayMode: DisplayMode = 'list', conflicts: FileChange[] = [], overrides: Partial<ComponentProps<typeof ChangesView>> = {}) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(ChangesView, {
    conflicts, staged: stagedFiles, changed: changedFiles, displayMode, readOnly: true, onSelect,
    changeCount: conflicts.length + stagedFiles.length + changedFiles.length, insertions: 0, deletions: 0, selection: null,
    unpublishedCommits: 0, branchNeedsPublication: false, publishDisabled: false, ...handlers,
    onOpenFile: vi.fn(), onDiscard: vi.fn(), onConflict: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn(),
    ...overrides,
  }))));
}

const groupLabels = () => [...container.querySelectorAll('.change-group-label')].map((label) => label.textContent);
const stripAction = () => container.querySelector<HTMLButtonElement>('.changes-strip .quiet-action');

async function resize() {
  await act(async () => {
    for (const observer of [...observers]) {
      const entries = [...observer.elements].map(element => ({ target: element, contentRect: rectangle(element as HTMLElement), borderBoxSize: [] } as unknown as ResizeObserverEntry));
      if (entries.length) observer.callback(entries, observer);
    }
  });
}

async function showStartOfChanges() {
  const list = container.querySelector<HTMLElement>('.virtual-list[aria-label="Not staged"]')!;
  const scroll = container.querySelector<HTMLElement>('.changes-scroll')!;
  await act(async () => { scroll.scrollTop = Math.max(0, listOffset(list) - 60); scroll.dispatchEvent(new Event('scroll')); });
  const firstFile = list.querySelector<HTMLButtonElement>('[aria-label="View changes for changed-00.ts"]');
  expect(firstFile, 'the first unstaged file must be drawn directly below its heading').not.toBeNull();
  expect(firstFile!.closest<HTMLElement>('.virtual-row')!.style.transform).toBe('translateY(0px)');
  return firstFile!;
}

beforeEach(() => {
  mobile = false;
  vi.clearAllMocks();
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

it('shows the full path on hover only for rows whose name is cut off', async () => {
  // Model a narrow sidebar: text wider than 120px is truncated.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function(this: HTMLElement) { return (this.textContent?.length ?? 0) * 8; });
  const [short, long] = files('', 2).map((change, index) => ({ ...change, path: index ? 'deploy/a-very-long-kubernetes-ingress-name.yaml' : 'deploy/ingress.yaml' }));
  await render([], [short!, long!], 'tree');
  // Advance the tooltip hover delay on fake timers rather than waiting it out in real time.
  vi.useFakeTimers();
  const hover = async (path: string) => {
    const trigger = container.querySelector<HTMLElement>(`[aria-label="View changes for ${path}"]`)!;
    await act(async () => {
      for (const type of ['pointerenter', 'pointerover', 'mouseenter', 'mouseover', 'pointermove', 'mousemove']) {
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'mouseenter' }));
      }
      await vi.advanceTimersByTimeAsync(700);
    });
    const tooltip = [...document.querySelectorAll('[data-slot="tooltip-content"]')].map((element) => element.textContent);
    await act(async () => {
      for (const type of ['pointerleave', 'mouseleave', 'pointerout', 'mouseout']) trigger.dispatchEvent(new MouseEvent(type, { bubbles: type.endsWith('out') }));
      await vi.advanceTimersByTimeAsync(50);
    });
    return tooltip;
  };
  try {
    expect(await hover('deploy/ingress.yaml')).not.toContain('deploy/ingress.yaml');
    expect(await hover('deploy/a-very-long-kubernetes-ingress-name.yaml')).toContain('deploy/a-very-long-kubernetes-ingress-name.yaml');
  } finally { vi.useRealTimers(); }
});

it('shows one unlabelled list and Stage all while nothing is staged', async () => {
  await render([], changed);
  expect(groupLabels()).toEqual([]);
  expect(container.querySelector('.virtual-list[aria-label="Changes"]')).not.toBeNull();
  expect(container.querySelector('.changes-strip')?.textContent).toContain('21 changes');
  expect(stripAction()?.textContent).toBe('Stage all');
});

it('labels both groups once something is staged and gives the staged one its own Unstage all', async () => {
  await render(staged, changed, 'list', [], { readOnly: false });
  expect(groupLabels()).toEqual(['Staged24Unstage all', 'Not staged']);
  await act(async () => stripAction()!.click());
  expect(handlers.onStageAll).toHaveBeenCalledOnce();
  expect(handlers.onUnstageAll).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('.change-group-label .quiet-action')!.click());
  expect(handlers.onUnstageAll).toHaveBeenCalledOnce();
});

it('moves Unstage all to the strip when everything is staged', async () => {
  await render(staged, [], 'list', [], { readOnly: false });
  expect(groupLabels()).toEqual(['Staged24']);
  expect(stripAction()?.textContent).toBe('Unstage all');
  await act(async () => stripAction()!.click());
  expect(handlers.onUnstageAll).toHaveBeenCalledOnce();
});

it('turns off the bulk actions while the repository is read-only', async () => {
  await render(staged, changed);
  expect(stripAction()?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('.change-group-label .quiet-action')?.disabled).toBe(true);
});

it('keeps conflicts first and apart from the files that are not staged', async () => {
  await render([], changed, 'list', files('conflict-', 2).map((file) => ({ ...file, conflict: true })));
  expect(groupLabels()).toEqual(['Conflicts2', 'Not staged']);
  expect(stripAction()?.textContent).toBe('Stage all');
  await render([], [], 'list', files('conflict-', 2).map((file) => ({ ...file, conflict: true })));
  expect(groupLabels()).toEqual(['Conflicts2']);
  expect(stripAction()).toBeNull();
});

it('counts files once and shows the worktree line totals only when there are any', async () => {
  await render([], changed.slice(0, 1), 'list', [], { changeCount: 1, insertions: 17, deletions: 5 });
  expect(container.querySelector('.changes-strip')?.textContent).toContain('1 change');
  expect(container.querySelector('.changes-line-stats')?.textContent).toBe('+17−5');
  await render([], changed.slice(0, 1));
  expect(container.querySelector('.changes-line-stats')).toBeNull();
});

it('marks only the row the viewer is showing, on the side it is showing', async () => {
  const both = files('both-', 1, true)[0]!;
  const current = () => [...container.querySelectorAll('[aria-current="true"]')].map((row) => row.closest('.virtual-list')?.getAttribute('aria-label'));
  await render([both], [{ ...both, staged: false, unstaged: true }], 'list', [], { selection: { path: both.path, kind: 'unstaged' } });
  expect(current()).toEqual(['Not staged']);
  await render([both], [{ ...both, staged: false, unstaged: true }], 'list', [], { selection: { path: both.path, kind: 'staged' } });
  expect(current()).toEqual(['Staged']);
  await render([both], [{ ...both, staged: false, unstaged: true }], 'list', [], { selection: { path: both.path, kind: null } });
  expect(current()).toEqual(['Staged', 'Not staged']);
});

it('reaches every row action through the row, in the order they appear', async () => {
  await render([], changed.slice(0, 1), 'list', [], { readOnly: false });
  const row = container.querySelector<HTMLElement>('.change-row')!;
  expect([...row.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['View changes for changed-00.ts', 'Open file', 'Discard changes', 'Stage changes']);
  await render([], changed.slice(0, 1), 'tree', [], { readOnly: false });
  expect(container.querySelector('.change-row-actions [aria-label="Stage changes"]')).not.toBeNull();
});

it('offers folder rows the same actions over everything inside them', async () => {
  const onStage = vi.fn();
  await render([], files('src/app-', 2), 'tree', [], { readOnly: false, onStage });
  await act(async () => container.querySelector<HTMLButtonElement>('.tree-folder [aria-label="Stage changes"]')!.click());
  expect(onStage).toHaveBeenCalledWith(['src/app-00.ts', 'src/app-01.ts']);
  expect(container.querySelector('.tree-folder .folder-icon')).not.toBeNull();
  expect(container.querySelector('.tree-folder img')).toBeNull();
});

describe('with no changes', () => {
  it('says so without a publish action when nothing is waiting', async () => {
    await render([], []);
    expect(container.querySelector('.changes-empty')?.textContent).toBe('No changesNothing to review or commit.');
    expect(container.querySelector('.inline-action')).toBeNull();
    expect(container.querySelectorAll('.change-section')).toHaveLength(0);
  });

  it.each([
    [{ unpublishedCommits: 1 }, 'Push it', '1 commit isn\'t pushed yet.'],
    [{ unpublishedCommits: 3 }, 'Push them', '3 commits aren\'t pushed yet.'],
    [{ branchNeedsPublication: true }, 'Publish it', 'This branch isn\'t published yet.'],
  ])('offers to publish what is waiting (%j)', async (overrides, action, sentence) => {
    await render([], [], 'list', [], overrides);
    const link = container.querySelector<HTMLButtonElement>('.inline-action')!;
    expect(link.textContent).toBe(action);
    expect(container.querySelector('.changes-empty')?.textContent).toContain(sentence);
    await act(async () => link.click());
    expect(handlers.onPublish).toHaveBeenCalledOnce();
  });

  it('turns the publish action off while it can\'t run', async () => {
    await render([], [], 'list', [], { unpublishedCommits: 1, publishDisabled: true });
    expect(container.querySelector<HTMLButtonElement>('.inline-action')?.disabled).toBe(true);
  });
});
