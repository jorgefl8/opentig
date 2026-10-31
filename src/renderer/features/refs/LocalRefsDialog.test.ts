// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchInfo, LocalRefsSnapshot, ManagedWorktree, RemoteBranchDetails, WorktreeDetails } from '@shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';

const calls = vi.hoisted(() => ({ worktreeDetails: vi.fn(), removeWorktree: vi.fn(), snapshot: vi.fn(), details: vi.fn(), remoteDetails: vi.fn(), create: vi.fn(), deleteRemote: vi.fn(), fetch: vi.fn(), pr: vi.fn(), mutated: vi.fn(), busy: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: {
  refs: { localRefsSnapshot: calls.snapshot, branchDetails: calls.details, remoteBranchDetails: calls.remoteDetails,
    createTrackingBranch: calls.create, deleteRemoteBranch: calls.deleteRemote, fetchBranches: calls.fetch,
    worktreeDetails: calls.worktreeDetails, removeWorktree: calls.removeWorktree },
  github: { findPullRequestForBranch: calls.pr },
} }));
import { LocalRefsDialog } from './LocalRefsDialog';
import { ServerRequestTimeoutError, UNCONFIRMED_RESULT_MESSAGE } from '@/lib/websocket-transport';

const oid = 'a'.repeat(40);
const local: BranchInfo = { fullName: 'refs/heads/main', name: 'main', current: true, remote: false, upstream: 'origin/main', ahead: 0, behind: 0,
  worktreePath: '/sample', oid, shortOid: 'aaaaaaa', subject: 'Base', author: 'Sample', date: '2026-10-01T10:00:00Z' };
const remote: BranchInfo = { ...local, fullName: 'refs/remotes/origin/feature', name: 'origin/feature', current: false, remote: true, upstream: null,
  worktreePath: null, remoteName: 'origin', remoteBranchName: 'feature' };
