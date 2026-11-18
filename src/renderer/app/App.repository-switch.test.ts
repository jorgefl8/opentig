// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadLazyViews } from './test-support/lazy-views';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryStatus } from '../../shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { SettingsStore } from '../../main/persistence/SettingsStore';

const calls = vi.hoisted(() => ({
  bootstrap: vi.fn(), snapshot: vi.fn(), getFiles: vi.fn(), openRecent: vi.fn(), getStatus: vi.fn(), success: vi.fn(), error: vi.fn(), fetch: vi.fn(), setRepositoryAccount: vi.fn(), getFavicon: vi.fn(), listWorktrees: vi.fn(),
  activeRepositoryChanged: null as ((repository: RepositoryInfo) => void) | null,
  repositoryChanged: null as ((repositoryId: string, scope: string, watch?: string, watchId?: string) => void) | null,
  reconnected: [] as Array<(data?: unknown) => void>,
  connection: null as { repositoryId: string | null; repository: RepositoryInfo | null } | null,
  connectionListeners: [] as Array<() => void>,
  accountsChanged: null as ((repositoryIds?: string[], inventoryChanged?: boolean, detected?: { login: string; previousLogin: string | null }) => void) | null,
}));
vi.mock('@/lib/opentig-api', () => ({
  opentig: {
    app: { bootstrap: calls.bootstrap, capabilities: async () => null, setZoomFactor: () => {}, setTitleBarTheme: async () => {} },
    repository: {
      openRecent: calls.openRecent, getStatus: calls.getStatus, getFavicon: calls.getFavicon, snapshot: calls.snapshot,
      fileHistoryState: async () => ({ canUndo: false, canRedo: false }), getFiles: calls.getFiles,
    },
    refs: { listBranches: async () => [], listWorktrees: calls.listWorktrees, fetch: calls.fetch },
    github: { status: async () => ({ installed: false }), repositoryInfo: async () => ({ isGitHub: false, nameWithOwner: null }), setRepositoryAccount: calls.setRepositoryAccount },
    diagnostics: { record: async () => {} },
    events: {
      onGitHubAccountsChanged: (callback: NonNullable<typeof calls.accountsChanged>) => { calls.accountsChanged = callback; return () => {}; },
      onRepositoryChanged: (callback: NonNullable<typeof calls.repositoryChanged>) => { calls.repositoryChanged = callback; return () => {}; },
      onActiveRepositoryChanged: (callback: (repository: RepositoryInfo) => void) => { calls.activeRepositoryChanged = callback; return () => {}; },
      onReconnected: (callback: (data?: unknown) => void) => { calls.reconnected.push(callback); return () => {}; },
    },
  },
  serverClient: {
    transport: { subscribeState: () => () => {}, getState: () => 'connected' },
    connection: { current: () => calls.connection, subscribe: (listener: () => void) => { calls.connectionListeners.push(listener); return () => {}; } },
  },
}));
vi.mock('@/lib/boot-theme', () => ({ persistTheme: () => {} }));
vi.mock('sileo', () => ({ sileo: { error: calls.error, success: calls.success, dismiss: () => {} } }));
vi.mock('./Toolbar', async () => {
  // The real icons hook, fed the same list of repositories the real toolbar gives it.
  const { useRepositoryFavicons } = await vi.importActual<typeof import('@/features/repositories/useRepositoryFavicons')>('@/features/repositories/useRepositoryFavicons');
  const { buildRepositoryPickerModel } = await vi.importActual<typeof import('@/features/repositories/repository-select-model')>('@/features/repositories/repository-select-model');
  return { Toolbar: (props: ToolbarProps) => {
  useRepositoryFavicons([{ key: props.repository.commonDir, recent: { id: props.repository.id } }, ...buildRepositoryPickerModel(props.recent, props.repositoryProjects).repositories]);
  return createElement('header', null,
  createElement('button', { 'aria-label': 'Open B', onClick: () => props.onRecent('repo-b') }),
  createElement('button', { 'aria-label': 'Open C', onClick: () => props.onRecent('repo-c') }),
  createElement('button', { 'aria-label': 'Open D', onClick: () => props.onRecent('repo-d') }),
  createElement('button', { 'aria-label': 'Open E', onClick: () => props.onRecent('repo-e') }),
  createElement('output', { 'aria-label': 'Repository' }, props.repository.id),
  createElement('output', { 'aria-label': 'Saved' }, props.recent.map((recent) => recent.id).join(' ')),
  createElement('output', { 'aria-label': 'Pending' }, props.pendingRepositoryId ?? ''),
  createElement('output', { 'aria-label': 'Phase' }, props.repositoryLoadPhase ?? 'ready'),
  createElement('output', { 'aria-label': 'Busy' }, props.busy ?? ''),
  createElement('output', { 'aria-label': 'Unconfirmed' }, String(props.unconfirmed ?? false)),
  createElement('output', { 'aria-label': 'Worktrees' }, props.worktrees.map((worktree) => worktree.path).join(' ')),
  createElement('output', { 'aria-label': 'Remote problem' }, props.remoteProblem ? `${props.remoteProblem.access.login} → ${props.remoteProblem.access.candidates.join(',')}` : ''),
  props.remoteProblem && createElement('button', { 'aria-label': 'Use candidate', onClick: () => props.onRemoteAccessAction({ kind: 'use-account', login: props.remoteProblem!.access.candidates[0]! }) }),
  );
  } };
});
vi.mock('@/features/changes/ChangesView', () => ({ ChangesView: () => createElement('div', null, 'Changes list') }));
vi.mock('@/features/commit/CommitComposer', () => ({ CommitComposer: () => null }));
vi.mock('@/features/files/FilesView', () => ({ FilesView: (props: { readOnly: boolean }) => createElement('output', { 'aria-label': 'Files read-only' }, String(props.readOnly)) }));
vi.mock('@/features/viewer/Viewer', () => ({ default: () => null }));
vi.mock('@/features/repositories/OpenRepositoryDialog', () => ({ OpenRepositoryDialog: () => null }));

