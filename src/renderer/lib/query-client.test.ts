import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { GITHUB_DATA_GC_MS, keepGitHubData, queryKeys, queryResourcesForScope, refreshGitHubQueries, resetGitHubQueries } from './query-client';

describe('renderer query policy', () => {
  it('discards old-account results in every repository while preserving Git data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: (value: string) => void;
    const key = queryKeys.pulls('repo-a', ['OPEN']);
    const pending = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<string>((resolve) => { release = resolve; }) });
    const ignored = pending.catch(() => undefined);
    client.setQueryData(queryKeys.pullRequestDiff('repo-b', 1), 'old diff');
    client.setQueryData(queryKeys.pullRequestLiveState('repo-b', 1), 'old live state');
    client.setQueryData(queryKeys.pullRequestCommits('repo-b', 1), 'old commits');
    client.setQueryData(queryKeys.pullRequestConversation('repo-b', 1), 'old conversation');
    client.setQueryData(queryKeys.releases('repo-b'), 'old releases');
    client.setQueryData(queryKeys.release('repo-b', 'v1'), 'old release');
    client.setQueryData(queryKeys.workflows('repo-b'), 'old workflows');
    client.setQueryData(queryKeys.runnableWorkflows('repo-b'), 'old runs');
    client.setQueryData(queryKeys.githubAccount('repo-a'), 'old account');
    client.setQueryData(queryKeys.githubAccounts, 'old inventory');
    client.setQueryData(queryKeys.githubCliStatus, 'old CLI status');
    client.setQueryData(queryKeys.status('repo-a'), 'git status');
    await resetGitHubQueries(client);
    await client.fetchQuery({ queryKey: key, queryFn: async () => 'new account' });
    release('late old account');
    await ignored;
    expect(client.getQueryData(key)).toBe('new account');
    expect(client.getQueryData(queryKeys.pullRequestDiff('repo-b', 1))).toBeUndefined();
    expect(client.getQueryData(queryKeys.pullRequestLiveState('repo-b', 1))).toBeUndefined();
    expect(client.getQueryData(queryKeys.pullRequestCommits('repo-b', 1))).toBeUndefined();
    expect(client.getQueryData(queryKeys.pullRequestConversation('repo-b', 1))).toBeUndefined();
    expect(client.getQueryData(queryKeys.releases('repo-b'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.release('repo-b', 'v1'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.workflows('repo-b'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.runnableWorkflows('repo-b'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.githubAccount('repo-a'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.githubAccounts)).toBeUndefined();
    expect(client.getQueryData(queryKeys.githubCliStatus)).toBeUndefined();
    expect(client.getQueryData(queryKeys.status('repo-a'))).toBe('git status');
    client.clear();
  });

  it('isolates every resource by repository and parameters', () => {
    expect(queryKeys.files('repo-a')).toEqual(['repository', 'repo-a', 'files']);
    expect(queryKeys.files('repo-b')).not.toEqual(queryKeys.files('repo-a'));
    expect(queryKeys.pulls('repo-a', ['OPEN', 'MERGED'])).toEqual(['repository', 'repo-a', 'pulls', 'OPEN', 'MERGED']);
    expect(queryKeys.search('repo-a', { query: 'one' })).not.toEqual(queryKeys.search('repo-a', { query: 'two' }));
  });

  it('maps refresh scopes without broad global invalidation', () => {
    expect(queryResourcesForScope('worktree', 'changes')).toEqual(['status']);
    expect(queryResourcesForScope('refs', 'history')).toEqual(['status', 'branches', 'history']);
    expect(queryResourcesForScope('unknown', 'files')).toEqual(['status', 'branches', 'worktrees', 'files']);
  });
});


it('invalidates only the repository and worktrees affected by an account selection', async () => {
  const client = new QueryClient();
  for (const id of ['a', 'a-worktree', 'b']) client.setQueryData(queryKeys.githubAccount(id), id);
  client.setQueryData(queryKeys.githubAccounts, 'inventory');
  await resetGitHubQueries(client, ['a', 'a-worktree']);
  expect(client.getQueryData(queryKeys.githubAccount('a'))).toBeUndefined();
  expect(client.getQueryData(queryKeys.githubAccount('a-worktree'))).toBeUndefined();
  expect(client.getQueryData(queryKeys.githubAccount('b'))).toBe('b');
  expect(client.getQueryData(queryKeys.githubAccounts)).toBe('inventory');
  client.clear();
});

it('refreshes global default metadata and followers without resetting explicitly pinned repositories', async () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.githubAccounts, 'old default');
  client.setQueryData(queryKeys.githubAccount('follower'), 'alice');
  client.setQueryData(queryKeys.githubAccount('fixed'), 'alice');
  await resetGitHubQueries(client, ['follower'], true);
  expect(client.getQueryData(queryKeys.githubAccounts)).toBeUndefined();
  expect(client.getQueryData(queryKeys.githubAccount('follower'))).toBeUndefined();
  expect(client.getQueryData(queryKeys.githubAccount('fixed'))).toBe('alice');
  client.clear();
});

