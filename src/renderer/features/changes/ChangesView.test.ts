// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  expect(container.querySelector<HTMLImageElement>('.tree-folder img.folder-icon')?.getAttribute('src')).toContain('folder_type_src');
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

describe('on a phone', () => {
  beforeEach(() => {
    mobile = true;
    // Base UI's drawer measures and animates; nothing here depends on it finishing.
    vi.stubGlobal('PointerEvent', MouseEvent);
  });
  const sheetRows = () => [...document.querySelectorAll('.mobile-sheet .mobile-sheet-action')].map((row) => row.textContent);
  const row = (name: string) => [...container.querySelectorAll<HTMLElement>('.change-row')].find((item) => item.textContent?.includes(name))!;
  const longPress = async (target: HTMLElement) => {
    await act(async () => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  it('shows a flat list whatever the saved layout, and leaves that choice alone', async () => {
    const onPreference = vi.fn();
    await render([], files('src/app-', 2), 'tree', [], { readOnly: false, ...({ onPreference } as object) });
    expect(container.querySelector('.tree-folder')).toBeNull();
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelector('.virtual-list')?.getAttribute('role')).toBe('list');
    expect(row('app-00.ts').querySelector('small')?.textContent).toBe('src');
    expect(onPreference).not.toHaveBeenCalled();
    // The same props on a wider screen still show the tree.
    mobile = false;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render([], files('src/app-', 2), 'tree', [], { readOnly: false });
    expect(container.querySelector('.tree-folder')).not.toBeNull();
  });

  it('gives a row one visible action, the status letter and no folder line at the root', async () => {
    await render([], [{ ...changed[0]!, path: 'README.md' }], 'list', [], { readOnly: false });
    const item = row('README.md');
    expect(item.querySelector('small')).toBeNull();
    expect(item.querySelector('.status-code')?.textContent).toBe('M');
    expect([...item.querySelectorAll('.change-row-actions button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Stage changes']);
    expect(item.querySelector('[aria-label="Discard changes"]')).toBeNull();
  });

  it('stages and unstages from the button, without opening the file', async () => {
    const onStage = vi.fn(); const onUnstage = vi.fn();
    await render(staged.slice(0, 1), changed.slice(0, 1), 'list', [], { readOnly: false, onStage, onUnstage });
    await act(async () => row('changed-00.ts').querySelector<HTMLButtonElement>('.change-row-actions button')!.click());
    expect(onStage).toHaveBeenCalledWith(['changed-00.ts']);
    await act(async () => row('file-00.ts').querySelector<HTMLButtonElement>('[aria-label="Unstage changes"]')!.click());
    expect(onUnstage).toHaveBeenCalledWith(['staged/file-00.ts']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens the diff on a tap', async () => {
    await render([], changed.slice(0, 1), 'list', [], { readOnly: false });
    await act(async () => row('changed-00.ts').querySelector<HTMLButtonElement>('.file-label')!.click());
    expect(onSelect).toHaveBeenCalledWith('changed-00.ts', 'unstaged');
    expect(document.querySelector('.mobile-sheet')).toBeNull();
  });

  it('offers Open file and then Discard changes in a sheet titled with the name', async () => {
    const onOpenFile = vi.fn(); const onDiscard = vi.fn();
    await render([], files('src/app-', 1), 'list', [], { readOnly: false, onOpenFile, onDiscard });
    await longPress(row('app-00.ts').querySelector<HTMLElement>('.file-label')!);
    expect(document.querySelector('.mobile-sheet-title')?.textContent).toBe('app-00.ts');
    expect(document.querySelector('.mobile-sheet-description')?.textContent).toBe('src');
    expect(sheetRows()).toEqual(['Open file', 'Discard changes']);
    const discard = [...document.querySelectorAll<HTMLButtonElement>('.mobile-sheet-action')].at(-1)!;
    expect(discard.classList.contains('destructive')).toBe(true);
    await act(async () => discard.click());
    expect(onDiscard).toHaveBeenCalledWith(['src/app-00.ts']);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves discarding out for a staged row, as the row itself does elsewhere', async () => {
    await render(staged.slice(0, 1), [], 'list', [], { readOnly: false });
    await longPress(row('file-00.ts'));
    expect(sheetRows()).toEqual(['Open file']);
  });

  it('turns discarding off while read-only, and still opens the file', async () => {
    await render([], changed.slice(0, 1), 'list', [], { readOnly: true });
    await longPress(row('changed-00.ts'));
    const [open, discard] = document.querySelectorAll<HTMLButtonElement>('.mobile-sheet-action');
    expect(open!.disabled).toBe(false);
    expect(discard!.disabled).toBe(true);
  });

  it('keeps the diff in reach for a file that opens on its preview', async () => {
    const image = { ...changed[0]!, path: 'assets/logo.png' };
    await render([], [image], 'list', [], { readOnly: false });
    await longPress(row('logo.png'));
    expect(sheetRows()).toEqual(['View changes', 'Open file', 'Discard changes']);
    await act(async () => document.querySelector<HTMLButtonElement>('.mobile-sheet-action')!.click());
    expect(onSelect).toHaveBeenCalledWith('assets/logo.png', 'unstaged');
  });

  it('offers only discarding for a whole untracked folder, which has no file to open', async () => {
    await render([], [{ ...changed[0]!, path: 'generated/', kind: 'untracked' }], 'list', [], { readOnly: false });
    await longPress(row('generated'));
    expect(sheetRows()).toEqual(['Discard changes']);
  });

  it('keeps conflicts first, opening the conflict view, with Open file in their sheet', async () => {
    const onConflict = vi.fn(); const onOpenFile = vi.fn();
    await render([], changed.slice(0, 1), 'list', files('src/conflict-', 1).map((file) => ({ ...file, conflict: true })), { readOnly: false, onConflict, onOpenFile });
    expect(groupLabels()).toEqual(['Conflicts1', 'Not staged']);
    const conflict = row('conflict-00.ts');
    await act(async () => conflict.querySelector<HTMLButtonElement>('.file-label')!.click());
    expect(onConflict).toHaveBeenCalledWith('src/conflict-00.ts');
    expect(conflict.querySelector('.change-row-actions')).toBeNull();
    await longPress(conflict);
    expect(sheetRows()).toEqual(['Open file']);
    await act(async () => document.querySelector<HTMLButtonElement>('.mobile-sheet-action')!.click());
    expect(onOpenFile).toHaveBeenCalledWith('src/conflict-00.ts');
  });

  it('reaches the sheet from the keyboard and a screen reader, in row order', async () => {
    await render([], changed.slice(0, 1), 'list', [], { readOnly: false });
    expect([...row('changed-00.ts').querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['View changes for changed-00.ts', 'More actions for changed-00.ts', 'Stage changes']);
    await act(async () => row('changed-00.ts').querySelector<HTMLButtonElement>('.mobile-row-more')!.click());
    expect(sheetRows()).toEqual(['Open file', 'Discard changes']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves a held press on the stage button to that button', async () => {
    await render([], changed.slice(0, 1), 'list', [], { readOnly: false });
    await longPress(row('changed-00.ts').querySelector<HTMLElement>('.change-row-actions button')!);
    expect(document.querySelector('.mobile-sheet')).toBeNull();
  });

  it('spaces rows by the height the stylesheet gives them', async () => {
    await render([], changed.slice(0, 3), 'list', [], { readOnly: false });
    expect([...container.querySelectorAll<HTMLElement>('.virtual-row')].map((item) => item.style.transform)).toEqual(['translateY(0px)', 'translateY(52px)', 'translateY(104px)']);
    expect(readFileSync(path.join(process.cwd(), 'src/renderer/styles/mobile.css'), 'utf8')).toMatch(/html \.change-row \{ height: 52px;/);
  });
});
