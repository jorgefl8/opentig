import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryClient, queryKeys, queryResourcesForScope, resetGitHubQueries } from './query-client';

describe('renderer query policy', () => {
  it('discards old-account results in every repository while preserving Git data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: (value: string) => void;
    const key = queryKeys.pulls('repo-a', ['OPEN']);
    const pending = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<string>((resolve) => { release = resolve; }) });
    const ignored = pending.catch(() => undefined);
    client.setQueryData(queryKeys.pullRequestDiff('repo-b', 1), 'old diff');
    client.setQueryData(queryKeys.githubAccount('repo-a'), 'old account');
    client.setQueryData(queryKeys.githubAccounts, 'old inventory');
    client.setQueryData(queryKeys.status('repo-a'), 'git status');
    await resetGitHubQueries(client);
    await client.fetchQuery({ queryKey: key, queryFn: async () => 'new account' });
    release('late old account');
    await ignored;
    expect(client.getQueryData(key)).toBe('new account');
    expect(client.getQueryData(queryKeys.pullRequestDiff('repo-b', 1))).toBeUndefined();
    expect(client.getQueryData(queryKeys.githubAccount('repo-a'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.githubAccounts)).toBeUndefined();
    expect(client.getQueryData(queryKeys.status('repo-a'))).toBe('git status');
    client.clear();
  });
  it('uses explicit local server defaults', () => {
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      networkMode: 'always', retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    });
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

  it('keeps rapid queries isolated when an older request resolves last', async () => {
    let resolveFirst: ((value: string) => void) | undefined;
    const first = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const firstRequest = queryClient.fetchQuery({ queryKey: queryKeys.search('repo', { query: 'a' }), queryFn: () => first });
    await queryClient.fetchQuery({ queryKey: queryKeys.search('repo', { query: 'ab' }), queryFn: async () => 'new result' });
    resolveFirst?.('old result');
    await firstRequest;
    expect(queryClient.getQueryData(queryKeys.search('repo', { query: 'ab' }))).toBe('new result');
  });

  it('deduplicates simultaneous server reads for the same resource key', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queryFn = async () => { calls += 1; await gate; return 'status'; };
    const first = queryClient.fetchQuery({ queryKey: queryKeys.status('dedupe-repo'), queryFn });
    const second = queryClient.fetchQuery({ queryKey: queryKeys.status('dedupe-repo'), queryFn });
    expect(calls).toBe(1);
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual(['status', 'status']);
  });
});