import App from './App';
import { changeGeneration, doubtWatch, keepFile, keptFile } from '@/features/viewer/content-cache';

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

beforeAll(preloadLazyViews, 60_000);

beforeEach(() => {
  localStorage.setItem('opentig.lastView', 'changes');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  calls.bootstrap.mockResolvedValue({
    activeRepository: info('repo'), recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
  });
  calls.getFavicon.mockResolvedValue(null);
  calls.getFiles.mockResolvedValue([]);
  calls.listWorktrees.mockImplementation(async (id: string) => id === 'repo' ? [{ path: '/repo' }, { path: '/repo-linked' }] : [{ path: `/${id}` }]);
  opens.clear();
  statuses.clear();
  calls.reconnected.length = 0;
  calls.connection = null;
  calls.connectionListeners.length = 0;
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

// Let chained server mocks, query notifications, and React work run without sleeping for real time.
async function settle() { await act(async () => { for (let hop = 0; hop < 5; hop++) await new Promise((resolve) => setTimeout(resolve, 0)); }); }
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

it('shows a repository seen moments ago as it was, with its own worktrees, while reading it again', async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  await click('Open B');
  await act(async () => opens.get('repo-b')!.resolve(info('repo-b')));
  await act(async () => statuses.get('repo-b')!.resolve(status));
  await settle();
  expect(output('Worktrees')).toBe('/repo-b');

  // Back to the first repository, whose status now takes as long as it likes.
  calls.getStatus.mockImplementation(() => new Promise(() => {}));
  await act(async () => calls.activeRepositoryChanged!(info('repo')));
  await settle();
  expect(output('Repository')).toBe('repo');
  expect(output('Phase')).toBe('ready');
  expect(container.textContent).toContain('Changes list');
  expect(container.textContent).not.toContain('Loading changes…');
  expect(output('Worktrees')).toBe('/repo /repo-linked');
  // It is read again behind what is shown.
  expect(calls.getStatus).toHaveBeenLastCalledWith('repo');
});

it('does not leave a repository shown from memory looking current when it cannot be read again', async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  await click('Open B');
  await act(async () => opens.get('repo-b')!.resolve(info('repo-b')));
  await act(async () => statuses.get('repo-b')!.resolve(status));
  await settle();
  // Back to the first repository, which can no longer be read.
  calls.getStatus.mockImplementation(() => Promise.reject(new Error('index.lock exists')));
  vi.useFakeTimers();
  try {
    await act(async () => calls.activeRepositoryChanged!(info('repo')));
    expect(container.textContent).toContain('Changes list');
    // Past the quiet retry: both reads failed.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  } finally { vi.useRealTimers(); }
  await settle();
  expect(calls.error).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not refresh' }));
  expect(output('Phase')).toBe('loading');
  expect(container.textContent).not.toContain('Changes list');
});

describe('starting up', () => {
  const saved = { savedAt: '2026-11-15T09:00:00.000Z', status, branches: [], worktrees: [{ path: '/repo' }, { path: '/repo-saved' }], files: [] };
  beforeEach(() => {
    calls.bootstrap.mockResolvedValue({
      activeRepository: info('repo'), recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
      preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
      server: { protocolVersion: 4, appVersion: 'test', repositorySnapshots: true },
    });
    calls.snapshot.mockResolvedValue(saved);
  });

  it('paints what the server saved at once, and holds every change until the repository is read again', async () => {
    const read = deferred<RepositoryStatus>();
    calls.getStatus.mockImplementation(() => read.promise);
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
    await settle();
    expect(calls.snapshot).toHaveBeenCalledWith('repo');
    expect(output('Phase')).toBe('ready');
    expect(container.textContent).toContain('Changes list');
    expect(output('Worktrees')).toBe('/repo /repo-saved');
    // Pull, Push, Commit and Discard wait while the toolbar is busy reading.
    expect(output('Busy')).toBe('refresh');
    // So do staging and switching branch, which do not wait on the toolbar.
    expect(output('Unconfirmed')).toBe('true');

    await act(async () => read.resolve(status));
    await settle();
    expect(output('Busy')).toBe('');
    expect(output('Worktrees')).toBe('/repo /repo-linked');
    expect(output('Unconfirmed')).toBe('false');
  });

  it('holds the Files tree\'s changes until its own tree is read, after the first read confirmed the rest', async () => {
    const tree = deferred<never[]>();
    calls.getFiles.mockImplementation(() => tree.promise);
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
    await settle();
    // Changes read again and confirmed; the saved tree was not read, Files being closed.
    expect(output('Unconfirmed')).toBe('false');
    const files = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Repository views"] button')].find((button) => button.textContent?.includes('Files'))!;
    await act(async () => files.click());
    await settle();
    expect(output('Files read-only')).toBe('true');
    await act(async () => tree.resolve([]));
    await settle();
    expect(output('Files read-only')).toBe('false');
  });

  it('puts what the server saved away when the repository cannot be read', async () => {
    calls.getStatus.mockImplementation(() => Promise.reject(new Error('index.lock exists')));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(container.textContent).toContain('Changes list');
      // Past the quiet retry: both reads failed.
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    } finally { vi.useRealTimers(); }
    await settle();
    expect(output('Phase')).toBe('loading');
    expect(container.textContent).not.toContain('Changes list');
  });

  it('starts as before with a server that saves nothing', async () => {
    calls.bootstrap.mockResolvedValue({
      activeRepository: info('repo'), recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
      preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
      server: { protocolVersion: 4, appVersion: 'test' },
    });
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
    await settle();
    expect(calls.snapshot).not.toHaveBeenCalled();
    expect(output('Worktrees')).toBe('/repo /repo-linked');
  });
});

