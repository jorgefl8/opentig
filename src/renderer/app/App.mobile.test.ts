// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';

const calls = vi.hoisted(() => ({ bootstrap: vi.fn(), status: vi.fn(), setPreferences: vi.fn(), viewer: vi.fn(), toolbar: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {}, setPreferences: calls.setPreferences },
    repository: { getStatus: calls.status, fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: async () => [] },
    refs: { fetch: async () => ({ status: 'success', ahead: 0, behind: 0 }), listBranches: async () => [], listWorktrees: async () => [] },
    github: { status: async () => ({ installed: false }), repositoryInfo: async () => ({ isGitHub: false, nameWithOwner: null }) },
    commits: { list: async () => ({ commits: [], nextCursor: null }) },
    diagnostics: { record: async () => {} },
    events: { onGitHubAccountsChanged: () => () => {}, onRepositoryChanged: () => () => {}, onActiveRepositoryChanged: () => () => {} },
  },
  serverClient: { transport: { subscribeState: () => () => {}, getState: () => 'connected' } },
}));
vi.mock('@/features/settings/update-api', () => ({ updatesApi: () => ({ check: async () => ({ phase: 'idle' }) }) }));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('sileo', () => ({ sileo: { error: () => {}, dismiss: () => {} } }));
vi.mock('./Toolbar', () => ({ Toolbar: (props: ToolbarProps) => { calls.toolbar(props); return null; } }));
vi.mock('@/features/changes/ChangesView', () => ({ ChangesView: () => null }));
vi.mock('@/lib/use-mobile-layout', () => ({ useMobileLayout: () => true }));
vi.mock('@/features/viewer/Viewer', () => ({ default: (props: unknown) => { calls.viewer(props); return null; } }));
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import App from './App';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const status: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, stagedCount: 2, unstagedCount: 0,
  changes: [{ path: 'a.js', indexStatus: 'M', worktreeStatus: '.', kind: 'modified', staged: true, unstaged: false, conflict: false }, { path: 'b.js', indexStatus: 'M', worktreeStatus: '.', kind: 'modified', staged: true, unstaged: false, conflict: false }],
} as unknown as RepositoryStatus;

async function mount(current: RepositoryStatus = status) {
  calls.status.mockResolvedValue(current);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  for (let tick = 0; tick < 20; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  await act(async () => container.querySelector<HTMLButtonElement>('.mobile-navigation button')!.click());
}
const lastViewerProps = () => calls.viewer.mock.lastCall![0] as { diffView: string; wrapLines: boolean; onWrapLinesChange(value: boolean): void; onDiffViewChange(value: string): void };
const pill = () => container.querySelector<HTMLButtonElement>('.mobile-float .mobile-main-action');
const textarea = () => document.querySelector<HTMLTextAreaElement>('.mobile-sheet textarea');
const dismiss = async () => {
  await act(async () => document.querySelector<HTMLButtonElement>('.mobile-sheet-close')!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const preferences = { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0, diffView: 'split' as const, wrapLines: false };
  calls.bootstrap.mockResolvedValue({
    activeRepository: { id: 'repo', path: '/sample', commonDir: '/sample/.git', name: 'sample', repositoryName: 'sample' },
    recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [], preferences,
  });
  calls.setPreferences.mockImplementation(async (partial: object) => ({ ...preferences, ...partial }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('shows no page title, and floats one commit action that counts the staged files', async () => {
  await mount();
  expect(container.querySelector('.mobile-view-heading')).toBeNull();
  expect(container.querySelectorAll('.mobile-float > *')).toHaveLength(1);
  expect(pill()?.textContent).toBe('Commit 2 files');
  expect(container.querySelector('.commit-composer')).toBeNull();
});

it('floats nothing with nothing staged', async () => {
  await mount({ ...status, stagedCount: 0, changes: [] });
  expect(pill()).toBeNull();
});

it('commits from a sheet, and the message outlives closing it', async () => {
  await mount();
  await act(async () => pill()!.click());
  expect(document.querySelector('.mobile-sheet-title')?.textContent).toBe('Commit 2 files');
  await act(async () => {
    const input = textarea()!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Add a filter');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await dismiss();
  expect(textarea()).toBeNull();
  await act(async () => pill()!.click());
  expect(textarea()!.value).toBe('Add a filter');
});

it('reads inline and wraps on a phone without touching the saved desktop choices', async () => {
  await mount();
  expect(lastViewerProps().diffView).toBe('unified');
  expect(lastViewerProps().wrapLines).toBe(true);
  await act(async () => lastViewerProps().onWrapLinesChange(false));
  expect(lastViewerProps().wrapLines).toBe(false);
  expect(calls.setPreferences).not.toHaveBeenCalled();
});

it('takes a Settings change to wrapping as the session\'s, and saves anything else', async () => {
  await mount();
  const toolbar = () => calls.toolbar.mock.lastCall![0] as ToolbarProps;
  expect(toolbar().preferences.wrapLines).toBe(true);
  await act(async () => { await toolbar().onPreference({ wrapLines: false }); });
  expect(toolbar().preferences.wrapLines).toBe(false);
  expect(lastViewerProps().wrapLines).toBe(false);
  expect(calls.setPreferences).not.toHaveBeenCalled();
  await act(async () => { await toolbar().onPreference({ wrapLines: true, theme: 'dark' }); });
  expect(toolbar().preferences.wrapLines).toBe(true);
  expect(calls.setPreferences).toHaveBeenCalledExactlyOnceWith({ theme: 'dark' });
});

it('scales code by Interface size through its text, since the phone layout never zooms', async () => {
  await mount();
  expect(document.documentElement.style.getPropertyValue('--mobile-code-scale')).toBe('1');
});
