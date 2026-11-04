// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestDetails, PullRequestLiveState } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MobileChromeContext, type MobileChromeHosts } from '@/components/mobile-chrome-context';
import { queryKeys } from '@/lib/query-client';
import { PullRequestViewer } from './PullRequestViewer';

const api = vi.hoisted(() => ({ getPullRequest: vi.fn(), getPullRequestLiveState: vi.fn(), getPullRequestDiff: vi.fn(), getPullRequestCommits: vi.fn(), getPullRequestConversation: vi.fn(), updatePullRequest: vi.fn(), repositoryAccount: vi.fn() }));
const browser = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('@/lib/browser-capabilities', async (original) => ({ ...await original<object>(), openExternalUrl: browser.openExternalUrl }));

const details: PullRequestDetails = {
  number: 7, title: 'Sample change', state: 'OPEN', isDraft: false, author: 'sample', authorAvatarUrl: null, headRefName: 'feature', headRefOid: 'a'.repeat(40), baseRefName: 'main', baseRefOid: 'b'.repeat(40),
  updatedAt: '2026-01-01T00:00:00Z', url: 'https://github.com/sample/demo/pull/7', reviewDecision: 'REVIEW_REQUIRED', additions: 1, deletions: 0, checksState: 'PENDING', body: '', changedFiles: 1, labels: [], commits: [],
};
function live(overrides: Partial<PullRequestLiveState> = {}): PullRequestLiveState {
  return {
    id: 'PR', number: 7, state: 'OPEN', isDraft: false, headRefOid: 'a'.repeat(40), headRefName: 'feature', baseRefName: 'main', updatedAt: details.updatedAt, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', latestReviews: [],
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
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 1 });
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.resetAllMocks();
});
// A new head reloads the details, so reads settle over several ticks.
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
  expect(container.querySelector('.pr-review')).toBeNull();
  api.getPullRequestLiveState.mockResolvedValue(live({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }));
  await refetchLive();
  expect(container.querySelector('.pr-status')?.textContent).toContain('Ready to merge');
  expect(container.querySelector('.pr-review')?.textContent).toBe('Approved');
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

it('says how the checks stand, and opens them from there', async () => {
  await render();
  expect(container.querySelector('.pr-checks-trigger')?.textContent).toBe('1 of 3 checks failing');
  await act(async () => container.querySelector<HTMLButtonElement>('.pr-checks-trigger')!.click());
  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Checks');
  expect(container.querySelector('.pr-checks-panel')).not.toBeNull();
});

it.each([
  ['a draft', { isDraft: true, mergeStateStatus: 'DRAFT' }, 'Draft'],
  ['a merged PR', { state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }, 'Merged into main'],
  ['a closed PR', { state: 'CLOSED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }, 'Closed'],
] as const)('leads the status line with the state of %s', async (_name, overrides, label) => {
  api.getPullRequestLiveState.mockResolvedValue(live(overrides as Partial<PullRequestLiveState>));
  await render();
  expect(container.querySelector('.pr-status')?.textContent?.trim()).toBe(label);
});

it('keeps the author, time and labels as quiet text', async () => {
  api.getPullRequest.mockResolvedValue({ ...details, labels: [{ name: 'bug', color: 'ff0000' }, { name: 'docs', color: '00ff00' }] });
  await render();
  const meta = container.querySelector('.pr-viewer-meta')!;
  expect(meta.textContent).toContain('feature → main');
  expect(meta.textContent).toContain('sample');
  expect(meta.querySelector('time')?.getAttribute('datetime')).toBe(details.updatedAt);
  expect(meta.querySelector('.pr-labels')?.textContent).toBe('bug, docs');
  expect(meta.querySelector('.pr-labels')?.getAttribute('style')).toBeNull();
});

it('edits in place, and comes back to the same tab with the menu focused', async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="More pull request actions"]')!.click());
  await settle();
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'Edit title and description…')!.click());
  await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="tablist"][aria-label="Pull request view"]')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('#edit-pr-title')?.value).toBe('Sample change');
  expect(document.activeElement).toBe(container.querySelector('#edit-pr-title'));
  await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === 'Cancel')!.click());
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  await settle();
  expect(container.querySelector('#edit-pr-title')).toBeNull();
  expect(container.querySelector('[role="tablist"][aria-label="Pull request view"]')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector('[aria-label="More pull request actions"]'));
  expect(api.updatePullRequest).not.toHaveBeenCalled();
});

