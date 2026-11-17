// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MobileChromeContext, NO_MOBILE_CHROME_HOSTS } from '@/components/mobile-chrome-context';
import { DiffWorkspace, PullRequestFilesWorkspace } from './DiffWorkspace';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { largePatch, MIXED_PATCH } from './diff-parser.fixtures';
import { buildDiffFileEntries } from './patch-utils';
import { forgetClosedDiffs, type DiffParseRequest, type DiffParseResponse } from './diff-parser';

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
  FileDiff: ({ fileDiff }: { fileDiff: { name: string; cacheKey?: string } }) => createElement('div', { 'data-code-file': fileDiff.name, 'data-cache-key': fileDiff.cacheKey }, fileDiff.name),
  useWorkerPool: () => undefined,
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
  forgetClosedDiffs();
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

it('publishes complete files atomically and initializes collapse after parsing', async () => {
  const patch = MIXED_PATCH + largePatch();
  await render(patch, true);
  expect(container.textContent).toContain('Preparing diff…');
  expect(container.querySelectorAll('.diff-file-section')).toHaveLength(0);
  await finish(0, patch);
  expect(container.querySelectorAll('.diff-file-section')).toHaveLength(5);
  expect(container.querySelectorAll('[data-code-file]')).toHaveLength(0);
  const button = container.querySelector<HTMLButtonElement>('.diff-file-header')!;
  await act(async () => button.click());
  expect(container.querySelectorAll('[data-code-file]')).toHaveLength(1);
});

it('shows a small patch on its first render, without a frame that only says it is being prepared', async () => {
  const seen: string[] = [];
  const observer = new MutationObserver(() => { seen.push(container.textContent ?? ''); });
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  await render(MIXED_PATCH);
  observer.disconnect();
  expect(container.querySelectorAll('.diff-file-section')).toHaveLength(4);
  expect(seen.some((text) => text.includes('Preparing diff…'))).toBe(false);
  expect(state.workers).toHaveLength(0);
});

it('keeps the shown revision readable while its replacement is parsed, and ignores a late revision after switching and unmounting', async () => {
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
  // The refresh is still being parsed: the revision it replaces stays on screen, in use.
  expect(container.textContent).toContain('second.ts');
  expect(container.textContent).not.toContain('Preparing diff…');
  expect(container.querySelector<HTMLElement>('.diff-workspace-scroll')?.style.visibility).toBe('');
  expect(container.querySelector('[inert]')).toBeNull();
  expect(container.querySelector('.diff-workspace-scroll')?.closest('[aria-hidden="true"]')).toBeNull();
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
    // The color swatch layer is zero-height and draws over the files, so it is not part of the reading order.
    expect([...scroll.children].filter((child) => !child.classList.contains('color-swatch-layer')).map((child) => child.className.split(' ')[0]))
      .toEqual(['diff-workspace-lead', 'diff-file-list', 'diff-file-section', 'diff-file-section']);
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
  // Only added lines here, so the removed side is left out.
  expect(header.querySelector('.diff-file-stats')?.textContent).toBe('+10001');
  expect(header.querySelector('.diff-file-path')?.firstElementChild).toBe(header.querySelector('.diff-file-directory'));
});

it('ends each file header with its status letter and leaves out a count of zero', async () => {
  const patch = [
    'diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-gone\n-too\n',
    'diff --git a/src/fresh.ts b/src/fresh.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/src/fresh.ts\n@@ -0,0 +1 @@\n+fresh\n',
    'diff --git a/old.txt b/moved.txt\nsimilarity index 100%\nrename from old.txt\nrename to moved.txt\n',
    'diff --git a/logo.png b/logo.png\nnew file mode 100644\nindex 0000000..2222222\nBinary files /dev/null and b/logo.png differ\n',
    'diff --git a/README.md b/README.md\nindex 1111111..2222222 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n',
  ].join('');
  // Small enough to parse without the worker, a moment after the first render.
  await render(patch, true, 'statuses', 12);
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelectorAll('.diff-file-header')).toHaveLength(5);
  });
  const rows = [...container.querySelectorAll('.diff-file-header')].map((header) => {
    const status = header.querySelector('.status-code')!;
    return [header.querySelector('.diff-file-name')?.textContent, header.querySelector('.diff-file-stats')?.textContent, status.textContent, status.getAttribute('aria-label')];
  });
  // A deletion used to read "+0−2" and a new file "+1−0", with nothing else to tell them apart.
  expect(rows).toEqual([
    ['gone.ts', '−2', 'D', 'Deleted'],
    ['fresh.ts', '+1', 'A', 'Added'],
    ['moved.txt', '', 'R', 'Renamed'],
    ['logo.png', 'bin', 'A', 'Added'],
    ['README.md', '+1−1', 'M', 'Modified'],
  ]);
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