const upstream: BranchInfo = { ...remote, fullName: 'refs/remotes/upstream/feature', name: 'upstream/feature', remoteName: 'upstream' };
const remoteDetails: RemoteBranchDetails = { ...remote, remote: 'origin', branchName: 'feature', localBranches: [], defaultBranch: 'main', remoteState: 'current', destinationId: 'b'.repeat(64), deletionBlockedReason: null };
let snapshot: LocalRefsSnapshot;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let tab: 'branches' | 'worktrees';
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null,
    createElement(LocalRefsDialog, { open: true, repositoryId: 'repo', tab, onTabChange: value => { tab = value; void render(); }, onOpenChange: () => {},
      onOpenWorktree: () => {}, onMutated: calls.mutated, onBusyChange: calls.busy })))));
  await settle();
}
// Let chained server mocks, query notifications, and React work run without sleeping for real time.
async function settle() { await act(async () => { for (let hop = 0; hop < 5; hop++) await new Promise(resolve => setTimeout(resolve, 0)); }); }
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!; }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  snapshot = { branches: [local, remote, upstream], worktrees: [], remotes: ['origin', 'upstream'] };
  calls.snapshot.mockImplementation(async () => structuredClone(snapshot));
  calls.details.mockImplementation(async ({ fullName }: { fullName: string }) => ({ ...local, fullName, name: fullName.slice('refs/heads/'.length), deletion: 'current', comparisonKind: 'none', comparisonBase: null, uniqueCommits: 0 }));
  calls.remoteDetails.mockImplementation(async ({ fullName }: { fullName: string }) => ({ ...remoteDetails, fullName, remote: fullName.includes('/upstream/') ? 'upstream' : 'origin' }));
  calls.pr.mockResolvedValue({ number: 41, state: 'MERGED', baseRefName: 'main', title: 'Sample change', url: 'https://github.com/sample/project/pull/41' });
  calls.fetch.mockResolvedValue({ status: 'success', ahead: 0, behind: 0 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); tab = 'branches';
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it('shows local and remote groups, filters them, and displays remote details and merged PRs', async () => {
  expect(document.querySelectorAll('.local-refs-row')).toHaveLength(3);
  await click('Remote');
  expect(document.querySelectorAll('.local-refs-row')).toHaveLength(2);
  expect(document.querySelector('.local-refs-detail')?.textContent).toContain('origin/feature');
  await vi.waitFor(async () => {
    await settle();
    expect(document.querySelector('.local-refs-pr-link')?.textContent).toContain('Merged into main');
  });
  expect(calls.pr).toHaveBeenCalledWith('repo', 'feature');
  await act(async () => document.querySelector<HTMLButtonElement>('[role="group"][aria-label="upstream"] .local-refs-row')!.click());
  await settle();
  expect(document.querySelector('.local-refs-detail')?.textContent).toContain('upstream/feature');
  expect(calls.pr).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.local-refs-pr-link')).toBeNull();
  await click('Local');
  expect(document.querySelectorAll('.local-refs-row')).toHaveLength(1);
});

it('requires a separate confirmation and deletes only the selected remote branch', async () => {
  calls.deleteRemote.mockImplementation(async () => { snapshot.branches = [local, upstream]; return { status: 'deleted' }; });
  await click('Remote');
  await click('Delete from origin');
  expect(calls.deleteRemote).not.toHaveBeenCalled();
  expect(document.querySelector('.local-refs-confirm')?.textContent).toContain('local branches, commits and worktrees stay intact');
  await click('Delete from origin');
  expect(calls.deleteRemote).toHaveBeenCalledExactlyOnceWith({ repositoryId: 'repo', fullName: remote.fullName, expectedOid: oid, destinationId: 'b'.repeat(64) });
  expect(calls.fetch).toHaveBeenCalledWith('repo');
  expect(calls.mutated).toHaveBeenCalledOnce();
  await click('Local');
  expect(document.querySelector('.local-refs-row strong')?.textContent).toBe('main');
});

it('keeps the remote branch and explains stale deletion results', async () => {
  calls.deleteRemote.mockResolvedValue({ status: 'stale' });
  await click('Remote'); await click('Delete from origin'); await click('Delete from origin');
  expect(document.querySelector('.local-refs-error')?.textContent).toContain('branch changed');
  expect(document.querySelectorAll('.local-refs-row')).toHaveLength(2);
  expect(calls.fetch).not.toHaveBeenCalled();
  expect(calls.mutated).not.toHaveBeenCalled();
});

it('blocks remote deletion for a protected default branch and reports fetch failures', async () => {
  calls.remoteDetails.mockResolvedValue({ ...remoteDetails, deletionBlockedReason: 'This is the remote’s default branch and cannot be deleted here.' });
  await click('Remote');
  expect(button('Delete from origin')).toBeUndefined();
  expect(document.querySelector('.local-refs-detail')?.textContent).toContain('default branch');
  calls.fetch.mockResolvedValue({ status: 'failed', message: 'Network unavailable' });
  await click('Fetch');
  expect(document.querySelector('.local-refs-error')?.textContent).toContain('Network unavailable');
});

it('creates a local tracking branch and selects it after success without switching checkout', async () => {
  calls.create.mockImplementation(async () => { snapshot.branches.push({ ...local, name: 'feature', fullName: 'refs/heads/feature', current: false }); return { status: 'created', fullName: 'refs/heads/feature' }; });
  await click('Remote'); await click('Create local tracking branch…');
  await act(async () => document.querySelector<HTMLFormElement>('.local-refs-create-branch')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
  expect(calls.create).toHaveBeenCalledExactlyOnceWith({ repositoryId: 'repo', fullName: remote.fullName, expectedOid: oid, localName: 'feature' });
  expect(document.querySelector('.local-refs-row[aria-selected="true"] strong')?.textContent).toBe('feature');
  expect(calls.mutated).toHaveBeenCalledOnce();
});


it('explains deleted remote branches and cleans up their cached refs without offering remote deletion or creation', async () => {
  calls.remoteDetails.mockResolvedValue({ ...remoteDetails, remoteState: 'missing', deletionBlockedReason: 'The branch no longer exists on the remote.' });
  calls.fetch.mockImplementation(async () => { snapshot.branches = [local, upstream]; return { status: 'success', ahead: 0, behind: 0 }; });
  await click('Remote');
  expect(document.querySelector('.local-refs-remote-label')?.textContent).toContain('Deleted on remote');
  expect(document.querySelector('.local-refs-detail')?.textContent).toContain('there is no remote branch to delete');
  expect(button('Delete from origin')).toBeUndefined();
  expect(button('Create local tracking branch…')).toBeUndefined();
  await click('Fetch and clean up');
  expect(calls.fetch).toHaveBeenCalledExactlyOnceWith('repo');
  expect(calls.deleteRemote).not.toHaveBeenCalled();
  expect(calls.create).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.local-refs-row')).toHaveLength(1);
});

describe('worktree removal', () => {
  const worktree: ManagedWorktree = { path: '/sample/review', oid, branch: 'review', main: false, current: false, detached: false, bare: false, locked: null, prunable: null };
  const details: WorktreeDetails = { path: worktree.path, oid, branch: 'review', main: false, current: false, detached: false, bare: false, locked: null, prunable: null,
    available: true, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 0, operation: null, readOnly: false, lastCommit: null };

  async function openWorktrees() {
    snapshot = { branches: [local], worktrees: [worktree], remotes: [] };
    calls.worktreeDetails.mockResolvedValue(details);
    tab = 'worktrees';
    client.clear();
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>('.local-refs-row')!.click());
    await settle();
    await vi.waitFor(async () => { await settle(); button('Remove worktree'); });
  }

  async function startRemoval() {
    await click('Remove worktree');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.local-refs-confirm button')][0]!.click());
    await settle();
  }

  it('keeps the dialog usable while a removal runs and follows the server state', async () => {
    await openWorktrees();
    calls.removeWorktree.mockReturnValue(new Promise(() => {}));
    await startRemoval();

    expect(document.querySelector('.local-refs-row')?.textContent).toContain('Removing');
    expect(document.querySelector('.local-refs-detail')?.textContent).toContain('You can close this dialog');
    expect(button('Done').disabled).toBe(false);
    expect(document.querySelector('.local-refs-confirm')).toBeNull();
    expect(calls.busy).not.toHaveBeenCalledWith(true);
  });

  it('shows a removal another request started, even when Git already reports it missing', async () => {
    await openWorktrees();
    snapshot = { ...snapshot, worktrees: [{ ...worktree, prunable: 'gitdir file points to non-existent location' }],
      worktreeRemovals: [{ path: worktree.path, state: 'running', message: null, finishedAt: null }] };
    await click('Refresh');

    expect(document.querySelector('.local-refs-row')?.textContent).toContain('Removing');
    expect(document.querySelector('.local-refs-row')?.textContent).not.toContain('Missing');
  });

  it('re-reads the state and asks to check it when the result is not confirmed', async () => {
    await openWorktrees();
    const timedOut = new ServerRequestTimeoutError('The OpenTig server did not respond in time.');
    timedOut.unconfirmed = true;
    calls.removeWorktree.mockRejectedValue(timedOut);
    calls.snapshot.mockClear();
    await startRemoval();

    expect(document.querySelector('.local-refs-danger-error')?.textContent).toContain(UNCONFIRMED_RESULT_MESSAGE);
    expect(document.querySelector('.local-refs-error')).toBeNull();
    expect(calls.snapshot).toHaveBeenCalled();
  });

  it('cleans up an incomplete worktree through its own request, never a forced removal', async () => {
    await openWorktrees();
    calls.worktreeDetails.mockResolvedValue({ ...details, prunable: 'gitdir file points to non-existent location', available: false, leftoverFiles: true });
    await click('Refresh');
    await vi.waitFor(async () => { await settle(); button('Clean up entry'); });
    calls.removeWorktree.mockResolvedValue({ status: 'stale' });

    await click('Clean up entry');
    expect(document.querySelector('.local-refs-confirm')?.textContent).toContain('stay on disk');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.local-refs-confirm button')][0]!.click());
    await settle();

    expect(calls.removeWorktree).toHaveBeenCalledWith(expect.objectContaining({ path: worktree.path, force: false, cleanupOnly: true }));
    expect(document.querySelector('.local-refs-danger-error')?.textContent).toContain('review: The worktree moved');
  });

  it('prefers the notice the server kept over repeating the same failure', async () => {
    await openWorktrees();
    calls.removeWorktree.mockImplementation(async () => {
      snapshot = { ...snapshot, worktreeRemovals: [{ path: worktree.path, state: 'failed', message: 'Could not remove /sample/review: Refused.', finishedAt: '2026-10-30T11:00:00.000Z' }] };
      throw new Error('Refused.');
    });
    await startRemoval();

    expect(document.querySelector('.local-refs-removal-notice')?.textContent).toContain('Could not remove /sample/review: Refused.');
    expect(document.querySelectorAll('.local-refs-error')).toHaveLength(1);
  });

  it('explains what a partial removal left and lets the user dismiss it', async () => {
    await openWorktrees();
    calls.removeWorktree.mockImplementation(async () => {
      snapshot = { branches: [local], worktrees: [], remotes: [],
        worktreeRemovals: [{ path: worktree.path, state: 'partial', message: 'Some files are still on disk.', finishedAt: '2026-10-30T10:00:00.000Z' }] };
      return { status: 'partial', path: worktree.path, branch: 'review', recentRepositories: [], message: 'Some files are still on disk.' };
    });
    await startRemoval();

    expect(calls.mutated).toHaveBeenCalledWith([]);
    expect(document.querySelector('.local-refs-removal-notice')?.textContent).toContain('Some files are still on disk.');
    await click('Dismiss');
    expect(document.querySelector('.local-refs-removal-notice')).toBeNull();

    // It stays dismissed when the dialog opens again.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(document.querySelector('.local-refs-removal-notice')).toBeNull();
  });
});
