import { queryOptions } from '@tanstack/react-query';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

export function branchPullRequestQueryOptions(repositoryId: string, branch: string, enabled: boolean) {
  return queryOptions({
    queryKey: queryKeys.branchPullRequest(repositoryId, branch),
    queryFn: () => opentig.github.findPullRequestForBranch(repositoryId, branch),
    enabled,
    staleTime: 60_000,
    // A branch can be reused after merge, and a closed PR can reopen. Keep
    // checking inactive results instead of treating them as permanently final.
    refetchInterval: query => query.state.status === 'error' || query.state.data?.state === 'OPEN' ? 60_000 : 300_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}
