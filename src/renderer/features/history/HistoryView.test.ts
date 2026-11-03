// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitFile, CommitInfo } from '@shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RepositoryLinksContext } from '@/components/repository-links';
import { clearCommitFilesCache, COMMIT_FILES_CACHE_MAX_ENTRY_BYTES, readCommitFilesCache } from './commit-files-cache';
import { HistoryView } from './HistoryView';

const filesRequest = vi.hoisted(() => vi.fn<(repositoryId: string, oid: string) => Promise<CommitFile[]>>());
vi.mock('@/lib/opentig-api', () => ({ opentig: { commits: { files: filesRequest } } }));
let root: Root;
let container: HTMLDivElement;
const observers = new Set<TestResizeObserver>();
let mobile = false;

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
  if (element.classList.contains('virtual-row')) return element.querySelector('[aria-expanded="true"]') ? 180 : 46;
  return 0;
}
function commit(oid: string, parentOids: string[], subject: string): CommitInfo {
  return { oid, shortOid: oid.slice(0, 7), parentOids, parentCount: parentOids.length, subject, body: 'Commit description',
    author: 'Sample author', email: 'sample@example.invalid', date: '2026-01-01T12:00:00Z', decorations: [], upstreamState: 'published', isHead: false };
}
const commits = [commit('merge', ['main', 'feature'], 'Merge feature'), commit('main', ['base'], 'Main'), commit('feature', ['base'], 'Feature'), commit('base', [], 'Base')];

beforeEach(() => {
  filesRequest.mockReset().mockResolvedValue([]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  mobile = false;
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); observers.clear(); clearCommitFilesCache(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const links = { nameWithOwner: 'sample/demo', open: vi.fn() };
async function mount(overrides: Partial<Parameters<typeof HistoryView>[0]> = {}) {
  const props = {
    repositoryId: 'history-measure-test', upstream: 'origin/main', readOnly: true, operation: null,
    commits, nextCursor: null, loading: false, undoing: false,
    onSelectCommit: vi.fn(), onSelectFile: vi.fn(), onUndo: vi.fn(), onMore: vi.fn(),
    ...overrides,
  };
  await act(async () => root.render(createElement(RepositoryLinksContext.Provider, { value: links }, createElement(TooltipProvider, null, createElement(HistoryView, props)))));
  await act(async () => {
    for (const observer of [...observers]) {
      const entries = [...observer.elements].map(element => ({ target: element, borderBoxSize: [{ inlineSize: 500, blockSize: height(element as HTMLElement) }] } as unknown as ResizeObserverEntry));
      if (entries.length) observer.callback(entries, observer);
    }
  });
  return props;
}
async function mountAndExpand() {
  await mount();
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
async function setOption(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="History options"]')!.click());
  await act(async () => { await Promise.resolve(); });
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(item => item.textContent === label)!.click());
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => { await Promise.resolve(); });
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
  await setOption('Group merges');
  expect(container.querySelectorAll('.commit-item')).toHaveLength(3);
  expectNextRowBelowExpansion();
  await search('Merge');
  expect(container.querySelectorAll('.commit-item')).toHaveLength(4);
  expectNextRowBelowExpansion();
  await search('');
  expect(container.querySelectorAll('.commit-item')).toHaveLength(3);
  expectNextRowBelowExpansion();
  await setOption('Group merges');
  expect(container.querySelectorAll('.commit-item')).toHaveLength(4);
  expectNextRowBelowExpansion();
});

it('offers the row density from the menu and keeps the rows at that height', async () => {
  await mount();
  const list = () => container.querySelector<HTMLElement>('.history-list')!.style.getPropertyValue('--history-row-height');
  expect(list()).toBe('46px');
  await setOption('Compact');
  expect(list()).toBe('56px');
});

it('holds Group merges back until the loaded history has a merge', async () => {
  await mount({ commits: [commit('main', ['base'], 'Main'), commit('base', [], 'Base')] });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="History options"]')!.click());
  await act(async () => { await Promise.resolve(); });
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(option => option.textContent === 'Group merges')!;
  expect(item.getAttribute('aria-disabled')).toBe('true');
});

