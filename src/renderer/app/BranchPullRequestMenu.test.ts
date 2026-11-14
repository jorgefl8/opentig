// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestSummary } from '../../shared/contracts';
import type { BranchInfo, WorktreeInfo } from '../../shared/git-types';
import { mergedBranchCleanUp, type MergedBranchCleanUp } from '@/features/pulls/merged-branch';
import { BranchPullRequestMenu } from './BranchPullRequestMenu';
import { opentig } from '@/lib/opentig-api';

vi.mock('@/lib/opentig-api', () => ({ opentig: { github: { getPullRequestStack: vi.fn() } } }));

let root: Root;
let container: HTMLDivElement;
const onOpenPullRequest = vi.fn();
const onNavigate = vi.fn();
const onCleanUp = vi.fn();
const onCreatePullRequest = vi.fn();
const external = vi.fn();
const pullRequest: PullRequestSummary = {
  number: 12, title: 'Preserve full branch names', state: 'OPEN', isDraft: false,
  author: 'sample', authorAvatarUrl: null, headRefName: 'feature', baseRefName: 'main',
  updatedAt: '2026-01-01T00:00:00Z', url: 'https://github.com/sample/project/pull/12',
  reviewDecision: null, additions: 1, deletions: 0, checksState: 'PASSING',
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'open').mockImplementation(external);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

async function render(pr = pullRequest, mobile = false, branch: { newCommits?: number | null; cleanUp?: MergedBranchCleanUp | null } = {}) {
  await act(async () => root.render(createElement(BranchPullRequestMenu, {
    repositoryId: 'repo', pullRequest: pr, onOpenPullRequest, mobile, onNavigate, onCleanUp, onCreatePullRequest, ...branch,
  })));
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
const trigger = () => container.querySelector<HTMLButtonElement>('button')!;
const choice = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === name)!;

it.each([
  { state: 'OPEN', isDraft: false }, { state: 'OPEN', isDraft: true }, { state: 'MERGED', isDraft: false },
  { state: 'CLOSED', isDraft: false },
] as const)('offers both destinations for $state PRs (draft: $isDraft) without opening GitHub on trigger click', async state => {
  await render({ ...pullRequest, ...state });
  expect(trigger().querySelector('.tabler-icon-external-link')).toBeNull();
  expect(trigger().querySelector('button')).toBeNull();
  const icon = state.state === 'MERGED' ? 'merge' : state.state === 'CLOSED' ? 'pull-request-closed' : state.isDraft ? 'pull-request-draft' : 'pull-request';
  expect(trigger().querySelector(`.tabler-icon-git-${icon}`)).not.toBeNull();
  const tone = state.state === 'MERGED' ? 'merged' : state.state === 'CLOSED' ? 'closed' : state.isDraft ? 'draft' : 'open';
  expect(trigger().classList.contains(`pr-state-${tone}`)).toBe(true);
  expect(trigger().textContent).toBe(state.isDraft ? '#12Draft' : state.state === 'MERGED' ? '#12Merged' : state.state === 'CLOSED' ? '#12Closed' : '#12');
  await click(trigger());
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain(pullRequest.title);
  expect(menu.textContent).toContain(state.state === 'MERGED' ? 'PR #12 · Merged into main' : state.state === 'CLOSED' ? 'PR #12 · Closed' : state.isDraft ? 'PR #12 · Draft' : 'PR #12 · Open');
  // The pull request's own size, as in its row in the GitHub list.
  expect(menu.textContent).toContain(' · +1 −0');
  expect(external).not.toHaveBeenCalled();
  expect(onOpenPullRequest).not.toHaveBeenCalled();
  await click(choice('Open in OpenTig'));
  expect(onOpenPullRequest).toHaveBeenCalledExactlyOnceWith(12);
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  await click(trigger());
  await click(choice('Open in GitHub'));
  expect(external).toHaveBeenCalledExactlyOnceWith(pullRequest.url, '_blank', 'noopener,noreferrer');
  expect(onOpenPullRequest).toHaveBeenCalledOnce();
  expect(onNavigate).toHaveBeenCalledTimes(2);
});

