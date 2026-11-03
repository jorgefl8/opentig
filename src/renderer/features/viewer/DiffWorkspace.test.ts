// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MobileChromeContext, NO_MOBILE_CHROME_HOSTS } from '@/components/mobile-chrome-context';
import { DiffWorkspace } from './DiffWorkspace';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
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
const observers = new Set<() => void>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    constructor(notify: () => void) { observers.add(notify); }
    observe() {} unobserve() {} disconnect() {}
  });
  state.workers.length = 0;
  observers.clear();
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

describe('as a commit', () => {
  async function renderCommit(patch: string, { listFiles = true, lineCount = 10, tools = document.createElement('div'), onOpenFile }: { listFiles?: boolean; lineCount?: number; tools?: HTMLElement | null; onOpenFile?: (path: string) => void } = {}) {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(DiffWorkspace, {
      contentKey: 'commit', diff: { path: '', patch, binary: false, truncated: false, lineCount },
      diffView: 'unified', themeType: 'light', wrapLines: false,
      commitLayout: { tools, lead: createElement('p', { className: 'lead' }, 'Commit message'), listFiles },
      scopeControl: createElement('button', { className: 'scope' }, 'All files'),
      onOpenFile,
    }))));
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector('.diff-file-section')).not.toBeNull();
    });
    return tools;
  }
  const twoFiles = () => largePatch(1, 2, 'src/first.ts') + largePatch(1, 3, 'src/second.ts');

  it('gives the totals after the message, and leaves naming the files to their headers', async () => {
    await renderCommit(twoFiles());
    const scroll = container.querySelector('.diff-workspace-scroll')!;
    expect([...scroll.children].map((child) => child.className.split(' ')[0])).toEqual(['diff-workspace-lead', 'diff-file-list', 'diff-file-section', 'diff-file-section']);
    expect(scroll.querySelector('.diff-file-list')?.textContent).toMatch(/^2 files · \+\d+ −\d+$/);
    expect([...scroll.querySelectorAll('.diff-file-header .diff-file-name')].map((name) => name.textContent)).toEqual(['first.ts', 'second.ts']);
    expect(container.querySelectorAll('[data-code-file]')).toHaveLength(2);
  });

  it('opens a file from its header, without toggling it, and not one the commit deleted', async () => {
    const onOpenFile = vi.fn();
    const deleted = 'diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n';
    await renderCommit(twoFiles() + deleted, { onOpenFile });
    const opens = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Open file"]')];
    expect(opens).toHaveLength(2);
    await act(async () => opens[1]!.click());
    expect(onOpenFile).toHaveBeenCalledWith('src/second.ts');
    expect(container.querySelectorAll('[data-code-file]')).toHaveLength(3);
  });

  it('opens a large commit as collapsed rows with only its totals above them', async () => {
    await renderCommit(twoFiles(), { lineCount: 5_001 });
    expect(container.querySelectorAll('[data-code-file]')).toHaveLength(0);
    expect(container.querySelectorAll('.diff-file-toggle[aria-expanded="false"]')).toHaveLength(2);
    expect(container.querySelector('.diff-file-count')).not.toBeNull();
  });

  it('has no list for one file, and puts the scope and tools beside the title instead of a toolbar', async () => {
    const tools = await renderCommit(largePatch(1, 2, 'src/first.ts'), { listFiles: false });
    expect(container.querySelector('.diff-file-list')).toBeNull();
    expect(container.querySelector('.lead')?.textContent).toBe('Commit message');
    expect(container.querySelector('.diff-workspace-toolbar')).toBeNull();
    expect(tools?.querySelector('.scope')).not.toBeNull();
    expect(tools?.querySelector('[aria-label="Use split diff"]')).not.toBeNull();
    expect(tools?.querySelector('[aria-label="Wrap long lines"]')).not.toBeNull();
    expect(tools?.querySelector('[aria-label="Collapse all files"]')).toBeNull();
  });

  it('shows the message and the parsing status while the diff is prepared', async () => {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(DiffWorkspace, {
      contentKey: 'commit', diff: { path: '', patch: largePatch(10_001, 24, 'src/first.ts'), binary: false, truncated: false, lineCount: 10 },
      diffView: 'unified', themeType: 'light', wrapLines: false,
      commitLayout: { tools: null, lead: createElement('p', { className: 'lead' }, 'Commit message'), listFiles: true },
    }))));
    expect(container.querySelector('.diff-workspace-toolbar')?.textContent).toContain('Preparing diff…');
    expect(container.querySelector('.lead')).not.toBeNull();
  });
});

it('shows the directory and name on one line with the file\'s line counts', async () => {
  const patch = largePatch(10_001, 24, 'src/deep/first.ts');
  await render(patch);
  await finish(0, patch);
  const header = container.querySelector('.diff-file-header')!;
  expect(header.querySelector('.diff-file-directory')?.textContent).toBe('src/deep/');
  expect(header.querySelector('.diff-file-name')?.textContent).toBe('first.ts');
  expect(header.querySelector('.diff-file-stats')?.textContent).toMatch(/^\+\d+−\d+$/);
  expect(header.querySelector('.diff-file-path')?.firstElementChild).toBe(header.querySelector('.diff-file-directory'));
});

