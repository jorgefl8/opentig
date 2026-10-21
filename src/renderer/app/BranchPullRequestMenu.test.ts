// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestSummary } from '../../shared/contracts';
import { BranchPullRequestMenu } from './BranchPullRequestMenu';
import { opentig } from '@/lib/opentig-api';

vi.mock('@/lib/opentig-api', () => ({ opentig: { github: { getPullRequestStack: vi.fn() } } }));

let root: Root;
let container: HTMLDivElement;
const onOpenPullRequest = vi.fn();
const onNavigate = vi.fn();
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

async function render(pr = pullRequest, mobile = false) {
  await act(async () => root.render(createElement(BranchPullRequestMenu, {
    repositoryId: 'repo', pullRequest: pr, onOpenPullRequest, mobile, onNavigate,
  })));
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
const trigger = () => container.querySelector<HTMLButtonElement>('button')!;
const choice = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === name)!;

it.each([
  { state: 'OPEN', isDraft: false }, { state: 'OPEN', isDraft: true }, { state: 'MERGED', isDraft: false },
] as const)('offers both destinations for $state PRs (draft: $isDraft) without opening GitHub on trigger click', async state => {
  await render({ ...pullRequest, ...state });
  expect(trigger().querySelector('.tabler-icon-external-link')).toBeNull();
  expect(trigger().querySelector('button')).toBeNull();
  expect(trigger().querySelector(state.state === 'MERGED' ? '.tabler-icon-git-merge' : '.tabler-icon-git-pull-request')).not.toBeNull();
  await click(trigger());
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain(pullRequest.title);
  expect(menu.textContent).toContain(state.state === 'MERGED' ? 'PR #12 · Merged into main' : state.isDraft ? 'PR #12 · Draft' : 'PR #12 · Open');
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
  expect(trigger().textContent).toBe('View merged PR #12');
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