describe('GitHub data between visits', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps what GitHub said for half an hour after it was last shown, but not a PR\'s code or local Git data', async () => {
    vi.useFakeTimers();
    // The lifetime a browser gives a query by default; outside one, TanStack Query never drops any.
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 5 * 60_000 } } });
    keepGitHubData(client);
    client.mount();
    const read = (queryKey: readonly unknown[]) => client.fetchQuery({ queryKey, queryFn: async () => 'read' });
    const pullRequest = queryKeys.pullRequest('repo', 1);
    const runs = queryKeys.actionRuns('repo', null);
    const code = [...queryKeys.pullRequestDiff('repo', 1), 'base', 'head'];
    const status = queryKeys.status('repo');
    await Promise.all([pullRequest, runs, code, status].map(read));
    // Past the five minutes everything else is kept for.
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(client.getQueryData(pullRequest)).toBe('read');
    expect(client.getQueryData(runs)).toBe('read');
    expect(client.getQueryData(code)).toBeUndefined();
    expect(client.getQueryData(status)).toBeUndefined();
    // Reading it again with the app's usual options doesn't shorten its life.
    await client.fetchQuery({ queryKey: pullRequest, queryFn: async () => 'read again', gcTime: 5 * 60_000 });
    await vi.advanceTimersByTimeAsync(GITHUB_DATA_GC_MS - 1);
    expect(client.getQueryData(pullRequest)).toBe('read again');
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getQueryData(pullRequest)).toBeUndefined();
    client.unmount();
  });

  it('reads GitHub again after a reconnect while keeping what was on screen', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = queryKeys.pullRequest('repo', 1);
    let answer!: (value: string) => void;
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, queryFn: () => ++reads === 1 ? 'before' : new Promise<string>((resolve) => { answer = resolve; }) });
    const unsubscribe = observer.subscribe(() => undefined);
    client.setQueryData(queryKeys.status('repo'), 'git status');
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('before'));

    const refreshed = refreshGitHubQueries(client);
    await vi.waitFor(() => expect(reads).toBe(2));
    // The connection dropping must not turn the PR into a placeholder.
    expect(observer.getCurrentResult()).toMatchObject({ data: 'before', isFetching: true });
    expect(client.getQueryState(queryKeys.status('repo'))?.isInvalidated).toBe(false);
    answer('after');
    await refreshed;
    expect(observer.getCurrentResult().data).toBe('after');
    unsubscribe();
    client.clear();
  });
  it('after a reconnect drops everything read under another account, and what is off screen for other repositories', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let login = 'before';
    const account = new QueryObserver(client, { queryKey: queryKeys.githubAccount('repo'), queryFn: async () => ({ login, revision: 1 }) });
    const unsubscribe = account.subscribe(() => undefined);
    await vi.waitFor(() => expect(account.getCurrentResult().data).toEqual({ login: 'before', revision: 1 }));
    client.setQueryData(queryKeys.pullRequest('repo', 1), 'visited, same repository');
    client.setQueryData(queryKeys.pullRequest('other', 2), 'visited, another repository');
    client.setQueryData(queryKeys.status('other'), 'git status');

    // Same account: only the other repository's GitHub answers go, since nothing here can vouch for them.
    await refreshGitHubQueries(client, 'repo');
    expect(client.getQueryData(queryKeys.pullRequest('repo', 1))).toBe('visited, same repository');
    expect(client.getQueryData(queryKeys.pullRequest('other', 2))).toBeUndefined();
    expect(client.getQueryData(queryKeys.status('other'))).toBe('git status');

    // The account changed while the connection was down: the notice was missed, so the reconnect has to catch it.
    login = 'after';
    await refreshGitHubQueries(client, 'repo');
    expect(client.getQueryData(queryKeys.pullRequest('repo', 1))).toBeUndefined();
    unsubscribe();
    client.clear();
  });
});
