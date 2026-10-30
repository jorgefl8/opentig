// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestDetails, PullRequestLiveState } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { queryKeys } from '@/lib/query-client';
import { PullRequestActionBar } from './PullRequestActionBar';

const api = vi.hoisted(() => ({ runPullRequestAction: vi.fn(), repositoryAccount: vi.fn() }));
const refs = vi.hoisted(() => ({ fetch: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api, refs } }));
vi.mock('sileo', () => ({ sileo: toast }));

const oid = 'a'.repeat(40);
const details = { number: 7, title: 'Sample', state: 'OPEN', isDraft: false, headRefName: 'feature', baseRefName: 'main', url: 'https://github.com/sample/demo/pull/7' } as PullRequestDetails;
function live(overrides: Partial<PullRequestLiveState> = {}): PullRequestLiveState {
  return {
    id: 'PR', number: 7, state: 'OPEN', isDraft: false, headRefOid: oid, headRefName: 'feature', baseRefName: 'main', updatedAt: '1', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null,
    isCrossRepository: false, stack: 'none', autoMerge: null, mergeQueue: { enabled: false, queued: false }, behindBy: 0, checks: { rollup: 'NONE', items: [], truncated: false, partial: false },
    head: { repositoryId: 'R', owner: 'sample', defaultBranch: 'main', refOid: oid }, repository: { methods: ['MERGE', 'SQUASH'], defaultMethod: 'SQUASH', autoMergeAllowed: true, deleteBranchOnMerge: false },
    viewer: { canWrite: true, canUpdate: true, didAuthor: false, canUpdateBranch: true, canDeleteBranch: true }, ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const onRefresh = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 3 });
  refs.fetch.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 }, mutations: { networkMode: 'always', retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 5; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render(state: PullRequestLiveState = live()) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestActionBar, {
    repositoryId: 'repo', details, live: state, refreshing: false, statusLabel: null, onRefresh,
  })))));
  await settle();
}
const button = (label: string | RegExp) => [...document.querySelectorAll('button')].find(item => typeof label === 'string' ? item.textContent?.trim() === label : label.test(item.textContent ?? ''));
async function click(label: string | RegExp) {
  await act(async () => button(label)!.click());
  await settle();
}
const panel = () => container.querySelector('.pr-action-panel');
const expectedRequest = { repositoryId: 'repo', number: 7, expectedHeadOid: oid, expectedAccount: { login: 'sample', revision: 3 } };

describe('merging', () => {
  it('asks first, names the method, base and account, then merges with what was shown', async () => {
    api.runPullRequestAction.mockResolvedValue({ outcome: 'merged', state: live({ state: 'MERGED' }) });
    await render();
    await click('Merge');
    expect(api.runPullRequestAction).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain('Squash and merge #7 into main as @sample?');
    await click('Squash and merge');
    expect(api.runPullRequestAction).toHaveBeenCalledWith({ ...expectedRequest, action: 'merge', method: 'SQUASH' });
    expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Merged' }));
    expect(panel()).toBeNull();
    expect(refs.fetch).toHaveBeenCalledWith('repo');
  });

  it('cancels with Escape, without merging', async () => {
    await render();
    await click('Merge');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel()).toBeNull();
    expect(api.runPullRequestAction).not.toHaveBeenCalled();
  });

  it('withdraws the question when the state it asked about changes', async () => {
    await render();
    await click('Merge');
    expect(panel()).not.toBeNull();
    await render(live({ mergeStateStatus: 'BLOCKED' }));
    expect(panel()).toBeNull();
  });

  it('sends the branch removal only when ticked', async () => {
    api.runPullRequestAction.mockResolvedValue({ outcome: 'merged', state: live({ state: 'MERGED' }), branchDeleted: true });
    await render();
    await click('Merge');
    await act(async () => container.querySelector<HTMLElement>('.pr-delete-branch-option [data-slot="checkbox"]')!.click());
    await click('Squash and merge');
    expect(api.runPullRequestAction).toHaveBeenCalledWith({ ...expectedRequest, action: 'merge', method: 'SQUASH', deleteBranch: true });
    expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('feature deleted') }));
  });

  it('says so when the merge worked and the branch stayed', async () => {
    api.runPullRequestAction.mockResolvedValue({ outcome: 'merged', state: live({ state: 'MERGED' }), branchDeleted: false });
    await render();
    await click('Merge');
    await act(async () => container.querySelector<HTMLElement>('.pr-delete-branch-option [data-slot="checkbox"]')!.click());
    await click('Squash and merge');
    expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'Merged, but the branch was kept' }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ['GitHub removes it anyway', live({ repository: { ...live().repository, deleteBranchOnMerge: true } }), 'Merge'],
    ['a queue finishes later', live({ mergeQueue: { enabled: true, queued: false } }), 'Add to merge queue'],
    ['auto-merge finishes later', live({ mergeStateStatus: 'BLOCKED' }), 'Merge when ready'],
  ])('offers no branch removal when %s', async (_name, state, label) => {
    await render(state);
    await click(label);
    expect(panel()).not.toBeNull();
    expect(container.querySelector('.pr-delete-branch-option')).toBeNull();
  });
});