it('offers the same destinations in the mobile repository menu and closes it only after a choice', async () => {
  await render({ ...pullRequest, state: 'MERGED' }, true);
  expect(trigger().textContent).toBe('View merged pull request #12');
  await click(trigger());
  expect(onNavigate).not.toHaveBeenCalled();
  await click(choice('Open in OpenTig'));
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(onOpenPullRequest).toHaveBeenCalledExactlyOnceWith(12);
});

it.each([false, true])('opens native layers on demand beside the branch PR (mobile: %s)', async mobile => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(opentig.github.getPullRequestStack).mockResolvedValue({ number: 7, base: 'main', layers: [
    { number: 11, title: 'Base change', headRefName: 'base', state: 'MERGED', isDraft: false },
    { number: 12, title: 'Current change', headRefName: 'feature', state: 'OPEN', isDraft: false },
  ] });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(BranchPullRequestMenu, {
    repositoryId: 'repo', pullRequest: { ...pullRequest, stack: { number: 7, position: 2, size: 2, base: 'main' } },
    onOpenPullRequest, mobile, onNavigate,
  }))));
  const stackTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Stack 7, layer 2 of 2"]')!;
  expect(stackTrigger).not.toBeNull();
  expect(stackTrigger.closest('button')).toBe(stackTrigger);
  expect(opentig.github.getPullRequestStack).not.toHaveBeenCalled();
  await click(stackTrigger);
  await vi.waitFor(() => expect(document.querySelector('.pr-stack-layer[aria-current="true"]')?.textContent).toContain('#12'));
  expect(opentig.github.getPullRequestStack).toHaveBeenCalledExactlyOnceWith('repo', 12);
  expect(onNavigate).not.toHaveBeenCalled();
  await click([...document.querySelectorAll<HTMLButtonElement>('.pr-stack-layer')].find(item => item.textContent?.includes('#11'))!);
  expect(onOpenPullRequest).toHaveBeenCalledExactlyOnceWith(11);
  expect(onNavigate).toHaveBeenCalledOnce();
  client.clear();
});

it('does not offer a stack for a standalone branch PR', async () => {
  await render();
  expect(container.querySelector('.pr-stack-trigger')).toBeNull();
  expect(opentig.github.getPullRequestStack).not.toHaveBeenCalled();
});

const merged: PullRequestSummary = { ...pullRequest, state: 'MERGED' };
const branchInfo = (name: string, worktreePath: string | null = null): BranchInfo => ({
  name, fullName: `refs/heads/${name}`, current: false, remote: false, upstream: null, ahead: 0, behind: 0, worktreePath,
  oid: 'a'.repeat(40), shortOid: 'aaaaaaa', subject: '', author: '', date: '',
});
const worktreeInfo = (path: string, main: boolean, branch: string): WorktreeInfo => ({ path, oid: 'a'.repeat(40), branch, bare: false, detached: false, locked: null, prunable: null, main });
const checkout = { pullRequest: merged, branch: 'feature', repositoryPath: '/sample', branches: [branchInfo('main'), branchInfo('feature', '/sample')], worktrees: [worktreeInfo('/sample', true, 'feature')] };
const linked = { ...checkout, repositoryPath: '/sample-feature', branches: [branchInfo('main', '/sample'), branchInfo('feature', '/sample-feature')],
  worktrees: [worktreeInfo('/sample', true, 'main'), worktreeInfo('/sample-feature', false, 'feature')] };