it('reads the repository on a timer while the server watches another one, until it says it watches this one again', async () => {
  calls.bootstrap.mockResolvedValue({
    activeRepository: info('repo'), recentRepositories: [], repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
    activeRepositoryWatch: { state: 'watching', watchId: 'first' },
  });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  // The page's intervals from here on, with how often each fired and whether it was cleared: the timed read
  // is the one set when the watch stops, which says so whatever other reads land meanwhile.
  const intervals: { id: number; ms: number; fired: number; cleared: boolean }[] = [];
  const setFake = window.setInterval.bind(window);
  const clearFake = window.clearInterval.bind(window);
  const setSpy = vi.spyOn(window, 'setInterval').mockImplementation(((callback: () => void, ms?: number) => {
    const interval = { id: 0, ms: ms ?? 0, fired: 0, cleared: false };
    interval.id = setFake(() => { interval.fired += 1; callback(); }, ms) as unknown as number;
    intervals.push(interval);
    return interval.id;
  }) as typeof window.setInterval);
  const clearSpy = vi.spyOn(window, 'clearInterval').mockImplementation(((id?: number) => {
    const interval = intervals.find((item) => item.id === id);
    if (interval) interval.cleared = true;
    clearFake(id);
  }) as typeof window.clearInterval);
  try {
    const reads = () => calls.getStatus.mock.calls.length;
    // An announcement starts a read of its own, which a slow machine may still be making after one
    // `settle`: the counts below are taken once no more reads arrive.
    const quiet = async () => { let seen = -1; while (seen !== reads()) { seen = reads(); await settle(); await settle(); } };
    const before = reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // Watched: the server reports every change, so nothing is read on a timer.
    expect(reads()).toBe(before);
    // Another client opened another repository: this one's changes now go unreported.
    const known = intervals.length;
    await act(async () => calls.repositoryChanged!('repo', 'unknown', 'stopped'));
    await quiet();
    const timed = intervals.slice(known).filter((item) => item.ms === 10_000 && !item.cleared);
    expect(timed).toHaveLength(1);
    // Every ten seconds it reads the repository, however the reads it starts interleave with others.
    for (const tick of [1, 2]) {
      const ahead = reads();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(timed[0]!.fired).toBe(tick);
      await vi.waitFor(() => expect(reads()).toBeGreaterThan(ahead));
    }
    await act(async () => calls.repositoryChanged!('repo', 'worktree', 'watching', 'second'));
    await quiet();
    // Watched again: the timed read is gone, and no other took its place. The timer is what is
    // counted, not the reads: one started by the announcement can still be landing on a slow
    // machine, which says nothing about a timer.
    expect(timed[0]!.cleared).toBe(true);
    const fired = timed[0]!.fired;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await settle();
    expect(timed[0]!.fired).toBe(fired);
    expect(intervals.slice(known).filter((item) => item.ms === 10_000 && !item.cleared)).toHaveLength(0);
    // The connection dropped and came back to the same server, whose watch never stopped: what is read
    // from now on can be relied on again, instead of the cache staying off until the watch changes.
    const kept = (content: string) => {
      keepFile('repo', { path: 'a.ts', content, binary: false, tooLarge: false, size: 1, mtimeMs: 0, watchId: 'second' }, changeGeneration());
      return keptFile('repo', 'a.ts', null)?.content ?? null;
    };
    expect(kept('before the drop')).toBe('before the drop');
    doubtWatch();
    expect(keptFile('repo', 'a.ts', null)).toBeNull();
    await act(async () => { for (const reconnected of calls.reconnected) reconnected(); calls.repositoryChanged!('repo', 'unknown', 'watching', 'second'); });
    await settle();
    expect(kept('after the reconnect')).toBe('after the reconnect');
    // The connection dropped, and the server's bootstrap afterwards named another repository as watched.
    const beforeDrop = intervals.length;
    await act(async () => { for (const reconnected of calls.reconnected) reconnected(); });
    await act(async () => calls.repositoryChanged!('repo-b', 'unknown', 'watching', 'elsewhere'));
    await quiet();
    // This one is read on a timer again.
    const timedAgain = intervals.slice(beforeDrop).filter((item) => item.ms === 10_000 && !item.cleared);
    expect(timedAgain).toHaveLength(1);
    const reconnected = reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(timedAgain[0]!.fired).toBe(1);
    await vi.waitFor(() => expect(reads()).toBeGreaterThan(reconnected));
  } finally {
    setSpy.mockRestore();
    clearSpy.mockRestore();
    vi.useRealTimers();
  }
});

