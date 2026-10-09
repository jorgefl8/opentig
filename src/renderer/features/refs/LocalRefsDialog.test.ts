// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BranchInfo, LocalRefsSnapshot, RemoteBranchDetails } from '@shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';

const calls = vi.hoisted(() => ({ snapshot: vi.fn(), details: vi.fn(), remoteDetails: vi.fn(), create: vi.fn(), deleteRemote: vi.fn(), fetch: vi.fn(), pr: vi.fn(), mutated: vi.fn(), busy: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: {
  refs: { localRefsSnapshot: calls.snapshot, branchDetails: calls.details, remoteBranchDetails: calls.remoteDetails,
    createTrackingBranch: calls.create, deleteRemoteBranch: calls.deleteRemote, fetchBranches: calls.fetch },
  github: { findPullRequestForBranch: calls.pr },
} }));
import { LocalRefsDialog } from './LocalRefsDialog';

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
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
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
