// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GhCliStatus, PullRequestSummary } from '../../shared/contracts';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';
import { GhOperationError } from '../../shared/errors';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), cliStatus: vi.fn(), listPulls: vi.fn(), branchPull: vi.fn(), openRecent: vi.fn(),
  accountsChanged: null as (() => void) | null,
}));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {} },
    repository: {
      openRecent: calls.openRecent,
      getStatus: async () => ({ branch: 'main', oid: 'abc', ahead: 0, behind: 0, changes: [], stagedCount: 0, unstagedCount: 0 }),
      fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: async () => [],
    },
    refs: { listBranches: async () => [], listWorktrees: async () => [] },
    github: {
      status: calls.cliStatus, listPullRequests: calls.listPulls, findPullRequestForBranch: calls.branchPull,
      repositoryInfo: async () => ({ isGitHub: true, nameWithOwner: 'sample/project' }),
      repositoryAccount: async () => ({ state: 'ready', login: 'sample', selection: { mode: 'automatic' } }),
    },
    diagnostics: { record: async () => {} },
    events: {
      onGitHubAccountsChanged: (callback: () => void) => { calls.accountsChanged = callback; return () => {}; },
      onRepositoryChanged: () => () => {}, onActiveRepositoryChanged: () => () => {},
    },
  },
  serverClient: { transport: { subscribeState: () => () => {}, getState: () => 'connected' } },
}));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('./Toolbar', () => ({ Toolbar: (props: ToolbarProps) => createElement('button', {
  onClick: () => props.onRecent('repo-b'), 'aria-label': 'Switch repository',
}, 'Switch repository') }));
vi.mock('@/features/changes/ChangesView', () => ({ ChangesView: () => null }));
vi.mock('@/features/commit/CommitComposer', () => ({ CommitComposer: () => null }));
vi.mock('@/features/viewer/Viewer', () => ({ default: () => null }));
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import App from './App';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const available: GhCliStatus = { installed: true, availability: 'ready', authStatus: 'unknown', checkedAt: '2026-01-01T00:00:00Z' };
const repository = { id: 'repo', path: '/sample', commonDir: '/sample/.git', name: 'sample', repositoryName: 'sample' };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  calls.bootstrap.mockResolvedValue({
    activeRepository: repository, recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
  });
  calls.cliStatus.mockResolvedValue(available);
  calls.listPulls.mockResolvedValue([]);
  calls.branchPull.mockResolvedValue(null);
  calls.openRecent.mockResolvedValue({ ...repository, id: 'repo-b', path: '/sample-b', commonDir: '/sample-b/.git' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
async function mount() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
}
async function click(selector: string) {
  await act(async () => { container.querySelector<HTMLButtonElement>(selector)!.click(); });
  await settle();
}
async function openPulls() {
  await click('[aria-keyshortcuts="Control+4"]');
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toMatch(/Loading pull requests|No open pull requests|GitHub CLI is required|GitHub account unavailable/);
  });
}

it('detects the CLI before opening PRs and shows PR loading while the network request is pending', async () => {
  calls.listPulls.mockReturnValue(new Promise(() => {}));
  await mount();
  expect(calls.cliStatus).toHaveBeenCalledExactlyOnceWith(true);
  expect(calls.listPulls).not.toHaveBeenCalled();
  await openPulls();
  expect(container.textContent).toContain('Loading pull requests');
  expect(container.textContent).not.toContain('Checking GitHub CLI');
  expect(calls.cliStatus).toHaveBeenCalledOnce();
});

it('keeps cached PR results visible on return and shares CLI detection across repositories', async () => {
  await mount();
  await openPulls();
  expect(container.textContent).toContain('No open pull requests');
  await click('[aria-keyshortcuts="Control+1"]');
  calls.listPulls.mockReturnValue(new Promise<PullRequestSummary[]>(() => {}));
  await openPulls();
  expect(calls.listPulls).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('No open pull requests');
  expect(container.textContent).not.toMatch(/Checking GitHub CLI|Loading pull requests/);
  await click('[aria-label="Switch repository"]');
  expect(container.textContent).toContain('Loading pull requests');
  expect(calls.cliStatus).toHaveBeenCalledOnce();
  expect(calls.listPulls).toHaveBeenLastCalledWith('repo-b', ['OPEN']);
});

it('changes PR filters without checking CLI availability again', async () => {
  await mount();
  await openPulls();
  await click('[aria-label="Filter pull requests"]');
  await act(async () => document.querySelector<HTMLButtonElement>('#pulls-state-closed')!.click());
  await settle();
  expect(calls.listPulls).toHaveBeenLastCalledWith('repo', ['OPEN', 'CLOSED']);
  expect(calls.cliStatus).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain('Checking GitHub CLI');
});

it('lets Check again discover a newly installed CLI and load PRs', async () => {
  calls.cliStatus.mockResolvedValue({ ...available, installed: false, availability: 'error' });
  await mount();
  await openPulls();
  expect(container.textContent).toContain('GitHub CLI is required');
  expect(calls.listPulls).not.toHaveBeenCalled();
  expect(calls.branchPull).not.toHaveBeenCalled();
  calls.cliStatus.mockResolvedValue(available);
  const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Check again'))!;
  await act(async () => retry.click());
  await settle();
  expect(calls.cliStatus).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('No open pull requests');
});

it('shows detection failures and allows a manual retry', async () => {
  calls.cliStatus.mockRejectedValue(new Error('Could not run CLI detection'));
  await mount();
  await openPulls();
  expect(container.textContent).toContain('Could not run CLI detection');
  expect(container.textContent).not.toContain('Checking GitHub CLI');
  calls.cliStatus.mockResolvedValue(available);
  const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Check again'))!;
  await act(async () => retry.click());
  await settle();
  expect(container.textContent).toContain('No open pull requests');
});

it('rechecks availability when a PR operation reports that gh has disappeared', async () => {
  await mount();
  calls.cliStatus.mockResolvedValue({ ...available, installed: false, availability: 'error' });
  calls.listPulls.mockRejectedValue(new GhOperationError({ code: 'GH_CLI_NOT_FOUND', operation: 'gh-pr-list', message: 'CLI missing' }));
  await openPulls();
  expect(calls.cliStatus).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('GitHub CLI is required');
});

it('checks CLI availability on explicit Refresh even when PR results are cached', async () => {
  await mount();
  await openPulls();
  calls.cliStatus.mockResolvedValue({ ...available, installed: false, availability: 'error' });
  await click('[aria-label="Refresh pull requests"]');
  expect(calls.cliStatus).toHaveBeenCalledTimes(2);
  expect(calls.listPulls).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('GitHub CLI is required');
});

it('reports PR network errors without repeating CLI detection', async () => {
  calls.listPulls.mockRejectedValue(new Error('GitHub request timed out'));
  await mount();
  await click('[aria-keyshortcuts="Control+4"]');
  expect(container.textContent).toContain('GitHub request timed out');
  expect(container.textContent).not.toMatch(/Checking GitHub CLI|GitHub account unavailable/);
  expect(calls.cliStatus).toHaveBeenCalledOnce();
});

it('refreshes detection and PR results after GitHub settings change', async () => {
  await mount();
  await openPulls();
  await act(async () => calls.accountsChanged?.());
  await settle();
  expect(calls.cliStatus).toHaveBeenCalledTimes(2);
  expect(calls.listPulls).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('No open pull requests');
});