it('keeps the auto-merge note visible even when the PR is in conflict', async () => {
  api.getPullRequestLiveState.mockResolvedValue(live({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', autoMerge: { method: 'SQUASH' } }));
  await render();
  expect(statusText()).toContain('Conflicts with main');
  expect(container.querySelector('.pr-auto-merge')?.textContent).toBe('Auto-merge · Squash');
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
  expect(statusText()).toContain("Actions unavailable: couldn't load the current status.");
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

it('shows each reviewer\'s verdict and marks those before the latest commit', async () => {
  api.getPullRequestLiveState.mockResolvedValue(live({ latestReviews: [
    { author: { login: 'ana', avatarUrl: null, isBot: false }, verdict: 'APPROVED', outdated: false },
    { author: { login: 'ben', avatarUrl: null, isBot: false }, verdict: 'CHANGES_REQUESTED', outdated: true },
  ] }));
  await render();
  expect([...container.querySelectorAll('.pr-reviewer')].map(item => item.textContent)).toEqual(['Approved by ana', 'Changes requested by ben, before the latest commit']);
});

it('does not repeat a decision that a reviewer\'s verdict already gives', async () => {
  api.getPullRequestLiveState.mockResolvedValue(live({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', latestReviews: [{ author: { login: 'ana', avatarUrl: null, isBot: false }, verdict: 'APPROVED', outdated: false }] }));
  await render();
  expect(container.querySelector('.pr-review')).toBeNull();
  expect(container.querySelector('.pr-reviewer')?.textContent).toBe('Approved by ana');
});

it('shows the header from the list at once, and fills in the rest when the details arrive', async () => {
  const { body: _body, changedFiles: _files, labels: _labels, commits: _commits, baseRefOid: _base, ...summary } = details;
  client.setQueryData(queryKeys.pulls('repo', ['OPEN']), [{ ...summary, title: 'From the list' }]);
  let resolve!: (value: PullRequestDetails) => void;
  api.getPullRequest.mockReturnValue(new Promise((done) => { resolve = done; }));
  await render();
  expect(container.querySelector('.pr-viewer-heading h2')?.textContent).toBe('From the list #7');
  expect(container.querySelector('.pr-viewer-meta')?.textContent).toContain('feature → main');
  expect(container.querySelector('.pr-counters')?.textContent).toBe('+1 −0');
  expect(container.querySelector('.pr-description-skeleton')).not.toBeNull();
  expect(container.textContent).not.toContain('Loading pull request');
  await act(async () => resolve(details));
  await settle();
  expect(container.querySelector('.pr-viewer-heading h2')?.textContent).toBe('Sample change #7');
  expect(container.querySelector('.pr-counters')?.textContent).toBe('1 file +1 −0');
  expect(container.querySelector('.pr-description-skeleton')).toBeNull();
});

it('shows the shape of a PR it knows nothing about yet, instead of a spinner', async () => {
  api.getPullRequest.mockReturnValue(new Promise(() => {}));
  await render();
  expect(container.querySelector('.pr-viewer-skeleton')?.getAttribute('aria-label')).toBe('Loading pull request #7');
  expect(container.querySelector('.spinner')).toBeNull();
});

it('keeps a visited tab as it was, instead of reading it again on return', async () => {
  api.getPullRequestConversation.mockResolvedValue({ entries: [], truncated: false, partial: false });
  api.getPullRequestDiff.mockResolvedValue({ path: 'pull/7', patch: '', binary: false, truncated: false, lineCount: 0 });
  await render();
  const open = async (name: string) => {
    await act(async () => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent === name)!.click());
    await settle();
  };
  for (const name of ['Comments', 'Code', 'Summary', 'Comments', 'Code']) await open(name);
  expect(api.getPullRequestConversation).toHaveBeenCalledTimes(1);
  expect(api.getPullRequestDiff).toHaveBeenCalledTimes(1);
  expect(api.getPullRequestDiff).toHaveBeenCalledWith('repo', 7, { baseOid: details.baseRefOid, headOid: details.headRefOid });
  expect(container.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
});

it('does not read the conversation until Comments is open', async () => {
  await render();
  expect(api.getPullRequestConversation).not.toHaveBeenCalled();
});

it('reads the status alongside the details rather than after them', async () => {
  api.getPullRequest.mockReturnValue(new Promise(() => {}));
  await render();
  expect(api.getPullRequestLiveState).toHaveBeenCalledWith('repo', 7);
});

it('on a phone puts its number and branches in the top bar, and floats one thing per tab', async () => {
  const hosts: MobileChromeHosts = { title: document.createElement('div'), actions: document.createElement('div'), float: document.createElement('div') };
  document.body.append(hosts.title!, hosts.actions!, hosts.float!);
  api.getPullRequestLiveState.mockResolvedValue(live({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }));
  api.getPullRequestConversation.mockResolvedValue({ entries: [], truncated: false, partial: false });
  api.getPullRequestDiff.mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(MobileChromeContext.Provider, { value: hosts }, createElement(PullRequestViewer, {
    repositoryId: 'repo', prNumber: 7, diffView: 'unified', themeType: 'dark', wrapLines: false, onDiffViewChange: vi.fn(), onWrapLinesChange: vi.fn(), onClose: vi.fn(), onSelectPullRequest: vi.fn(),
  }))))));
  await settle();
  expect(hosts.title!.textContent).toBe('#7feature → main');
  expect(container.querySelector('.pr-number')).toBeNull();
  const floating = () => [...hosts.float!.querySelectorAll('button')].map((item) => item.textContent?.trim());
  const open = async (name: string) => {
    await act(async () => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent === name)!.click());
    await settle();
  };
  expect(floating()).toEqual(['Merge']);
  await open('Comments');
  expect(floating()).toEqual(['Write a comment']);
  await open('Checks');
  expect(floating()).toEqual([]);
  await open('Timeline');
  expect(floating()).toEqual([]);
  await open('Code');
  expect(floating()).toEqual([]);
  expect(container.querySelector('.pr-viewer')?.getAttribute('data-tab')).toBe('diff');
  await open('Summary');
  expect(floating()).toEqual(['Merge']);
});
