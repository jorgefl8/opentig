// @vitest-environment jsdom
import { QueryClient, QueryObserver, focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestLiveState } from '@shared/contracts';
import { GhOperationError } from '@shared/errors';
import { queryKeys, resetGitHubQueries } from '@/lib/query-client';
import { pullRequestLiveStateQueryOptions, queriesOutdatedByLiveState } from './pull-request-live-state-query';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: { getPullRequestLiveState: read } } }));
let client: QueryClient;
let unsubscribe: (() => void) | undefined;
function live(overrides: Partial<PullRequestLiveState> = {}): PullRequestLiveState {
  return {
    id: 'PR', number: 1, state: 'OPEN', isDraft: false, headRefOid: 'a', headRefName: 'feature', baseRefName: 'main', updatedAt: '1', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, latestReviews: [],
    isCrossRepository: false, stack: 'none', autoMerge: null, mergeQueue: { enabled: false, queued: false }, behindBy: 0, checks: { rollup: 'PASSING', items: [], truncated: false, partial: false },
    head: { repositoryId: null, owner: null, defaultBranch: null, refOid: null }, repository: { methods: ['MERGE'], defaultMethod: 'MERGE', autoMergeAllowed: false, deleteBranchOnMerge: false },
    viewer: { canWrite: true, canUpdate: true, didAuthor: false, canUpdateBranch: true, canDeleteBranch: true }, ...overrides,
  };
}
const rateLimited = () => new GhOperationError({ code: 'GH_RATE_LIMITED', operation: 'gh-pr-live-state', message: 'Rate limited.' });

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 } } });
  client.mount();
});
afterEach(() => {
  unsubscribe?.();
  client.unmount();
  client.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.resetAllMocks();
});

async function observe() {
  const observer = new QueryObserver(client, pullRequestLiveStateQueryOptions('repo', 1));
  unsubscribe = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  return observer;
}

describe('pull request live state refresh', () => {
  it.each([
    ['a settled open PR', {}, 60_000],
    ['running checks', { checks: { rollup: 'PENDING', items: [], truncated: false, partial: false } }, 45_000],
    ['a pending check under a failing rollup', { checks: { rollup: 'FAILING', items: [{ name: 'test', workflow: null, result: 'pending', required: false, url: null }], truncated: false, partial: false } }, 45_000],
    ['armed auto-merge', { autoMerge: { method: 'SQUASH' } }, 45_000],
    ['a queued PR', { mergeQueue: { enabled: true, queued: true } }, 45_000],
  ] as const)('refreshes %s on its own cadence', async (_name, overrides, interval) => {
    read.mockResolvedValue(live(overrides as Partial<PullRequestLiveState>));
    await observe();
    await vi.advanceTimersByTimeAsync(interval - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(['MERGED', 'CLOSED'] as const)('does not poll a %s PR, but checks again when returning to the window', async state => {
    read.mockResolvedValue(live({ state, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }));
    await observe();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(read).toHaveBeenCalledTimes(1);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('checks an unknown mergeability often for a minute, then settles to once a minute', async () => {
    read.mockResolvedValue(live({ mergeable: 'UNKNOWN' }));
    await observe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(read).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(8);
  });

  it('starts a new fast window when GitHub recomputes mergeability later', async () => {
    read.mockResolvedValueOnce(live({ mergeable: 'UNKNOWN' })).mockResolvedValueOnce(live());
    await observe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockResolvedValue(live({ mergeStateStatus: 'UNKNOWN' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('stops polling at a rate limit until the window comes back', async () => {
    read.mockResolvedValueOnce(live()).mockRejectedValueOnce(rateLimited()).mockResolvedValue(live({ updatedAt: '2' }));
    const observer = await observe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data?.updatedAt).toBe('1');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(read).toHaveBeenCalledTimes(2);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3);
    expect(observer.getCurrentResult().data?.updatedAt).toBe('2');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it.each(['GH_ACCESS_DENIED', 'GH_AUTH_REQUIRED', 'GH_ACCOUNT_MISSING', 'GH_ACCOUNT_UNRESOLVED'] as const)('stops asking after %s until the user acts', async (code) => {
    read.mockRejectedValue(new GhOperationError({ code, operation: 'gh-pr-live-state', message: 'Needs you.' }));
    await observe();
    await vi.advanceTimersByTimeAsync(600_000);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue(live());
    await resetGitHubQueries(client, ['repo']);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('tries once more soon after a failure that may pass by itself', async () => {
    read.mockRejectedValueOnce(new GhOperationError({ code: 'GH_PROCESS_FAILED', operation: 'gh-pr-live-state', message: 'Could not connect.', retryable: true })).mockResolvedValue(live());
    const observer = await observe();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data?.number).toBe(1);
  });

  it('keeps the last state after a failed refresh and keeps trying', async () => {
    read.mockResolvedValueOnce(live()).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(live({ updatedAt: '2' }));
    const observer = await observe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(observer.getCurrentResult()).toMatchObject({ isError: true, data: { updatedAt: '1' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(observer.getCurrentResult()).toMatchObject({ isError: false, data: { updatedAt: '2' } });
  });

  it('retries a first failure once a minute', async () => {
    read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(live());
    const observer = await observe();
    expect(observer.getCurrentResult().isError).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(observer.getCurrentResult().data?.number).toBe(1);
  });

  it('pauses while hidden and refreshes on reconnect', async () => {
    read.mockResolvedValue(live());
    await observe();
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(read).toHaveBeenCalledTimes(1);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('discards the previous account\'s state when the account changes', async () => {
    let resolvePrevious!: (value: PullRequestLiveState) => void;
    read.mockReturnValueOnce(new Promise<PullRequestLiveState>(resolve => { resolvePrevious = resolve; })).mockResolvedValue(live({ viewer: { ...live().viewer, canWrite: false } }));
    const observer = await observe();
    await resetGitHubQueries(client, ['repo']);
    expect(observer.getCurrentResult().data?.viewer.canWrite).toBe(false);
    resolvePrevious(live());
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().data?.viewer.canWrite).toBe(false);
  });
});

describe('queriesOutdatedByLiveState', () => {
  it('refreshes details, commits and code when the head changes', () => {
    expect(queriesOutdatedByLiveState('repo', live(), live({ headRefOid: 'b', updatedAt: '2' }))).toEqual([
      queryKeys.pullRequest('repo', 1), queryKeys.pullRequestConversation('repo', 1), queryKeys.pullRequestCommits('repo', 1), queryKeys.pullRequestDiff('repo', 1),
    ]);
  });

  it('refreshes only the details and conversation when the PR was otherwise updated', () => {
    expect(queriesOutdatedByLiveState('repo', live(), live({ updatedAt: '2' }))).toEqual([queryKeys.pullRequest('repo', 1), queryKeys.pullRequestConversation('repo', 1)]);
  });

  it('refreshes nothing when nothing changed or another PR was selected', () => {
    expect(queriesOutdatedByLiveState('repo', live(), live())).toEqual([]);
    expect(queriesOutdatedByLiveState('repo', live(), live({ number: 2, headRefOid: 'b' }))).toEqual([]);
  });
});
