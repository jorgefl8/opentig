import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys, queryResourcesForScope, resetGitHubQueries } from './query-client';

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
