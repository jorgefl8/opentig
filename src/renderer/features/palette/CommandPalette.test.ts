// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeEntry, RepositoryStatus } from '@shared/git-types';
import { CommandPalette } from './CommandPalette';
import type { PaletteActions, PaletteMode, PaletteState } from './palette-types';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const file = (path: string): FileTreeEntry => ({ path, name: path.split('/').at(-1)!, type: 'file', size: 1, mtimeMs: 0 });
const onClose = vi.fn();
const actions = {
  showSection: vi.fn(), openFile: vi.fn(), openCommit: vi.fn(), openPullRequest: vi.fn(), openRun: vi.fn(), openPlace: vi.fn(),
  switchBranch: vi.fn(), openWorktree: vi.fn(), openRepository: vi.fn(), pull: vi.fn(), push: vi.fn(), refresh: vi.fn(),
  discardUnstaged: vi.fn(), createPullRequest: vi.fn(), addRepository: vi.fn(), openSettings: vi.fn(), openOnGitHub: vi.fn(),
  searchInFiles: vi.fn(), loadCommits: vi.fn(), recentPlaces: vi.fn(() => []),
} satisfies PaletteActions;
const status: RepositoryStatus = {
  branch: 'main', oid: 'a'.repeat(40), upstream: 'origin/main', ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};
function state(files: FileTreeEntry[], overrides: Partial<PaletteState> = {}): PaletteState {
  return {
    repositoryId: 'repo', repositoryName: 'sample', view: 'files', mobile: false, desktop: false, files, includeIgnored: false, activePath: null,
    status, unconfirmed: false, busy: null, syncBusy: false, publishBranch: false, branches: [], worktrees: [], commits: null,
    github: null, githubReady: false, pulls: null, pullsLoading: false, pullsError: null, createPullRequestBlocked: null,
    repositories: [], unavailableRepositories: new Set(), keys: { refresh: 'Ctrl+R', openRepository: 'Ctrl+O' },
    ...overrides,
  };
}
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
async function mount(files: FileTreeEntry[], mode: PaletteMode = 'files', overrides: Partial<PaletteState> = {}) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(CommandPalette, { request: { mode, id: 1 }, state: state(files, overrides), actions, onClose })));
  });
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(key: string, init: KeyboardEventInit = {}) {
  await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  actions.openFile.mockReturnValue(true);
  actions.recentPlaces.mockReturnValue([]);
  client = new QueryClient();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  client.clear();
  container.remove(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps arrow/Enter file opening and Escape dismissal available after filtering', async () => {
  await mount([file('src/App.tsx'), file('test/App.tsx'), file('README.md')]);
  await type('app');
  expect(options()).toHaveLength(2);
  await key('ArrowDown');
  await key('Enter');
  expect(actions.openFile).toHaveBeenCalledExactlyOnceWith('test/App.tsx', null);
  expect(onClose).toHaveBeenCalled();
  onClose.mockClear();
  await key('Escape');
  expect(onClose).toHaveBeenCalled();
});

it('opens a file at the line written after its name, and only at a line', async () => {
  await mount([file('src/filter-tasks.js'), file('README.md')]);
  await type('filter:9');
  expect(options().map((option) => option.textContent)).toEqual([expect.stringContaining('Open at line 9')]);
  await key('Enter');
  expect(actions.openFile).toHaveBeenCalledExactlyOnceWith('src/filter-tasks.js', 9);
});

it('keeps a rejected file open request in the palette', async () => {
  actions.openFile.mockReturnValue(false);
  await mount([file('App.tsx')]);
  await type('app');
  await key('Enter');
  expect(actions.openFile).toHaveBeenCalledExactlyOnceWith('App.tsx', null);
  expect(onClose).not.toHaveBeenCalled();
});

it('does not open stale rows or IME confirmation while a large search is pending', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => { now += 4; return now; });
  await mount(Array.from({ length: 10_000 }, (_, i) => file(`src/Component${i}.tsx`)));
  await type('component9.tsx');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Searching files…');
  expect(options()).toHaveLength(0);
  await key('Enter');
  expect(actions.openFile).not.toHaveBeenCalled();
  await type('component10.tsx');
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(options()[0]?.textContent).toContain('Component10.tsx');
  await key('Enter', { isComposing: true, keyCode: 229 } as KeyboardEventInit);
  expect(actions.openFile).not.toHaveBeenCalled();
  await key('Enter');
  expect(actions.openFile).toHaveBeenCalledExactlyOnceWith('src/Component10.tsx', null);
});

it('changes what it searches by a sign typed first, by Tab, by a click, and back to files by Backspace', async () => {
  await mount([file('README.md')]);
  expect(selectedTab()).toBe('Files');
  const listbox = document.querySelector('[role="listbox"]')!;
  expect(listbox.getAttribute('aria-label')).toBe('Repository files');
  for (const tab of document.querySelectorAll('[role="tab"]')) expect(tab.getAttribute('aria-controls')).toBe(listbox.id);
  await type('>');
  expect(selectedTab()).toBe('Commands>');
  expect(input().value).toBe('');
  await key('Tab');
  expect(selectedTab()).toBe('Branches@');
  await key('Tab', { shiftKey: true });
  await key('Tab', { shiftKey: true });
  expect(selectedTab()).toBe('Files');
  await act(async () => { document.querySelector<HTMLElement>('[role="tab"]:nth-child(5)')!.click(); });
  expect(selectedTab()).toBe('PRs#');
  await key('Backspace');
  expect(selectedTab()).toBe('Files');
});

it('reads a sign as text once something is typed, and never takes away more of it', async () => {
  await mount([file('README.md')], 'commands');
  // Pasted into the empty field, the first sign picks the tab and the second is text.
  await type('>>pull');
  expect(selectedTab()).toBe('Commands>');
  expect(input().value).toBe('>pull');
  await type('>pul');
  expect(input().value).toBe('>pul');
  await type('#24');
  expect(selectedTab()).toBe('Commands>');
});

it('shows why a command can’t run, and choosing it does nothing', async () => {
  await mount([], 'commands', { status: { ...status, behind: 0 } });
  await type('pull');
  const pull = options().find((option) => option.textContent?.startsWith('Pull'))!;
  expect(pull.textContent).toContain('Nothing to pull');
  expect(pull.getAttribute('aria-disabled')).toBe('true');
  await key('Enter');
  expect(actions.pull).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('offers to search inside files when no file name matches, with the text as typed', async () => {
  await mount([file('README.md')]);
  await type('needle (x');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No files match “needle (x”');
  await key('Enter');
  expect(actions.searchInFiles).toHaveBeenCalledExactlyOnceWith('needle (x');
});

it('asks for the history once when the commits tab opens before History was read', async () => {
  await mount([], 'commits');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Loading commits…');
  await type('fix');
  await type('fix the');
  expect(actions.loadCommits).toHaveBeenCalledTimes(1);
});
