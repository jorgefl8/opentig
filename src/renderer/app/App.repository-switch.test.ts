// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), openRecent: vi.fn(), getStatus: vi.fn(),
  activeRepositoryChanged: null as ((repository: RepositoryInfo) => void) | null,
}));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {} },
    repository: {
      openRecent: calls.openRecent, getStatus: calls.getStatus,
      fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: async () => [],
    },
    refs: { listBranches: async () => [], listWorktrees: async () => [] },
    github: { status: async () => ({ installed: false }), repositoryInfo: async () => ({ isGitHub: false, nameWithOwner: null }) },
    diagnostics: { record: async () => {} },
    events: {
      onGitHubAccountsChanged: () => () => {}, onRepositoryChanged: () => () => {},
      onActiveRepositoryChanged: (callback: (repository: RepositoryInfo) => void) => { calls.activeRepositoryChanged = callback; return () => {}; },
    },
  },
  serverClient: { transport: { subscribeState: () => () => {}, getState: () => 'connected' } },
}));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('sileo', () => ({ sileo: { error: () => {}, dismiss: () => {} } }));
vi.mock('./Toolbar', () => ({ Toolbar: (props: ToolbarProps) => createElement('header', null,
  createElement('button', { 'aria-label': 'Open B', onClick: () => props.onRecent('repo-b') }),
  createElement('button', { 'aria-label': 'Open C', onClick: () => props.onRecent('repo-c') }),
  createElement('output', { 'aria-label': 'Repository' }, props.repository.id),
  createElement('output', { 'aria-label': 'Pending' }, props.pendingRepositoryId ?? ''),
  createElement('output', { 'aria-label': 'Phase' }, props.repositoryLoadPhase ?? 'ready'),
) }));
vi.mock('@/features/changes/ChangesView', () => ({ ChangesView: () => createElement('div', null, 'Changes list') }));
vi.mock('@/features/commit/CommitComposer', () => ({ CommitComposer: () => null }));
vi.mock('@/features/viewer/Viewer', () => ({ default: () => null }));
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import App from './App';

const info = (id: string) => ({ id, path: `/${id}`, commonDir: `/${id}/.git`, name: id, repositoryName: id }) as RepositoryInfo;
const status: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: null, ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const opens = new Map<string, ReturnType<typeof deferred<RepositoryInfo>>>();
const statuses = new Map<string, ReturnType<typeof deferred<RepositoryStatus>>>();

beforeEach(() => {
  localStorage.setItem('opentig.lastView', 'changes');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  calls.bootstrap.mockResolvedValue({
    activeRepository: info('repo'), recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
  });
  opens.clear();
  statuses.clear();
  calls.openRecent.mockImplementation((id: string) => {
    const request = deferred<RepositoryInfo>();
    opens.set(id, request);
    return request.promise;
  });
  calls.getStatus.mockImplementation((id: string) => {
    if (id === 'repo') return Promise.resolve(status);
    const request = deferred<RepositoryStatus>();
    statuses.set(id, request);
    return request.promise;
  });
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

async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
async function click(label: string) {
  await act(async () => { container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); });
  await settle();
}
const output = (label: string) => container.querySelector(`[aria-label="${label}"]`)?.textContent;
const workspace = () => container.querySelector('main.workspace')!;

it('shows the opening choice, then a loading workspace, then the opened repository', async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  expect(output('Phase')).toBe('ready');
  expect(container.textContent).toContain('Changes list');

  await click('Open B');
  expect(output('Pending')).toBe('repo-b');
  expect(output('Phase')).toBe('opening');
  expect(output('Repository')).toBe('repo');
  expect(workspace().getAttribute('aria-busy')).toBe('true');

  await act(async () => opens.get('repo-b')!.resolve(info('repo-b')));
  await settle();
  expect(output('Repository')).toBe('repo-b');
  expect(output('Pending')).toBe('');
  expect(output('Phase')).toBe('loading');
  expect(container.textContent).toContain('Loading changes…');
  expect(container.textContent).not.toContain('Changes list');

  await act(async () => statuses.get('repo-b')!.resolve(status));
  await settle();
  expect(output('Phase')).toBe('ready');
  expect(workspace().hasAttribute('aria-busy')).toBe(false);
  expect(container.textContent).toContain('Changes list');
});

it('ends on the latest choice when an earlier open and its activation event arrive late', async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  await click('Open B');
  await click('Open C');
  expect(calls.openRecent).toHaveBeenCalledTimes(1);
  expect(output('Pending')).toBe('repo-c');

  await act(async () => calls.activeRepositoryChanged!(info('repo-b')));
  await act(async () => opens.get('repo-b')!.resolve(info('repo-b')));
  await settle();
  expect(output('Repository')).toBe('repo');
  expect(calls.openRecent).toHaveBeenLastCalledWith('repo-c');

  await act(async () => opens.get('repo-c')!.resolve(info('repo-c')));
  await settle();
  expect(output('Repository')).toBe('repo-c');
  expect(output('Pending')).toBe('');
});
