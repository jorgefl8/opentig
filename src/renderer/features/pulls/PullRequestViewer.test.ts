// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestDetails, PullRequestLiveState } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryKeys } from '@/lib/query-client';
import { PullRequestViewer } from './PullRequestViewer';

const api = vi.hoisted(() => ({ getPullRequest: vi.fn(), getPullRequestLiveState: vi.fn(), getPullRequestDiff: vi.fn(), getPullRequestCommits: vi.fn() }));
const browser = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('@/lib/browser-capabilities', async (original) => ({ ...await original<object>(), openExternalUrl: browser.openExternalUrl }));

const details: PullRequestDetails = {
  number: 7, title: 'Sample change', state: 'OPEN', isDraft: false, author: 'sample', authorAvatarUrl: null, headRefName: 'feature', headRefOid: 'a'.repeat(40), baseRefName: 'main', baseRefOid: 'b'.repeat(40),
  updatedAt: '2026-01-01T00:00:00Z', url: 'https://github.com/sample/demo/pull/7', reviewDecision: 'REVIEW_REQUIRED', additions: 1, deletions: 0, checksState: 'PENDING', body: '', changedFiles: 1, labels: [], commits: [],
};
function live(overrides: Partial<PullRequestLiveState> = {}): PullRequestLiveState {
  return {
    id: 'PR', number: 7, state: 'OPEN', isDraft: false, headRefOid: 'a'.repeat(40), headRefName: 'feature', baseRefName: 'main', updatedAt: details.updatedAt, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED',
    isCrossRepository: false, stack: 'none', autoMerge: null, mergeQueue: { enabled: false, queued: false }, behindBy: 0,
    checks: { rollup: 'FAILING', truncated: false, partial: false, items: [
      { name: 'lint', workflow: 'CI', result: 'pass', required: false, url: 'https://github.com/sample/demo/runs/1' },
      { name: 'build', workflow: 'CI', result: 'pending', required: false, url: null },
      { name: 'test', workflow: 'CI', result: 'fail', required: true, url: 'https://github.com/sample/demo/runs/2' },
    ] },
    head: { repositoryId: null, owner: null, defaultBranch: null, refOid: null }, repository: { methods: ['MERGE'], defaultMethod: 'MERGE', autoMergeAllowed: false, deleteBranchOnMerge: false },
    viewer: { canWrite: true, canUpdate: true, didAuthor: false, canUpdateBranch: true, canDeleteBranch: true }, ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.getPullRequest.mockResolvedValue(details);
  api.getPullRequestLiveState.mockResolvedValue(live());
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.resetAllMocks();
});
// The live state starts once the details arrive, and a new head reloads them, so reads settle over several ticks.
async function settle() {
  for (let tick = 0; tick < 6; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestViewer, {
    repositoryId: 'repo', prNumber: 7, diffView: 'unified', themeType: 'dark', wrapLines: false, onDiffViewChange: vi.fn(), onWrapLinesChange: vi.fn(), onClose: vi.fn(), onSelectPullRequest: vi.fn(),
  })))));
  await settle();
}
const statusText = () => container.querySelector('.pr-viewer-status')?.textContent ?? '';
async function refetchLive() {
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.pullRequestLiveState('repo', 7) }); });
  await settle();
}

it('shows why the PR is blocked once, instead of repeating it in the review badge', async () => {
  await render();
  expect(container.querySelector('.pr-status')?.textContent).toContain('Review required');
  expect(container.querySelector('.pr-review-badge')).toBeNull();
  api.getPullRequestLiveState.mockResolvedValue(live({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }));
  await refetchLive();
  expect(container.querySelector('.pr-status')?.textContent).toContain('Ready to merge');
  expect(container.querySelector('.pr-review-badge')?.textContent).toBe('Approved');
});

it('groups individual checks with failures first, marks required ones and opens their run', async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('.pr-checks-trigger')!.click());
  const groups = [...document.querySelectorAll('.pr-checks-group')].map(group => [group.querySelector('h4')?.textContent, ...[...group.querySelectorAll('.pr-check-text strong')].map(name => name.textContent)]);
  expect(groups).toEqual([['Needs attention1', 'test'], ['In progress1', 'build'], ['Completed1', 'lint']]);
  expect([...document.querySelectorAll('.pr-check-required')].map(chip => chip.closest('.pr-check-row')?.querySelector('strong')?.textContent)).toEqual(['test']);
  expect([...document.querySelectorAll('.pr-check-row')].find(row => row.textContent?.includes('build'))?.tagName).toBe('DIV');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button.pr-check-row')].find(row => row.textContent?.includes('test'))!.click());
  expect(browser.openExternalUrl).toHaveBeenCalledWith('https://github.com/sample/demo/runs/2');
});

it('does not claim totals for a truncated list, and links to the rest', async () => {
  api.getPullRequestLiveState.mockResolvedValue(live({ checks: { ...live().checks, truncated: true } }));
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('.pr-checks-trigger')!.click());
  expect(document.querySelector('.pr-checks-group h4')?.textContent).toBe('Needs attention');
  await act(async () => document.querySelector<HTMLButtonElement>('.pr-checks-all')!.click());
  expect(browser.openExternalUrl).toHaveBeenCalledWith('https://github.com/sample/demo/pull/7/checks');
});

it('keeps the auto-merge badge visible even when the PR is in conflict', async () => {
  api.getPullRequestLiveState.mockResolvedValue(live({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', autoMerge: { method: 'SQUASH' } }));
  await render();
  expect(statusText()).toContain('Conflicts with main');
  expect(container.querySelector('.pr-auto-merge-badge')?.textContent).toBe('Auto-merge · Squash');
});

it('keeps the last status with a notice when a refresh fails, and retries', async () => {
  await render();
  api.getPullRequestLiveState.mockRejectedValue(new Error('offline'));
  await refetchLive();
  expect(statusText()).toContain('Review required');
  expect(statusText()).toContain("Couldn't refresh. Showing the last status.");
  api.getPullRequestLiveState.mockResolvedValue(live());
  await act(async () => container.querySelector<HTMLButtonElement>('.pr-live-notice button')!.click());
  await settle();
  expect(container.querySelector('.pr-live-notice')).toBeNull();
});

it('falls back to the stored checks summary when the status cannot be read', async () => {
  api.getPullRequestLiveState.mockRejectedValue(new Error('offline'));
  await render();
  expect(statusText()).toContain('Checks pending');
  expect(statusText()).toContain("Couldn't load the current status.");
  expect(container.querySelector('.pr-checks-trigger')).toBeNull();
});

it('reloads the details when the live state reports a new head', async () => {
  await render();
  expect(api.getPullRequest).toHaveBeenCalledTimes(1);
  api.getPullRequestLiveState.mockResolvedValue(live());
  await refetchLive();
  expect(api.getPullRequest).toHaveBeenCalledTimes(1);
  api.getPullRequestLiveState.mockResolvedValue(live({ headRefOid: 'c'.repeat(40), updatedAt: '2026-01-02T00:00:00Z' }));
  await refetchLive();
  expect(api.getPullRequest).toHaveBeenCalledTimes(2);
});

it('does not read the live state of a PR that failed to load', async () => {
  api.getPullRequest.mockRejectedValue(new Error('Not found'));
  await render();
  expect(api.getPullRequestLiveState).not.toHaveBeenCalled();
});