it('reuses results within a document, and keeps only the last one of a closed document for the next to open', async () => {
  const first = largePatch(10_001, 24, 'first.ts');
  const second = largePatch(10_001, 24, 'second.ts');
  await render(first);
  await finish(0, first);
  await render(second);
  await finish(1, second);
  await render(first);
  expect(state.workers).toHaveLength(2);
  expect(container.textContent).toContain('first.ts');
  // Opened anew, as Back does, the diff the closed document showed last needs no parse.
  await render(first, false, 'other-document');
  expect(state.workers).toHaveLength(2);
  expect(container.textContent).toContain('first.ts');
  expect(container.textContent).not.toContain('Preparing diff…');
  // What it had parsed before that was let go with it.
  await render(second, false, 'third-document');
  expect(state.workers).toHaveLength(3);
  expect(container.textContent).toContain('Preparing diff…');
  await act(async () => root.unmount());
  expect(state.workers[2]!.terminate).toHaveBeenCalledOnce();
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
  const shown = [...container.querySelectorAll('[data-code-file]')].map((file) => file.textContent);
  await render(second);
  expect(container.querySelector('.diff-workspace-scroll')).toBe(scroll);
  // Nothing is hidden while the new patch is parsed.
  expect(scroll.style.visibility).toBe('');
  expect(scroll.closest('[inert]')).toBeNull();
  expect([...container.querySelectorAll('[data-code-file]')].map((file) => file.textContent)).toEqual(shown);
  expect(container.querySelector('[role="status"]')).toBeNull();
  await finish(1, second);
  expect(scroll.style.visibility).toBe('');
  expect(scroll.closest('[inert]')).toBeNull();
  expect(container.querySelector('.diff-workspace-scroll')).toBe(scroll);
  expect(scroll.scrollTop).toBe(600);
  expect(container.querySelector('.diff-file-toggle')?.getAttribute('aria-expanded')).toBe('false');
  await render(second, false, 'other-document');
  expect(state.workers).toHaveLength(2);
  expect(container.querySelector('.diff-workspace-scroll')).not.toBe(scroll);
  expect(container.querySelector('.diff-file-toggle')?.getAttribute('aria-expanded')).toBe('true');
});

