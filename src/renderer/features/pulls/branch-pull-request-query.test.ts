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

describe('failures', () => {
  const failure = (code: string, retryable?: boolean) => Object.assign(new Error('Failed.'), { detail: { code, operation: 'gh-pr-for-branch', message: 'Failed.', ...(retryable ? { retryable } : {}) } });

  it.each(['GH_ACCESS_DENIED', 'GH_AUTH_REQUIRED', 'GH_ACCOUNT_MISSING', 'GH_ACCOUNT_UNRESOLVED'])('stops checking after %s until an account change or manual refresh', async code => {
    find.mockRejectedValue(failure(code));
    const observer = await observe();
    await vi.advanceTimersByTimeAsync(600_000);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(find).toHaveBeenCalledTimes(1);

    find.mockResolvedValue(pull('OPEN'));
    await resetGitHubQueries(client, ['repo']);
    expect(find).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data?.state).toBe('OPEN');

    find.mockRejectedValue(failure(code));
    await client.invalidateQueries({ queryKey: queryKeys.branchPullRequest('repo', 'feature') });
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('waits five minutes after a rate limit', async () => {
    find.mockRejectedValue(failure('GH_RATE_LIMITED'));
    await observe();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(find).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('retries a retryable failure once after five seconds, as when the network returns after waking', async () => {
    find.mockRejectedValueOnce(failure('GH_PROCESS_FAILED', true)).mockResolvedValue(pull('OPEN'));
    const observer = await observe();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(find).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(find).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data?.state).toBe('OPEN');
  });
});

it('discards an old account response that resolves after account queries reset', async () => {
  let resolvePrevious!: (value: PullRequestSummary) => void;
  find.mockReturnValueOnce(new Promise<PullRequestSummary>(resolve => { resolvePrevious = resolve; }))
    .mockResolvedValue(pull('OPEN', 2));
  const observer = await observe();
  expect(find).toHaveBeenCalledOnce();
  await resetGitHubQueries(client, ['repo']);
  expect(observer.getCurrentResult().data).toMatchObject({ number: 2, state: 'OPEN' });
  resolvePrevious(pull('MERGED', 1));
  await vi.advanceTimersByTimeAsync(0);
  expect(observer.getCurrentResult().data).toMatchObject({ number: 2, state: 'OPEN' });
});

it('refreshes on reconnect while hidden even when the previous result is fresh', async () => {
  find.mockResolvedValue(pull('CLOSED'));
  const observer = await observe();
  focusManager.setFocused(false);
  onlineManager.setOnline(false);
  find.mockResolvedValue(pull('OPEN', 2));
  onlineManager.setOnline(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(find).toHaveBeenCalledTimes(2);
  expect(observer.getCurrentResult().data).toMatchObject({ number: 2, state: 'OPEN' });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(find).toHaveBeenCalledTimes(2);
});