describe('where each page has its own repository', () => {
  const saved = (id: string) => ({ ...info(id), lastOpenedAt: '2026-01-01T00:00:00.000Z' });
  const perClient = (id: string, recents: string[]) => ({
    activeRepository: info(id), recentRepositories: recents.map(saved), repositoryProjects: [], filesTreeStates: [], openFilesStates: [],
    preferences: { ...new SettingsStore('unused-settings.json').preferences, remoteFetchIntervalSeconds: 0 },
    server: { protocolVersion: 4, appVersion: 'test', repositoryPerClient: true as const },
    attachment: { attached: true, repositoryId: id, ticket: 1 },
  });

  it('lands on the new id of its repository when it comes back after the repository was relocated meanwhile', async () => {
    calls.bootstrap.mockResolvedValue(perClient('repo', ['repo', 'repo-b']));
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
    await settle();
    expect(output('Repository')).toBe('repo');

    // Offline while another client relocated it; the server follows the old id to the new one.
    const back = { ...perClient('repo-moved', ['repo-moved', 'repo-b']), relocatedRepositoryIds: { repo: 'repo-moved' } };
    calls.connection = { repositoryId: 'repo-moved', repository: info('repo-moved') };
    await act(async () => { for (const reconnected of calls.reconnected) reconnected(back); for (const listener of calls.connectionListeners) listener(); });
    await settle();

    expect(output('Repository')).toBe('repo-moved');
    expect(output('Saved')).toBe('repo-moved repo-b');
    // Nothing is asked again under the old id, nor said to be gone.
    expect(calls.openRecent).not.toHaveBeenCalled();
    expect(calls.error).not.toHaveBeenCalled();
  });

  it('follows its repository to the new id an open to agree with the server answers by', async () => {
    calls.bootstrap.mockResolvedValue(perClient('repo', ['repo', 'repo-b']));
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
    await settle();
    // The server has the page elsewhere: it opens what it shows again, and that was relocated meanwhile.
    calls.connection = { repositoryId: 'repo-b', repository: info('repo-b') };
    await act(async () => { for (const listener of calls.connectionListeners) listener(); });
    await settle();
    expect(calls.openRecent).toHaveBeenCalledExactlyOnceWith('repo');
    calls.connection = { repositoryId: 'repo-moved', repository: info('repo-moved') };
    await act(async () => opens.get('repo')!.resolve(info('repo-moved')));
    await settle();

    expect(output('Repository')).toBe('repo-moved');
    expect(output('Saved')).toContain('repo-moved');
    expect(output('Saved')).not.toMatch(/\brepo\b(?!-)/);
    expect(calls.openRecent).toHaveBeenCalledOnce();
  });
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

it.each([
  ['reads a newly opened repository again, quietly, when its first read fails', 1],
  ['shows only its own worktrees when a repository is first read by a later, partial refresh', 2],
] as const)('%s', async (_name, failures) => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  expect(output('Worktrees')).toBe('/repo /repo-linked');
  await click('Open B');
  for (let index = 0; index < failures; index++) calls.getStatus.mockRejectedValueOnce(new Error('index.lock exists'));
  vi.useFakeTimers();
  try {
    await act(async () => opens.get('repo-b')!.resolve(info('repo-b')));
    // Advance past the quiet retry instead of waiting for it in real time.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  } finally { vi.useRealTimers(); }
  await settle();
  if (failures === 1) expect(calls.error).not.toHaveBeenCalled();
  else {
    // Both reads failed, which is reported. A change to a file then refreshes the status alone.
    expect(calls.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Could not refresh' }));
    expect(output('Phase')).toBe('loading');
    await act(async () => calls.repositoryChanged!('repo-b', 'worktree'));
    await settle();
  }
  await act(async () => statuses.get('repo-b')!.resolve(status));
  await settle();
  expect(output('Phase')).toBe('ready');
  expect(output('Worktrees')).toBe('/repo-b');
});

it('asks for the icon of each saved repository once, however often the repository changes', async () => {
  const bootstrap = await calls.bootstrap();
  calls.bootstrap.mockResolvedValue({
    ...bootstrap,
    recentRepositories: ['repo', 'repo-d', 'repo-e'].map((id) => ({ ...info(id), lastOpenedAt: '2026-01-01T00:00:00.000Z' })),
  });
  calls.getFavicon.mockImplementation(async (id: string) => id === 'repo-d' ? { dataUrl: 'data:image/png;base64,AAAA' } : null);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  // Other tests in this file may already have asked about the repository that starts open.
  const asked = () => calls.getFavicon.mock.calls.map(([id]) => id as string).filter((id) => id !== 'repo').sort();
  expect(asked()).toEqual(['repo-d', 'repo-e']);

  for (const id of ['repo-d', 'repo-e', 'repo-d']) {
    await click(id === 'repo-d' ? 'Open D' : 'Open E');
    await act(async () => opens.get(id)!.resolve(info(id)));
    await settle();
    expect(output('Repository')).toBe(id);
    await act(async () => statuses.get(id)!.resolve(status));
    await settle();
  }
  // Every switch rebuilds the list of saved repositories; neither a known icon nor a known absence is asked for again.
  expect(asked()).toEqual(['repo-d', 'repo-e']);
});

it('announces an account chosen automatically for the open repository only', async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  await act(async () => calls.accountsChanged!(['other'], true, { login: 'bob', previousLogin: 'alice' }));
  expect(calls.success).not.toHaveBeenCalled();
  await act(async () => calls.accountsChanged!(['repo'], true, { login: 'bob', previousLogin: 'alice' }));
  expect(calls.success).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    title: 'Using @bob for repo', description: 'The default account @alice can’t access this repository.',
    button: expect.objectContaining({ title: 'Change' }),
  }));
});

