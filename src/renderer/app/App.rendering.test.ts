// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { CommitInfo, CommitPage, FileChange, RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import type { ChangesView } from '@/features/changes/ChangesView';
import type { FilesViewProps } from '@/features/files/FilesView';
import type { HistoryView } from '@/features/history/HistoryView';
import type { SearchView } from '@/features/search/SearchView';
import { SettingsStore } from '../../main/persistence/SettingsStore';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), setPreferences: vi.fn(), status: vi.fn(), fetch: vi.fn(), checkUpdates: vi.fn(), error: vi.fn(), renders: vi.fn(), history: vi.fn(), toolbar: vi.fn(), viewer: vi.fn(),
  /** Each memoized stand-in below reports its name here when it redraws. */
  section: vi.fn(),
  repositoryChanged: [] as ((repositoryId: string, scope: string) => void)[],
}));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, setPreferences: calls.setPreferences, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {}, setOpenFilesState: async () => {} },
    repository: { getStatus: calls.status, fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: async () => [] },
    refs: { fetch: calls.fetch, listBranches: async () => [], listWorktrees: async () => [] },
    github: { status: async () => ({ installed: false }), repositoryInfo: async () => ({ isGitHub: false, nameWithOwner: null }) },
    diagnostics: { record: async () => {} },
    events: {
      onGitHubAccountsChanged: () => () => {}, onActiveRepositoryChanged: () => () => {}, onReconnected: () => () => {},
      onRepositoryChanged: (listener: (repositoryId: string, scope: string) => void) => {
        calls.repositoryChanged.push(listener);
        return () => { calls.repositoryChanged.splice(calls.repositoryChanged.indexOf(listener), 1); };
      },
    },
  },
  serverClient: { transport: { subscribeState: () => () => {}, getState: () => 'connected' }, connection: { current: () => null, subscribe: () => () => {} } },
}));
vi.mock('@/features/settings/update-api', () => ({ updatesApi: () => ({ check: calls.checkUpdates }) }));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('sileo', () => ({ sileo: { error: calls.error, dismiss: () => {} } }));
// Memoized, as the real toolbar and viewer are, so the tests see what App makes them redraw.
vi.mock('./Toolbar', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { Toolbar: memo((props: ToolbarProps) => { calls.toolbar(); return createElement('header', null,
    createElement('button', { 'aria-label': 'Refresh', disabled: Boolean(props.busy), onClick: props.onRefresh }, 'Refresh'),
    createElement('button', { 'aria-label': 'Settings', onClick: () => props.onSettingsOpen(true) }, 'Settings'),
    createElement('output', null, `Behind: ${props.status?.behind ?? 0}`),
  ); }) };
});
// The sections and the commit box are memoized too, so the tests see which of them App makes redraw.
// Each offers the one action a test takes through it, which calls the handler App gave it.
vi.mock('@/features/changes/ChangesView', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { ChangesView: memo((props: ComponentProps<typeof ChangesView>) => { calls.section('changes'); return createElement('section', { 'aria-label': 'Changes' },
    createElement('button', { onClick: () => props.onSelect('changed.txt', 'unstaged') }, 'Select changed.txt'),
    createElement('output', null, `${props.changeCount} changes, selected: ${props.selection?.path ?? 'none'}`),
  ); }) };
});
vi.mock('@/features/commit/StoredCommitComposer', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { StoredCommitComposer: memo(() => { calls.section('commit'); return null; }) };
});
vi.mock('@/lib/use-mobile-layout', () => ({ useMobileLayout: () => { calls.renders(); return false; } }));
vi.mock('@/features/files/FilesView', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { FilesView: memo((props: FilesViewProps) => { calls.section('files'); return createElement('section', { 'aria-label': 'Files' },
    createElement('button', { onClick: () => props.onOpenFile('notes.txt') }, 'Open notes.txt'),
    createElement('output', null, `open: ${props.activePath ?? 'none'}`),
  ); }) };
});
vi.mock('@/features/history/HistoryView', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { HistoryView: memo((props: ComponentProps<typeof HistoryView>) => { calls.history(props.commits); calls.section('history'); return createElement('section', { 'aria-label': 'History' },
    createElement('button', { onClick: () => props.onSelectCommit(sampleCommit) }, 'Select a commit'),
    createElement('output', null, `active: ${props.activeOid ?? 'none'}`),
  ); }) };
});
vi.mock('@/features/search/SearchView', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { SearchView: memo((props: ComponentProps<typeof SearchView>) => { calls.section('search'); return createElement('output', { 'aria-label': 'Search' }, `revision ${props.revision}`); }) };
});
vi.mock('@/features/pulls/PullRequestsView', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { PullRequestsView: memo(() => { calls.section('prs'); return null; }) };
});
vi.mock('@/features/palette/CommandPalette', () => ({
  CommandPalette: (props: { onClose(): void }) => createElement('button', { 'aria-label': 'Close the palette', onClick: props.onClose }, 'Palette'),
}));
vi.mock('@/features/viewer/Viewer', async () => {
  const { memo } = await vi.importActual<typeof import('react')>('react');
  return { default: memo(() => { calls.viewer(); return null; }) };
});
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import { queryKeys } from '@/lib/query-client';
import App from './App';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const sampleCommit: CommitInfo = {
  oid: 'commit-1', shortOid: 'c1', subject: 'First', body: '', author: 'Author', email: '',
  date: '2026-01-01', decorations: [], parentOids: [], parentCount: 0, upstreamState: 'unknown', isHead: true,
};
const changedFile: FileChange = { path: 'changed.txt', indexStatus: ' ', worktreeStatus: 'M', kind: 'modified', staged: false, unstaged: true, conflict: false, submodule: '' };
const initialStatus: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  calls.bootstrap.mockResolvedValue({
    activeRepository: { id: 'repo', path: '/sample', commonDir: '/sample/.git', name: 'sample', repositoryName: 'sample' },
    recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
  });
  calls.status.mockResolvedValue(initialStatus);
  calls.setPreferences.mockImplementation(async (partial: object) => ({ ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0, ...partial }));
  calls.fetch.mockResolvedValue({ status: 'success', ahead: 0, behind: 2 });
  calls.checkUpdates.mockResolvedValue({ phase: 'idle' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function key(type: 'keydown' | 'keyup', options: KeyboardEventInit) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options });
  await act(async () => { window.dispatchEvent(event); });
  return event;
}