it('shows an icon for the kind of file, without reading it out', async () => {
  const patch = largePatch(10_001, 24, 'src/deep/first.ts');
  await render(patch);
  await finish(0, patch);
  const icon = container.querySelector<HTMLImageElement>('.diff-file-header img')!;
  expect(icon.getAttribute('src')).toBe(getVsCodeFileIconUrl('src/deep/first.ts'));
  expect(icon.getAttribute('alt')).toBe('');
});

// Hovers on fake timers rather than waiting out the tooltip delay in real time.
async function tooltipAfterHovering(selector: string) {
  const trigger = container.querySelector<HTMLElement>(selector)!;
  vi.useFakeTimers();
  try {
    await act(async () => {
      for (const type of ['pointerenter', 'pointerover', 'mouseenter', 'mouseover', 'pointermove', 'mousemove']) {
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'mouseenter' }));
      }
      await vi.advanceTimersByTimeAsync(700);
    });
  } finally { vi.useRealTimers(); }
  return [...document.querySelectorAll('[data-slot="tooltip-content"]')].map((element) => element.textContent);
}

it.each([
  ['collapsible', false, '.diff-file-toggle'],
  ['compact', true, '.diff-file-path'],
])('offers the full path on a %s header only when it is cut off', async (_name, compact, trigger) => {
  const patch = largePatch(10_001, 24, 'src/deep/first.ts');
  const renderHeader = async () => {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(DiffWorkspace, {
      contentKey: 'test', diff: { path: '', patch, binary: false, truncated: false, lineCount: 10_001 },
      diffView: 'unified', themeType: 'light', wrapLines: false, compact,
    }))));
    await finish(0, patch);
  };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100);
  await renderHeader();
  try {
    expect(await tooltipAfterHovering(trigger)).toEqual([]);
    scrollWidth.mockReturnValue(900);
    await act(async () => observers.forEach((notify) => notify()));
    expect(await tooltipAfterHovering(trigger)).toContain('src/deep/first.ts');
  } finally { vi.restoreAllMocks(); }
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
  const header = container.querySelector<HTMLButtonElement>('.diff-file-toggle')!;
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
  expect(container.querySelector('.diff-file-toggle')?.getAttribute('aria-expanded')).toBe('false');
  await render(second, false, 'other-document');
  await finish(2, second);
  expect(container.querySelector('.diff-workspace-scroll')).not.toBe(scroll);
  expect(container.querySelector('.diff-file-toggle')?.getAttribute('aria-expanded')).toBe('true');
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
  expect(container.querySelector('.diff-file-toggle')?.getAttribute('aria-expanded')).toBe('true');
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

describe('on a phone', () => {
  const single = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-one
+uno
`;
  const renamed = `diff --git a/src/old.ts b/src/new.ts
similarity index 80%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-one
+uno
`;
  async function renderPhone(patch: string, props: { compact?: boolean; initiallyCollapsed?: boolean } = {}) {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(MobileChromeContext.Provider, { value: NO_MOBILE_CHROME_HOSTS }, createElement(DiffWorkspace, {
      contentKey: 'phone', diff: { path: '', patch, binary: false, truncated: false, lineCount: 2 }, diffView: 'unified', themeType: 'light', wrapLines: true, onClose: vi.fn(), onDiffViewChange: vi.fn(), onWrapLinesChange: vi.fn(), ...props,
    })))));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  const labels = () => [...container.querySelectorAll('button')].map((item) => item.getAttribute('aria-label'));

  it('offers no split view and no close, and keeps wrapping', async () => {
    await renderPhone(MIXED_PATCH);
    expect(labels()).not.toContain('Use split diff');
    expect(labels()).not.toContain('Close diff');
    expect(labels()).toContain('Disable line wrapping');
  });

  it('lists files with their counts inside the scroller, so the code gets the screen', async () => {
    await renderPhone(MIXED_PATCH, { initiallyCollapsed: true });
    expect(container.querySelector('.diff-workspace-scroll .diff-workspace-toolbar')).not.toBeNull();
    const rows = [...container.querySelectorAll<HTMLElement>('.diff-file-header')];
    expect(rows.length).toBeGreaterThan(1);
    const toggle = rows[0]!.querySelector<HTMLButtonElement>('.diff-file-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rows[0]!.querySelector('.diff-file-stats')).not.toBeNull();
    // The whole row toggles, not only its button.
    await act(async () => rows[0]!.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not repeat the name of a lone file, since the top bar has it', async () => {
    await renderPhone(single, { compact: true });
    expect(container.querySelector('.diff-file-header')).toBeNull();
  });

  it('still says when that file was renamed', async () => {
    await renderPhone(renamed, { compact: true });
    expect(container.querySelector('.diff-file-header')?.textContent).toBe('Renamed from src/old.ts');
  });

  it('keeps the headers when several files share the view', async () => {
    await renderPhone(MIXED_PATCH, { compact: true });
    expect(container.querySelectorAll('.diff-file-header').length).toBeGreaterThan(1);
    expect(container.querySelector('.diff-file-header .diff-workspace-actions')).toBeNull();
  });
});