it('shows a refused background fetch until access works and switches to an account that has access', async () => {
  const access = { repository: 'team/repo', transport: 'https' as const, login: 'alice', candidates: ['bob'], sso: false };
  calls.fetch.mockResolvedValueOnce({ status: 'failed', message: 'remote: Repository not found.', access }).mockResolvedValue({ status: 'success', ahead: 0, behind: 0 });
  calls.setRepositoryAccount.mockResolvedValue({});
  const bootstrap = await calls.bootstrap();
  calls.bootstrap.mockResolvedValue({ ...bootstrap, preferences: { ...bootstrap.preferences, remoteFetchIntervalSeconds: 30 } });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  expect(output('Remote problem')).toBe('alice → bob');
  await click('Use candidate');
  expect(calls.setRepositoryAccount).toHaveBeenCalledWith('repo', { mode: 'account', host: 'github.com', login: 'bob' });
  await vi.waitFor(() => expect(calls.fetch).toHaveBeenCalledTimes(2));
  await settle();
  expect(output('Remote problem')).toBe('');
});

it.each([
  ['retries an automatic refresh quietly while the repository is still changing', 1, false],
  ['reports an automatic refresh that still fails after its retry', 2, true],
] as const)('%s', async (_name, failures, reported) => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(App))));
  await settle();
  // The reads of start-up can still be landing on a slow machine after one `settle`: the count is
  // taken once no more arrive, so that only the refresh below and its retry are counted.
  for (let seen = -1; seen !== calls.getStatus.mock.calls.length;) { seen = calls.getStatus.mock.calls.length; await settle(); await settle(); }
  const reads = calls.getStatus.mock.calls.length;
  for (let index = 0; index < failures; index++) calls.getStatus.mockRejectedValueOnce(new Error('index.lock exists'));
  vi.useFakeTimers();
  try {
    await act(async () => calls.repositoryChanged!('repo', 'worktree'));
    // Advance past the quiet retry backoff instead of waiting for it in real time.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls.getStatus.mock.calls.length).toBe(reads + 2);
  } finally { vi.useRealTimers(); }
  await settle();
  if (reported) expect(calls.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Could not refresh', description: 'index.lock exists' }));
  else expect(calls.error).not.toHaveBeenCalled();
});