it('hides the previous revision once a refresh has failed and restores state on recovery', async () => {
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

it('keeps the highlighting of the files a refresh did not change', async () => {
  const untouched = largePatch(6_000, 24, 'untouched.ts');
  const first = untouched + largePatch(6_000, 24, 'edited.ts');
  const second = untouched + largePatch(6_001, 24, 'edited.ts');
  const keys = () => Object.fromEntries([...container.querySelectorAll<HTMLElement>('[data-code-file]')].map((file) => [file.dataset.codeFile, file.dataset.cacheKey]));
  await render(first);
  await finish(0, first);
  const before = keys();
  await render(second);
  await finish(1, second);
  // Pierre redraws and highlights a file again only when this key changes.
  expect(keys()['untouched.ts']).toBe(before['untouched.ts']);
  expect(keys()['edited.ts']).not.toBe(before['edited.ts']);
  expect(before['untouched.ts']).toBeTruthy();
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

describe('file fold animation', () => {
  it('animates ordinary files and folds large ones immediately', async () => {
    const { animatesFileToggle } = await import('./patch-utils');
    expect(animatesFileToggle({ additions: 120, deletions: 30 }, 6)).toBe(true);
    expect(animatesFileToggle({ additions: 380, deletions: 40 }, 6)).toBe(false);
    expect(animatesFileToggle({ additions: 3, deletions: 1 }, 41)).toBe(false);
  });
});

describe('as a pull request’s files', () => {
  it('stops Expand all at its budget, leaving the rest folded with a line that says so', async () => {
    // Each diff about 640 KB by its changed lines, though each file is small.
    const file = (index: number) => ({ path: `src/part-${index}.ts`, oldPath: null, kind: 'modified' as const, additions: 2000, deletions: 2000, binary: false, size: 200 * 1024 });
    // Still on their way, so Expand all goes by its estimates.
    const readFile = vi.fn(() => new Promise<never>(() => {}));
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(PullRequestFilesWorkspace, {
      contentKey: 'pull', files: Array.from({ length: 10 }, (_, index) => file(index)), diffView: 'unified', themeType: 'light', wrapLines: false,
      scopeControl: null, foldMemoryKey: 'repo:pull:1:all', readFile,
    }))));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand all files"]')!.click());
    // Six such diffs fit in 4 MB; a seventh would not.
    const toggles = [...container.querySelectorAll<HTMLButtonElement>('.diff-file-toggle')];
    expect(toggles.map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual([...Array(6).fill('true'), ...Array(4).fill('false')]);
    expect(container.textContent).toContain('4 more files were left folded, so Expand all reads at most 4.0 MB.');
    expect(container.querySelector('[aria-label="Collapse all files"]')).not.toBeNull();
    // One held back still unfolds by hand.
    await act(async () => toggles[8]!.click());
    expect(toggles[8]!.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the budget of Expand all for a pull request', () => {
  const listed = (path: string, overrides: object = {}) => ({ path, oldPath: null, kind: 'modified' as const, additions: 1, deletions: 1, binary: false, size: 120 * 1024, ...overrides });
  async function renderFiles(files: ReturnType<typeof listed>[], patchOf: (path: string) => string) {
    const readFile = vi.fn(async (file: { path: string }) => ({ path: file.path, patch: patchOf(file.path), binary: false, truncated: false, lineCount: 4 }));
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(PullRequestFilesWorkspace, {
      contentKey: 'budget', files, diffView: 'unified', themeType: 'light', wrapLines: false, scopeControl: null, foldMemoryKey: 'repo:pull:2:all', readFile,
    }))));
  }
  const expanded = () => [...container.querySelectorAll('.diff-file-toggle')].filter((toggle) => toggle.getAttribute('aria-expanded') === 'true').length;

  it('counts a diff by its changed lines, not by the size of its file, so small changes to large files all unfold', async () => {
    await renderFiles([
      ...Array.from({ length: 40 }, (_, index) => listed(`src/card-${index}.ts`)),
      listed('logo.png', { binary: true, additions: 0, deletions: 0, size: 900 * 1024 }),
      listed('moved.ts', { oldPath: 'old.ts', kind: 'renamed', additions: 0, deletions: 0, size: 900 * 1024 }),
    ], (path) => largePatch(1, 4, path));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand all files"]')!.click());
    expect(expanded()).toBe(42);
  });

  it('counts what a diff weighed once read, so a large one unfolded by hand leaves less for the rest', async () => {
    // The first file's diff is nearly 4 MB though it changes few lines.
    await renderFiles(Array.from({ length: 5 }, (_, index) => listed(`src/part-${index}.ts`)), (path) => largePatch(1, path === 'src/part-0.ts' ? 4_193_000 : 4, path));
    const toggles = [...container.querySelectorAll<HTMLButtonElement>('.diff-file-toggle')];
    await act(async () => toggles[0]!.click());
    for (let tick = 0; tick < 3; tick++) await act(async () => { await Promise.resolve(); });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand all files"]')!.click());
    expect(expanded()).toBe(2);
  });
});

it('writes out a tab or a newline in a file’s name rather than laying it out', async () => {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(PullRequestFilesWorkspace, {
    contentKey: 'names', files: [{ path: 'src/tab\there\nname.ts', oldPath: null, kind: 'added', additions: 1, deletions: 0, binary: false, size: 10 }],
    diffView: 'unified', themeType: 'light', wrapLines: false, scopeControl: null, foldMemoryKey: 'repo:pull:3:all', readFile: () => new Promise<never>(() => {}),
  }))));
  const shown = container.querySelector('.diff-file-path')!.textContent!;
  expect(shown).toBe('src/tab\\there\\nname.ts');
  expect(shown).not.toMatch(/[\t\n]/);
});
