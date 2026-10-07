// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), status: vi.fn(), fetch: vi.fn(), checkUpdates: vi.fn(), error: vi.fn(),
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
vi.mock('@/features/viewer/Viewer', () => ({ default: () => null }));
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import App from './App';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const initialStatus: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};

beforeEach(async () => {
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

it('fetches with automatic checks off and shows the refreshed Git counts without waiting for updates', async () => {
  expect(calls.fetch).not.toHaveBeenCalled();
  expect(calls.checkUpdates).not.toHaveBeenCalled();
  calls.status.mockResolvedValue({ ...initialStatus, behind: 2 });
  calls.checkUpdates.mockReturnValue(new Promise(() => {}));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click());
  expect(calls.fetch).toHaveBeenCalledExactlyOnceWith('repo');
  expect(calls.checkUpdates).toHaveBeenCalledOnce();
  expect(container.querySelector('output')?.textContent).toBe('Behind: 2');
  expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
});

it('also performs both checks from Ctrl+R and ignores repeat key events', async () => {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true })));
  expect(calls.fetch).toHaveBeenCalledOnce();
  expect(calls.checkUpdates).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, repeat: true })));
  expect(calls.fetch).toHaveBeenCalledOnce();
});

it('keeps Refresh busy while fetching and prevents a second shortcut request', async () => {
  let completeFetch!: (value: { status: 'success'; ahead: number; behind: number }) => void;
  calls.fetch.mockReturnValue(new Promise((resolve) => { completeFetch = resolve; }));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click());
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')?.disabled).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true })));
  expect(calls.fetch).toHaveBeenCalledOnce();
  await act(async () => completeFetch({ status: 'success', ahead: 0, behind: 0 }));
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')?.disabled).toBe(false);
});

it('still refreshes local state and checks updates when fetching fails, without an update toast', async () => {
  calls.fetch.mockResolvedValue({ status: 'failed', message: 'Remote unavailable' });
  calls.checkUpdates.mockRejectedValue(new Error('Update service unavailable'));
  calls.status.mockResolvedValue({ ...initialStatus, behind: 1 });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click());
  expect(calls.checkUpdates).toHaveBeenCalledOnce();
  expect(container.querySelector('output')?.textContent).toBe('Behind: 1');
  expect(calls.error).toHaveBeenCalledOnce();
  expect(calls.error).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not fetch remote changes' }));
});
