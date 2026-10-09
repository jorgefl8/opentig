// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestSummary } from '../../shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BranchPullRequestMenu } from './BranchPullRequestMenu';

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
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(BranchPullRequestMenu, {
    pullRequest: pr, onOpenPullRequest, mobile, onNavigate,
  }))));
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

it('keeps the PR title tooltip visible on hover and hides it while choosing a destination', async () => {
  await render();
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    trigger().dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  expect(document.querySelector('[data-slot="tooltip-content"][data-open]')?.textContent).toContain(pullRequest.title);
  await click(trigger());
  expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
  expect(choice('Open in OpenTig')).toBeDefined();
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