describe('failures', () => {
  it('shows GitHub\'s rejection and rereads the state', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    api.runPullRequestAction.mockRejectedValue(Object.assign(new Error('nope'), { detail: { code: 'GH_PROCESS_FAILED', operation: 'gh-pr-action', message: 'Pull Request is not mergeable' } }));
    await render();
    await click('Merge');
    await click('Squash and merge');
    expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ description: 'Pull Request is not mergeable' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['repository', 'repo', 'pull-request-state'] });
  });

  it.each([
    ['a client timeout', new ServerRequestTimeoutError('Server request timed out')],
    ['a server timeout', Object.assign(new Error('Timed out'), { detail: { code: 'TIMEOUT', operation: 'gh-pr-action', message: 'Timed out' } })],
  ])('after %s, says the action may have completed and rereads the state', async (_name, reason) => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    api.runPullRequestAction.mockRejectedValue(reason);
    await render();
    await click('Merge');
    await click('Squash and merge');
    expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have completed') }));
    expect(toast.error).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['repository', 'repo', 'pull-request-state'] });
  });

  it('asks for the account again when it changed', async () => {
    api.runPullRequestAction.mockRejectedValue(Object.assign(new Error('changed'), { detail: { code: 'GH_ACCOUNT_UNRESOLVED', operation: 'gh-pr-action', message: 'The GitHub account changed.' } }));
    await render();
    await click('Merge');
    await click('Squash and merge');
    expect(api.repositoryAccount).toHaveBeenCalledTimes(2);
  });

  it('keeps actions off while the account needs attention', async () => {
    api.repositoryAccount.mockResolvedValue({ state: 'error', login: null, revision: 3 });
    await render();
    expect(button('Merge')?.disabled).toBe(true);
  });
});

describe('what is offered', () => {
  it('runs reversible actions straight away', async () => {
    api.runPullRequestAction.mockResolvedValue({ outcome: 'done', state: live() });
    await render(live({ isDraft: true, mergeStateStatus: 'DRAFT' }));
    await click('Ready for review');
    expect(api.runPullRequestAction).toHaveBeenCalledWith({ ...expectedRequest, action: 'ready' });
    expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ready for review' }));
  });

  it('keeps armed auto-merge disarmable even during a conflict', async () => {
    api.runPullRequestAction.mockResolvedValue({ outcome: 'auto-merge-disabled', state: live() });
    await render(live({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', autoMerge: { method: 'SQUASH' } }));
    await click('Disable auto-merge');
    expect(api.runPullRequestAction).toHaveBeenCalledWith({ ...expectedRequest, action: 'disable-auto-merge' });
  });

  it('updates a branch by merge at once', async () => {
    api.runPullRequestAction.mockResolvedValue({ outcome: 'updated', state: live() });
    await render(live({ mergeStateStatus: 'BEHIND', behindBy: 2 }));
    await click('Update branch');
    expect(api.runPullRequestAction).toHaveBeenCalledWith({ ...expectedRequest, action: 'update-branch', method: 'MERGE' });
  });

  it('shows a reader no protected action', async () => {
    await render(live({ viewer: { canWrite: false, canUpdate: false, didAuthor: false, canUpdateBranch: false, canDeleteBranch: false } }));
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('Merging requires write access');
  });

  it('does not repeat a reason already on screen', async () => {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestActionBar, {
      repositoryId: 'repo', details, live: live({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), refreshing: false, statusLabel: 'Conflicts with main', onRefresh,
    })))));
    await settle();
    expect(container.querySelector('.pr-action-reason')).toBeNull();
  });

  it('sends a stack layer to GitHub', async () => {
    await render(live({ stack: 'member' }));
    expect(button(/Merge on GitHub/)).toBeDefined();
    expect(button('Merge')).toBeUndefined();
  });

  it('applies the returned state immediately', async () => {
    const next = live({ state: 'MERGED' });
    const setData = vi.spyOn(client, 'setQueryData');
    api.runPullRequestAction.mockResolvedValue({ outcome: 'merged', state: next });
    await render();
    await click('Merge');
    await click('Squash and merge');
    expect(setData).toHaveBeenCalledWith(queryKeys.pullRequestLiveState('repo', 7), next);
  });
});