it('names each dot by whether its commit is published', async () => {
  await mount({ commits: [
    { ...commit('local', ['published'], 'Local'), upstreamState: 'local-only' },
    commit('published', ['unknown'], 'Published'),
    { ...commit('unknown', [], 'Unknown'), upstreamState: 'unknown' },
  ] });
  expect([...container.querySelectorAll('.commit-dot')].map(dot => [dot.getAttribute('role'), dot.getAttribute('aria-label')])).toEqual([
    ['img', 'Not published'], ['img', 'Published'], ['img', 'Publication unknown'],
  ]);
});

it('reads as one muted line ending in plain reference names, with no legend, counter or publish callout', async () => {
  await mount({ upstream: null, commits: [{ ...commit('head', ['base'], 'Head'), decorations: ['HEAD -> main', 'origin/main', 'tag: v1.0.0'] }, commit('base', [], 'Base')] });
  expect(container.querySelector('.commit-meta')?.textContent).toBe('01/01/2026·Sample author·headmain origin/main v1.0.0');
  expect(container.querySelector('.commit-meta')?.lastElementChild?.textContent).toBe('main origin/main v1.0.0');
  expect(container.textContent).not.toMatch(/Publish|loaded|Local\b/);
});

it('selects a commit from anywhere in its row except the controls inside it', async () => {
  links.open.mockClear();
  const props = await mount({ commits: [{ ...commit('head', ['base'], 'Fix the thing (#87)') }, commit('base', [], 'Base')] });
  const row = container.querySelector('.commit-item')!;
  await act(async () => row.querySelector<HTMLElement>('.commit-subject')!.click());
  expect(props.onSelectCommit).toHaveBeenCalledTimes(1);
  await act(async () => row.querySelector<HTMLElement>('time')!.click());
  expect(props.onSelectCommit).toHaveBeenCalledTimes(2);
  await act(async () => row.querySelector<HTMLElement>('[aria-label="Expand commit"]')!.click());
  await act(async () => row.querySelector<HTMLElement>('[aria-label="Copy hash head"]')!.click());
  expect(props.onSelectCommit).toHaveBeenCalledTimes(2);
  // Like the branch's pull request, the reference asks where to open it.
  await act(async () => row.querySelector<HTMLElement>('[aria-label="Open pull request #87"]')!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent?.includes('Open in OpenTig'));
  expect([...document.querySelectorAll('[role="menuitem"]')].map(element => element.textContent?.trim())).toEqual(['Open in OpenTig', 'Open in GitHub']);
  await act(async () => item!.click());
  expect(links.open).toHaveBeenCalledWith({ kind: 'pull', number: 87 });
  expect(props.onSelectCommit).toHaveBeenCalledTimes(2);
});

it('offers undo only on the latest local commit, without selecting it', async () => {
  const head = { ...commit('head', ['older'], 'Head'), upstreamState: 'local-only' as const, isHead: true };
  const older = { ...commit('older', [], 'Older'), upstreamState: 'local-only' as const };
  const props = await mount({ readOnly: false, commits: [head, older] });
  expect(container.querySelectorAll('.commit-undo')).toHaveLength(1);
  await act(async () => container.querySelector<HTMLElement>('[aria-label="Undo commit head"]')!.click());
  expect(props.onUndo).toHaveBeenCalledWith(head);
  expect(props.onSelectCommit).not.toHaveBeenCalled();
});

it('counts matches in the field and steps through them from the next-match button', async () => {
  await mount();
  await search('feature');
  const count = () => container.querySelector('.history-search .plain-count')?.textContent;
  expect(count()).toBe('2 matches');
  expect(container.querySelectorAll('.commit-search-match')).toHaveLength(2);
  const next = () => container.querySelector<HTMLElement>('[aria-label="Next matching commit"]')!;
  await act(async () => next().click());
  expect(count()).toBe('1 of 2');
  expect(container.querySelector('.commit-current-match .commit-subject')?.textContent).toBe('Merge feature');
  await act(async () => next().click());
  expect(count()).toBe('2 of 2');
  expect(container.querySelector('.commit-current-match .commit-subject')?.textContent).toBe('Feature');
  await act(async () => next().click());
  expect(count()).toBe('1 of 2');
  await search('');
  expect(count()).toBeUndefined();
  expect(container.querySelector('[aria-label="Next matching commit"]')).toBeNull();
});

