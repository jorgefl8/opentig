// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { preloadLazyViews } from './test-support/lazy-views';
import type { RecentRepository, RepositoryInfo } from '../../shared/contracts';
import type { RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), getStatus: vi.fn(), unavailableRecent: vi.fn(), relocateRecent: vi.fn(), findRelocations: vi.fn(), relocateRecents: vi.fn(),
  success: vi.fn(), error: vi.fn(),
}));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {} },
    repository: {
      openRecent: async () => { throw new Error('unexpected open'); }, getStatus: calls.getStatus,
      fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: async () => [],
      unavailableRecent: calls.unavailableRecent, relocateRecent: calls.relocateRecent,
      findRelocations: calls.findRelocations, relocateRecents: calls.relocateRecents,
      browseDirectories: async () => ({ path: '/', directories: [], locations: [] }),
    },
    refs: { listBranches: async () => [], listWorktrees: async () => [], fetch: async () => ({ status: 'success', ahead: 0, behind: 0 }) },
    github: { status: async () => ({ installed: false }), repositoryInfo: async () => ({ isGitHub: false, nameWithOwner: null }) },
    updates: { status: async () => ({ phase: 'idle' }) },
    diagnostics: { record: async () => {} },
    events: {
      onGitHubAccountsChanged: () => () => {},
      onRepositoryChanged: () => () => {},
      onActiveRepositoryChanged: () => () => {},
    },
  },
  serverClient: { transport: { subscribeState: () => () => {}, getState: () => 'connected' } },
}));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('sileo', () => ({ sileo: { error: calls.error, success: calls.success, dismiss: () => {} } }));
vi.mock('./Toolbar', () => ({ Toolbar: (props: ToolbarProps) => createElement('header', null,
  createElement('button', { 'aria-label': 'Open B', onClick: () => props.onRecent('repo-b') }),
  createElement('output', { 'aria-label': 'Repository' }, props.repository.id),
  createElement('output', { 'aria-label': 'Missing' }, [...props.unavailableRepositoryIds].join(',')),
) }));
vi.mock('@/features/changes/ChangesView', () => ({ ChangesView: () => null }));
vi.mock('@/features/commit/CommitComposer', () => ({ CommitComposer: () => null }));
vi.mock('@/features/viewer/Viewer', () => ({ default: () => null }));
vi.mock('@/features/settings/UpdateSettings', () => ({ DesktopUpdateIndicator: () => null }));
// The server folder browser is replaced by one button that picks a fixed folder.
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({
  OpenRepositoryDialog: (props: { open: boolean; title?: string; onOpen(path: string): Promise<void> }) => props.open
    ? createElement('button', { 'aria-label': props.title, onClick: () => void props.onOpen('/moved/repo-b') })
    : null,
}));

import App from './App';

const info = (id: string, folder = `/${id}`) => ({ id, path: folder, commonDir: `${folder}/.git`, name: id, repositoryName: id }) as RepositoryInfo;
const recent = (id: string): RecentRepository => ({ ...info(id), lastOpenedAt: '2026-01-01T00:00:00.000Z' });
const status: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: null, ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};
const missingError = () => Object.assign(new Error('The repository folder no longer exists. It may have been moved or deleted.'), {
  detail: { code: 'REPOSITORY_MISSING', operation: 'status', message: 'The repository folder no longer exists. It may have been moved or deleted.' },
});

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeAll(preloadLazyViews, 60_000);

beforeEach(() => {
  localStorage.setItem('opentig.lastView', 'changes');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  calls.bootstrap.mockResolvedValue({
    activeRepository: info('repo'), recentRepositories: [recent('repo'), recent('repo-b'), recent('repo-c')],
    repositoryProjects: [], filesTreeStates: [], openFilesStates: [], unavailableRepositoryIds: ['repo-b', 'repo-c'],
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
  });
  calls.getStatus.mockResolvedValue(status);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function settle() { await act(async () => { for (let hop = 0; hop < 8; hop++) await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
}
async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
  await settle();
}
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`);
const buttonWithText = (text: string) => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes(text));

it('replaces the workspace with the relocation screen when the open repository folder disappears', async () => {
  calls.getStatus.mockRejectedValue(missingError());
  calls.unavailableRecent.mockResolvedValue(['repo', 'repo-b', 'repo-c']);
  await render();

  expect(document.body.textContent).toContain('repo was not found');
  expect(document.body.textContent).toContain('2 other saved repositories are missing too');
  expect(calls.error).not.toHaveBeenCalled();
  expect(byLabel('Repository')).toBeNull();
});

it('keeps the usual error toast when the failing folder is not the open repository', async () => {
  calls.getStatus.mockRejectedValue(missingError());
  calls.unavailableRecent.mockResolvedValue(['repo-b']);
  await render();

  expect(calls.error).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not refresh' }));
  expect(byLabel('Repository')?.textContent).toBe('repo');
});

it('locates a missing repository from the picker, then relocates the others found next to it', async () => {
  calls.unavailableRecent.mockResolvedValueOnce(['repo-c']).mockResolvedValue([]);
  calls.relocateRecent.mockResolvedValue(info('moved-b', '/moved/repo-b'));
  calls.findRelocations.mockResolvedValue({
    searchedPath: '/moved', unresolved: [],
    candidates: [{ id: 'repo-c', name: 'repo-c', previousPath: '/repo-c', path: '/moved/repo-c' }],
  });
  calls.relocateRecents.mockResolvedValue({ relocated: [{ previousId: 'repo-c', repository: info('moved-c', '/moved/repo-c') }], failed: [] });
  await render();
  expect(byLabel('Missing')?.textContent).toBe('repo-b,repo-c');

  await click(byLabel('Open B'));
  await click(byLabel('Locate repo-b'));
  expect(calls.relocateRecent).toHaveBeenCalledWith('repo-b', '/moved/repo-b');
  expect(calls.findRelocations).toHaveBeenCalledWith('/repo-b', '/moved/repo-b');
  expect(byLabel('Repository')?.textContent).toBe('moved-b');
  expect(document.body.textContent).toContain('Found 1 more moved repository');

  await click(buttonWithText('Relocate 1'));
  expect(calls.relocateRecents).toHaveBeenCalledWith([{ id: 'repo-c', path: '/moved/repo-c' }]);
  expect(calls.success).toHaveBeenCalledWith({ title: 'Relocated 1 repository' });
  expect(byLabel('Missing')?.textContent).toBe('');
  expect(document.body.textContent).not.toContain('Found 1 more moved repository');
});
