// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';
import { SECTION_REFRESH_MIN_INTERVAL_MS } from './refresh-policy';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), status: vi.fn(), fetch: vi.fn(), files: vi.fn(), branches: vi.fn(), worktrees: vi.fn(), history: vi.fn(), repositoryInfo: vi.fn(),
}));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {} },
    repository: { getStatus: calls.status, fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: calls.files },
    refs: { fetch: calls.fetch, listBranches: calls.branches, listWorktrees: calls.worktrees, worktreeAgents: async () => [] },
    commits: { list: calls.history },
    github: { status: async () => ({ installed: false }), repositoryInfo: calls.repositoryInfo },
    diagnostics: { record: async () => {} },
    events: { onGitHubAccountsChanged: () => () => {}, onRepositoryChanged: () => () => {}, onActiveRepositoryChanged: () => () => {} },
  },
  serverClient: { transport: { subscribeState: () => () => {}, getState: () => 'connected' } },
}));
vi.mock('@/features/settings/update-api', () => ({ updatesApi: () => ({ check: async () => ({ phase: 'idle' }) }) }));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('sileo', () => ({ sileo: { error: () => {}, dismiss: () => {} } }));
vi.mock('./Toolbar', () => ({ Toolbar: (props: ToolbarProps) => createElement('header', null,
  createElement('output', null, props.busy ? `Busy: ${props.busy}` : 'Idle'),
) }));
vi.mock('@/features/changes/ChangesView', () => ({ ChangesView: () => null }));
vi.mock('@/features/commit/CommitComposer', () => ({ CommitComposer: () => null }));
vi.mock('@/features/files/FilesView', () => ({ FilesView: () => null }));
vi.mock('@/features/history/HistoryView', () => ({ HistoryView: () => null }));
vi.mock('@/features/search/SearchView', () => ({ SearchView: () => null }));
vi.mock('@/features/viewer/Viewer', () => ({ default: () => null }));
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import App from './App';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const status: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};
const section = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Repository views"] button')].find((button) => button.textContent?.includes(name))!;
const open = (name: string) => act(async () => section(name).click());
const requests = () => Object.fromEntries(Object.entries(calls).flatMap(([name, mock]) => name === 'bootstrap' || !mock.mock.calls.length ? [] : [[name, mock.mock.calls.length]]));

beforeEach(async () => {
  localStorage.clear();
  // The section the app was left on, where it opens again.
  localStorage.setItem('opentig.lastView', 'changes');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  calls.bootstrap.mockResolvedValue({
    activeRepository: { id: 'repo', path: '/sample', commonDir: '/sample/.git', name: 'sample', repositoryName: 'sample' },
    recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    // The default interval: fetching in the background is on, as it is for users.
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 30 },
  });
  calls.status.mockResolvedValue(status);
  calls.fetch.mockResolvedValue({ status: 'success', ahead: 0, behind: 0 });
  calls.files.mockResolvedValue([]);
  calls.branches.mockResolvedValue([]);
  calls.worktrees.mockResolvedValue([]);
  calls.history.mockResolvedValue({ commits: [], nextCursor: null });
  calls.repositoryInfo.mockResolvedValue({ isGitHub: false, nameWithOwner: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  // The repository is open and its first fetch has come back.
  expect(calls.fetch).toHaveBeenCalledOnce();
  for (const mock of Object.values(calls)) mock.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('opens other sections without fetching, reading the repository again or holding the toolbar', async () => {
  // A read that never answers would keep the toolbar busy for as long as it ran.
  calls.status.mockReturnValue(new Promise(() => {}));
  await open('History');
  expect(container.querySelector('output')?.textContent).toBe('Idle');
  await open('Search');
  await open('Changes');
  // History reads its own list the first time; nothing else is asked for.
  expect(requests()).toEqual({ history: 1 });
  await open('History');
  expect(requests()).toEqual({ history: 1 });
  expect(container.querySelector('output')?.textContent).toBe('Idle');
});

it('reads the file tree when Files opens, and not again while moving back and forth', async () => {
  await open('Files');
  expect(requests()).toEqual({ files: 1 });
  await open('Changes');
  await open('Files');
  expect(requests()).toEqual({ files: 1 });
});

it('brings a section up to date behind what it shows once the last read is no longer recent', async () => {
  vi.setSystemTime(Date.now() + SECTION_REFRESH_MIN_INTERVAL_MS);
  calls.status.mockResolvedValue({ ...status, behind: 3 });
  await open('Files');
  // One read of the status and the tree, in the background: no fetch, branches, worktrees or GitHub.
  expect(requests()).toEqual({ status: 1, files: 1 });
  expect(container.querySelector('output')?.textContent).toBe('Idle');
});