it('loads more from a quiet row at the end of the list', async () => {
  const props = await mount({ nextCursor: 'base' });
  const more = container.querySelector<HTMLButtonElement>('.history-more')!;
  expect(more.textContent).toBe('Load more');
  await act(async () => more.click());
  expect(props.onMore).toHaveBeenCalledTimes(1);
  await mount({ nextCursor: 'base', loading: true });
  expect(container.querySelector<HTMLButtonElement>('.history-more')!.disabled).toBe(true);
  await mount({ nextCursor: null });
  expect(container.querySelector('.history-more')).toBeNull();
});

it('displays an oversized response fully and keeps it in the mounted row without caching it', async () => {
  // Few rows with long paths exceed the per-entry cache budget without rendering hundreds of rows.
  const count = 20;
  const directories = 'directory/'.repeat(Math.ceil(COMMIT_FILES_CACHE_MAX_ENTRY_BYTES / count / 2 / 'directory/'.length));
  const files: CommitFile[] = Array.from({ length: count }, (_, index) => ({
    path: `src/${directories}file-${index}.ts`, oldPath: null, kind: 'modified', additions: 1, deletions: 0, binary: false,
  }));
  filesRequest.mockResolvedValue(files);
  await mountAndExpand();
  expect(readCommitFilesCache('history-measure-test:merge')).toBeUndefined();
  expect(container.querySelector('.commit-files-summary')?.textContent).toContain(`${count} files`);
  expect(container.querySelectorAll('.commit-file-row')).toHaveLength(count);
  expect(container.querySelector('.commit-files')?.textContent).toContain(`file-${count - 1}.ts`);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse commit"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand commit"]')!.click());
  expect(container.querySelectorAll('.commit-file-row')).toHaveLength(count);
  expect(filesRequest).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  await mountAndExpand();
  expect(filesRequest).toHaveBeenCalledTimes(2);
  expect(container.querySelectorAll('.commit-file-row')).toHaveLength(count);
});

describe('on a phone', () => {
  const localHead = { ...commit('head', ['base'], 'Add a filter (#7)'), upstreamState: 'local-only' as const, isHead: true, decorations: ['HEAD -> main', 'tag: v1'] };

  it('shows a row as a dot, a title and one line, with the row as its only target', async () => {
    mobile = true;
    const props = await mount({ commits: [localHead], readOnly: false });
    const row = container.querySelector<HTMLElement>('.commit-item')!;
    expect(row.querySelector('.commit-dot')).not.toBeNull();
    expect(row.querySelector('.commit-subject')?.textContent).toBe('Add a filter (#7)');
    expect(row.querySelector('.commit-meta')?.textContent).toBe('01/01/2026·Sample author·head·Not published·#7main v1');
    expect([...row.querySelectorAll('button')].map((button) => button.className)).toEqual(['commit-subject']);
    await act(async () => row.querySelector<HTMLElement>('.commit-meta')!.click());
    expect(props.onSelectCommit).toHaveBeenCalledWith(localHead);
    expect(filesRequest).not.toHaveBeenCalled();
  });

  it('moves undoing and expanding off the row', async () => {
    mobile = true;
    await mount({ commits: [localHead], readOnly: false });
    expect(container.querySelector('[aria-label^="Undo commit"]')).toBeNull();
    expect(container.querySelector('.commit-expand')).toBeNull();
    expect(container.querySelector('.commit-row-actions')).toBeNull();
  });

  it('keeps them on the row elsewhere', async () => {
    await mount({ commits: [localHead], readOnly: false });
    expect(container.querySelector('[aria-label^="Undo commit"]')).not.toBeNull();
    expect(container.querySelector('.commit-expand')).not.toBeNull();
  });

  it('groups merges from a sheet', async () => {
    mobile = true;
    await mount();
    expect(container.querySelectorAll('.commit-item')).toHaveLength(4);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="History options"]')!.click());
    expect(document.querySelector('.mobile-sheet-title')?.textContent).toBe('History');
    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
    const group = document.querySelector<HTMLButtonElement>('.mobile-sheet [role="switch"]')!;
    expect(group.textContent).toBe('Group merges');
    await act(async () => group.click());
    expect(group.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelectorAll('.commit-item')).toHaveLength(3);
    expect(container.querySelector('.commit-meta')?.textContent).toContain('1 grouped');
  });

  it('keeps Group merges off while the loaded history has no merge', async () => {
    mobile = true;
    await mount({ commits: commits.slice(1) });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="History options"]')!.click());
    expect(document.querySelector<HTMLButtonElement>('.mobile-sheet [role="switch"]')!.disabled).toBe(true);
  });
});