it('shows the Ctrl hints without redrawing the app, including Alt/Meta and blur, and without consuming IME input', async () => {
  // The page carries the state, and the styles show each section's digit while it is there.
  const nav = () => document.documentElement;
  expect(container.querySelectorAll('nav[aria-label="Repository views"] .sidebar-tab-shortcut')).toHaveLength(5);
  calls.renders.mockClear();
  const composition = await key('keydown', { key: 'Process', isComposing: true });
  await key('keyup', { key: 'Process', isComposing: true });
  expect(composition.defaultPrevented).toBe(false);
  expect(calls.renders).not.toHaveBeenCalled();
  await key('keydown', { key: 'Control', ctrlKey: true });
  expect(nav()?.getAttribute('data-shortcuts')).toBe('visible');
  await key('keydown', { key: 'a', ctrlKey: true });
  await key('keyup', { key: 'a', ctrlKey: true });
  await key('keydown', { key: 'Control', ctrlKey: true, repeat: true });
  expect(calls.renders).not.toHaveBeenCalled();
  await key('keydown', { key: 'Alt', ctrlKey: true, altKey: true });
  expect(nav()?.hasAttribute('data-shortcuts')).toBe(false);
  await key('keyup', { key: 'Alt', ctrlKey: true });
  expect(nav()?.getAttribute('data-shortcuts')).toBe('visible');
  await key('keydown', { key: 'Meta', ctrlKey: true, metaKey: true });
  expect(nav()?.hasAttribute('data-shortcuts')).toBe(false);
  await key('keyup', { key: 'Meta', ctrlKey: true });
  await act(async () => { window.dispatchEvent(new Event('blur')); });
  expect(nav()?.hasAttribute('data-shortcuts')).toBe(false);
  await act(async () => { window.dispatchEvent(new Event('blur')); });
  await key('keyup', { key: 'Control' });
  // None of it redrew the app: pressing and releasing Ctrl changes nothing React knows about.
  expect(calls.renders).not.toHaveBeenCalled();
  await key('keydown', { key: '1', ctrlKey: true });
  expect(container.querySelector('[aria-keyshortcuts="Control+1"]')?.getAttribute('aria-current')).toBe('page');
});

