// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommitInfo, CommitPage, RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), status: vi.fn(), fetch: vi.fn(), checkUpdates: vi.fn(), error: vi.fn(), renders: vi.fn(), history: vi.fn(),
}));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {} },
    repository: { getStatus: calls.status, fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: async () => [] },
    refs: { fetch: calls.fetch, listBranches: async () => [], listWorktrees: async () => [] },
    github: { status: async () => ({ installed: false }), repositoryInfo: async () => ({ isGitHub: false, nameWithOwner: null }) },
    diagnostics: { record: async () => {} },
    events: { onGitHubAccountsChanged: () => () => {}, onRepositoryChanged: () => () => {}, onActiveRepositoryChanged: () => () => {} },
  },
  serverClient: { transport: { subscribeState: () => () => {}, getState: () => 'connected' } },
}));
vi.mock('@/features/settings/update-api', () => ({ updatesApi: () => ({ check: calls.checkUpdates }) }));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('sileo', () => ({ sileo: { error: calls.error, dismiss: () => {} } }));
vi.mock('./Toolbar', () => ({ Toolbar: (props: ToolbarProps) => createElement('header', null,
  createElement('button', { 'aria-label': 'Refresh', disabled: Boolean(props.busy), onClick: props.onRefresh }, 'Refresh'),
  createElement('output', null, `Behind: ${props.status?.behind ?? 0}`),
) }));
vi.mock('@/features/changes/ChangesView', () => ({ ChangesView: () => null }));
vi.mock('@/features/commit/CommitComposer', () => ({ CommitComposer: () => null }));
vi.mock('@/lib/use-mobile-layout', () => ({ useMobileLayout: () => { calls.renders(); return false; } }));
vi.mock('@/features/files/FilesView', () => ({ FilesView: () => null }));
vi.mock('@/features/history/HistoryView', () => ({ HistoryView: (props: { commits: CommitInfo[] | null }) => { calls.history(props.commits); return null; } }));
vi.mock('@/features/viewer/Viewer', () => ({ default: () => null }));
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import { queryKeys } from '@/lib/query-client';
import App from './App';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
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

it('updates Ctrl hints only on transitions, including Alt/Meta and blur, without consuming IME input', async () => {
  const nav = () => container.querySelector('nav[aria-label="Repository views"]');
  calls.renders.mockClear();
  const composition = await key('keydown', { key: 'Process', isComposing: true });
  await key('keyup', { key: 'Process', isComposing: true });
  expect(composition.defaultPrevented).toBe(false);
  expect(calls.renders).not.toHaveBeenCalled();
  await key('keydown', { key: 'Control', ctrlKey: true });
  expect(nav()?.getAttribute('data-shortcuts')).toBe('visible');
  calls.renders.mockClear();
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
  calls.renders.mockClear();
  await act(async () => { window.dispatchEvent(new Event('blur')); });
  await key('keyup', { key: 'Control' });
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
  await act(async () => { client.setQueryData(queryKeys.history('repo'), data); });
  await key('keydown', { key: '3', ctrlKey: true });
  const loaded = calls.history.mock.lastCall![0];
  expect(loaded).toEqual(commits);
  await key('keyup', { key: 'Control' });
  expect(calls.history.mock.lastCall![0]).toBe(loaded);
  await key('keydown', { key: 'Control', ctrlKey: true });
  expect(calls.history.mock.lastCall![0]).toBe(loaded);
  await act(async () => {
    client.setQueryData(queryKeys.history('repo'), { ...data, pages: [page, { commits: [{ ...commits[0]!, oid: 'next-page' }], nextCursor: null }] });
    for (let hop = 0; hop < 5; hop++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const appended = calls.history.mock.lastCall![0];
  expect(appended).not.toBe(loaded);
  expect(appended).toHaveLength(5001);
  await act(async () => {
    client.setQueryData(queryKeys.history('repo'), { ...data, pages: [{ ...page, commits: [{ ...commits[0]!, subject: 'External update' }] }] });
    for (let hop = 0; hop < 5; hop++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(calls.history.mock.lastCall![0]).toEqual([expect.objectContaining({ subject: 'External update' })]);
});