it.each([
  { where: 'a main checkout', input: checkout, label: 'Switch to main and delete this branch…' },
  { where: 'a linked worktree', input: linked, label: 'Remove this worktree and delete the branch…' },
])('says a merged PR is the branch\'s own and offers to clean up $where', async ({ input, label }) => {
  const cleanUp = mergedBranchCleanUp(input)!;
  await render(merged, false, { newCommits: 0, cleanUp });
  expect(trigger().textContent).toBe('#12Merged');
  expect(trigger().getAttribute('aria-label')).toBe('View merged pull request #12');
  expect(container.textContent).not.toContain('Create PR');
  await click(trigger());
  expect(document.querySelector('.branch-pr-note')?.textContent).toBe('This is the pull request of the branch you have checked out. It is already merged and the branch has nothing new.');
  expect(choice('Create a new pull request')).toBeUndefined();
  await click(choice(label));
  // Leaving the branch and deleting it stay with the caller's existing flows.
  expect(onCleanUp).toHaveBeenCalledExactlyOnceWith(cleanUp);
  expect(onNavigate).toHaveBeenCalledOnce();
});

it('offers no clean-up when the base branch is missing locally or checked out in another worktree', () => {
  expect(mergedBranchCleanUp({ ...checkout, branches: [branchInfo('feature', '/sample')] })).toBeNull();
  expect(mergedBranchCleanUp({ ...checkout, branches: [branchInfo('main', '/sample-main'), branchInfo('feature', '/sample')] })).toBeNull();
  expect(mergedBranchCleanUp({ ...checkout, pullRequest: { ...merged, baseRefName: 'feature' } })).toBeNull();
});

it('offers the next pull request, not a clean-up, when the branch has commits after the merged one', async () => {
  await render(merged, false, { newCommits: 2, cleanUp: mergedBranchCleanUp(checkout) });
  expect(trigger().textContent).toBe('#12Merged+2 new');
  expect(trigger().getAttribute('aria-label')).toBe('View merged pull request #12, 2 commits on this branch came after it');
  const create = [...container.querySelectorAll('button')].find(item => item.textContent === 'Create PR')!;
  expect(trigger().contains(create)).toBe(false);
  await click(create);
  expect(onCreatePullRequest).toHaveBeenCalledOnce();
  await click(trigger());
  expect(document.querySelector('.branch-pr-note')?.textContent).toBe("This branch's pull request is merged, but the branch has 2 commits that came after it.");
  expect([...document.querySelectorAll('[role="menuitem"]')].some(item => /delete/i.test(item.textContent ?? ''))).toBe(false);
  await click(choice('Create a new pull request'));
  expect(onCreatePullRequest).toHaveBeenCalledTimes(2);
  expect(onCleanUp).not.toHaveBeenCalled();
  await render(merged, false, { newCommits: 1 });
  await click(trigger());
  expect(document.querySelector('.branch-pr-note')?.textContent).toContain('has 1 commit that came after it');
});

it('claims nothing about the branch while the merged head is unknown locally, and never for an open PR', async () => {
  await render(merged, false, { newCommits: null, cleanUp: mergedBranchCleanUp(checkout) });
  expect(trigger().textContent).toBe('#12Merged');
  await click(trigger());
  expect(document.querySelector('.branch-pr-note')?.textContent).toBe('This is the pull request of the branch you have checked out. It is already merged.');
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  await click(choice('Open in OpenTig'));
  await render(pullRequest, false, { newCommits: 3, cleanUp: mergedBranchCleanUp(checkout) });
  expect(trigger().textContent).toBe('#12');
  expect(container.textContent).not.toContain('Create PR');
  await click(trigger());
  expect(document.querySelector('.branch-pr-note')).toBeNull();
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
});

it('shows the new commits on the phone row, with both follow-ups in its menu', async () => {
  await render(merged, true, { newCommits: 2 });
  expect(trigger().textContent).toBe('View merged pull request #12+2 new');
  expect(container.textContent).not.toContain('Create PR');
  await click(trigger());
  await click(choice('Create a new pull request'));
  expect(onCreatePullRequest).toHaveBeenCalledOnce();
  expect(onNavigate).toHaveBeenCalledOnce();
  await render({ ...pullRequest, state: 'CLOSED' }, true);
  expect(trigger().textContent).toBe('View closed pull request #12');
});