it('keeps 5,000 loaded commits identical across UI renders and invalidates on page and external data changes', async () => {
  const commits: CommitInfo[] = Array.from({ length: 5000 }, (_, i) => ({
    oid: `commit-${i}`, shortOid: `${i}`, subject: `Subject ${i}`, body: '', author: 'Author', email: '',
    date: '2026-01-01', decorations: [], parentOids: [], parentCount: 0, upstreamState: 'unknown', isHead: i === 0,
  }));
  const page: CommitPage = { commits, nextCursor: null };
  const data = { pages: [page], pageParams: [undefined] };
  await act(async () => { client.setQueryData(queryKeys.history('repo', 'branch:main'), data); });
  await key('keydown', { key: '3', ctrlKey: true });
  await settle();
  const loaded = calls.history.mock.lastCall![0];
  expect(loaded).toEqual(commits);
  await key('keyup', { key: 'Control' });
  expect(calls.history.mock.lastCall![0]).toBe(loaded);
  await key('keydown', { key: 'Control', ctrlKey: true });
  expect(calls.history.mock.lastCall![0]).toBe(loaded);
  await act(async () => {
    client.setQueryData(queryKeys.history('repo', 'branch:main'), { ...data, pages: [page, { commits: [{ ...commits[0]!, oid: 'next-page' }], nextCursor: null }] });
    for (let hop = 0; hop < 5; hop++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const appended = calls.history.mock.lastCall![0];
  expect(appended).not.toBe(loaded);
  expect(appended).toHaveLength(5001);
  await act(async () => {
    client.setQueryData(queryKeys.history('repo', 'branch:main'), { ...data, pages: [{ ...page, commits: [{ ...commits[0]!, subject: 'External update' }] }] });
    for (let hop = 0; hop < 5; hop++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(calls.history.mock.lastCall![0]).toEqual([expect.objectContaining({ subject: 'External update' })]);
});

it('collapses the sidebar to a rail and opens it again on a section', async () => {
  const sidebar = () => container.querySelector('aside.sidebar')!;
  const rail = () => container.querySelector('.sidebar-rail');
  expect(sidebar().hasAttribute('data-collapsed')).toBe(false);
  expect(container.querySelector('[role="separator"][aria-label="Resize sidebar"]')).not.toBeNull();

  const toggle = await key('keydown', { key: 'b', ctrlKey: true });
  expect(toggle.defaultPrevented).toBe(true);
  expect(sidebar().hasAttribute('data-collapsed')).toBe(true);
  expect(rail()).not.toBeNull();
  expect(container.querySelector('[role="separator"][aria-label="Resize sidebar"]')).toBeNull();
  expect(calls.setPreferences).toHaveBeenLastCalledWith({ sidebarCollapsed: true });

  await act(async () => { rail()!.querySelector<HTMLButtonElement>('[aria-keyshortcuts="Control+3"]')!.click(); });
  expect(sidebar().hasAttribute('data-collapsed')).toBe(false);
  expect(calls.setPreferences).toHaveBeenLastCalledWith({ sidebarCollapsed: false });
  expect(container.querySelector('.sidebar-tabs [aria-keyshortcuts="Control+3"]')?.getAttribute('aria-current')).toBe('page');

  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')!.click(); });
  expect(sidebar().hasAttribute('data-collapsed')).toBe(true);
  await key('keydown', { key: '1', ctrlKey: true });
  expect(sidebar().hasAttribute('data-collapsed')).toBe(false);
  expect(container.querySelector('.sidebar-tabs [aria-keyshortcuts="Control+1"]')?.getAttribute('aria-current')).toBe('page');
});

it('resizes the sidebar from its edge with the keyboard', async () => {
  const handle = container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize sidebar"]')!;
  expect(handle.getAttribute('aria-valuenow')).toBe('400');
  await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  expect(calls.setPreferences).toHaveBeenLastCalledWith({ sidebarWidth: 416 });
  expect((container.querySelector('aside.sidebar') as HTMLElement).style.width).toBe('416px');
  await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
  expect(calls.setPreferences).toHaveBeenLastCalledWith({ sidebarWidth: 300 });
});

it('redraws the toolbar but not the viewer for a new status, and neither for another section', async () => {
  await settle();
  expect(calls.viewer).toHaveBeenCalled();
  calls.toolbar.mockClear();
  calls.viewer.mockClear();
  calls.status.mockResolvedValue({ ...initialStatus, behind: 2 });
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click(); });
  await settle();
  expect(container.textContent).toContain('Behind: 2');
  expect(calls.toolbar).toHaveBeenCalled();
  expect(calls.viewer).not.toHaveBeenCalled();

  calls.toolbar.mockClear();
  const files = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Repository views"] button')].find((button) => button.textContent?.includes('Files'))!;
  await act(async () => files.click());
  await settle();
  expect(calls.toolbar).not.toHaveBeenCalled();
  expect(calls.viewer).not.toHaveBeenCalled();
});

async function settle() { await act(async () => { for (let hop = 0; hop < 5; hop++) await new Promise((resolve) => setTimeout(resolve, 0)); }); }

/** The memoized stand-ins that redrew while `action` ran, by name. */
async function redrawnBy(action: () => Promise<void> | void): Promise<string[]> {
  await settle();
  calls.section.mockClear();
  await act(async () => { await action(); });
  await settle();
  return [...new Set(calls.section.mock.calls.map(([name]) => name as string))].sort();
}
const click = (name: string) => () => {
  [...container.querySelectorAll('button')].find((button) => button.textContent === name || button.getAttribute('aria-label') === name)!.click();
};
/** A background refresh, as the server reports a change in the working tree. */
const worktreeChanged = () => { for (const listener of [...calls.repositoryChanged]) listener('repo', 'worktree'); };

async function openEverySection() {
  await settle();
  for (const digit of ['1', '2', '3', '4', '5', '1']) {
    await key('keydown', { key: digit, ctrlKey: true });
    await key('keyup', { key: 'Control' });
    await settle();
  }
  expect(calls.section.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(['changes', 'files', 'history', 'search', 'prs', 'commit']));
}

it('redraws each section for what it shows, and none of them for what another section or a dialog changes', async () => {
  // The open-files strip brings the opened file's tab into view, which jsdom does not lay out.
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
  await openEverySection();

  // A new changed file: Changes and the commit box list it, and Search reads its results again.
  calls.status.mockResolvedValue({ ...initialStatus, changes: [changedFile], unstagedCount: 1 });
  expect(await redrawnBy(worktreeChanged)).toEqual(['changes', 'commit', 'search']);
  expect(container.textContent).toContain('1 changes, selected: none');

  // A row chosen in Changes is marked there, and nowhere else changes.
  expect(await redrawnBy(click('Select changed.txt'))).toEqual(['changes']);
  expect(container.textContent).toContain('selected: changed.txt');

  // A commit chosen in History: Changes no longer marks a row.
  expect(await redrawnBy(click('Select a commit'))).toEqual(['changes', 'history']);
  expect(container.textContent).toContain('active: commit-1');

  // A file that is not among the changes, opened in Files, changes Files alone.
  expect(await redrawnBy(click('Open notes.txt'))).toEqual(['files', 'history']);
  expect(container.textContent).toContain('open: notes.txt');
  expect(await redrawnBy(click('Select a commit'))).toEqual(['files', 'history']);

  // Another section shows what it last showed, here nothing: History no longer marks its commit.
  const section = (digit: string) => async () => { await key('keydown', { key: digit, ctrlKey: true }); await key('keyup', { key: 'Control' }); };
  expect(await redrawnBy(section('4'))).toEqual(['history']);
  // Search takes the keyboard when it shows; the others are left as they are.
  expect(await redrawnBy(section('5'))).toEqual(['search']);
  // Settings and the palette show nothing a section shows.
  expect(await redrawnBy(click('Settings'))).toEqual([]);
  expect(await redrawnBy(section('k'))).toEqual([]);
  expect(container.querySelector('[aria-label="Close the palette"]')).not.toBeNull();
  expect(await redrawnBy(click('Close the palette'))).toEqual([]);
});
