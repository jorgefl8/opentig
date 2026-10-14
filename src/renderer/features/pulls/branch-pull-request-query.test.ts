// @vitest-environment jsdom
import { QueryClient, QueryObserver, focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestSummary } from '@shared/contracts';
import { branchPullRequestQueryOptions } from './branch-pull-request-query';
import { queryKeys, resetGitHubQueries } from '@/lib/query-client';

const { find } = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: { findPullRequestForBranch: find } } }));
let client: QueryClient;
let unsubscribe: (() => void) | undefined;
const pull = (state: PullRequestSummary['state'], number = 1) => ({ state, number }) as PullRequestSummary;

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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

async function observe(enabled = true) {
  const observer = new QueryObserver(client, branchPullRequestQueryOptions('repo', 'feature', enabled));
  unsubscribe = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  return observer;
}

describe('branch pull request refresh', () => {
  it.each(['CLOSED', 'MERGED', null] as const)('rechecks %s results and detects a reused branch', async state => {
    find.mockResolvedValue(state ? pull(state) : null);
    const observer = await observe();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(find).toHaveBeenCalledTimes(1);
    find.mockResolvedValue(pull('OPEN', 2));
    await vi.advanceTimersByTimeAsync(1);
    expect(observer.getCurrentResult().data).toMatchObject({ number: 2, state: 'OPEN' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('pauses timers while hidden and refreshes on focus, reconnect, account reset and manual refresh', async () => {
    find.mockResolvedValue(pull('MERGED'));
    await observe();
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(find).toHaveBeenCalledTimes(1);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(find).toHaveBeenCalledTimes(2);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(find).toHaveBeenCalledTimes(3);
    await resetGitHubQueries(client, ['repo']);
    expect(find).toHaveBeenCalledTimes(4);
    await client.invalidateQueries({ queryKey: queryKeys.branchPullRequest('repo', 'feature') });
    expect(find).toHaveBeenCalledTimes(5);
  });

  it('retries errors at the active cadence without spinning, and stops when disabled', async () => {
    find.mockRejectedValue(new Error('offline'));
    const observer = await observe();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(find).toHaveBeenCalledTimes(1);
    find.mockResolvedValue(pull('OPEN'));
    await vi.advanceTimersByTimeAsync(1);
    expect(observer.getCurrentResult().data?.state).toBe('OPEN');
    observer.setOptions(branchPullRequestQueryOptions('repo', 'feature', false));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(find).toHaveBeenCalledTimes(2);
  });
});
