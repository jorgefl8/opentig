import { queryOptions, type Query } from '@tanstack/react-query';
import { serializedErrorFromReason } from '@shared/errors';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

/** Asking again can't fix these: they wait for a change of account or an explicit refresh. */
const NEEDS_USER_ACTION = new Set(['GH_ACCESS_DENIED', 'GH_AUTH_REQUIRED', 'GH_ACCOUNT_MISSING', 'GH_ACCOUNT_UNRESOLVED']);

export function failureCode(query: Pick<Query, 'state'>): string | null {
  return query.state.status === 'error' ? serializedErrorFromReason(query.state.error)?.code ?? null : null;
}

export function needsUserAction(query: Pick<Query, 'state'>): boolean {
  return NEEDS_USER_ACTION.has(failureCode(query) ?? '');
}

export function branchPullRequestQueryOptions(repositoryId: string, branch: string, enabled: boolean) {
  return queryOptions({
    queryKey: queryKeys.branchPullRequest(repositoryId, branch),
    queryFn: () => opentig.github.findPullRequestForBranch(repositoryId, branch),
    enabled,
    staleTime: 60_000,
    // Right after waking the machine the network usually needs a few more seconds.
    retry: (failures, error) => {
      const detail = serializedErrorFromReason(error);
      return failures < 1 && detail !== null && 'retryable' in detail && detail.retryable === true;
    },
    retryDelay: 5_000,
    // A branch can be reused after merge, and a closed PR can reopen. Keep
    // checking inactive results instead of treating them as permanently final.
    refetchInterval: query => {
      if (needsUserAction(query)) return false;
      if (failureCode(query) === 'GH_RATE_LIMITED') return 300_000;
      return query.state.status === 'error' || query.state.data?.state === 'OPEN' ? 60_000 : 300_000;
    },
    refetchIntervalInBackground: false,
    // The interval or an explicit refresh recovers from a failure, not opening another view.
    retryOnMount: false,
    refetchOnWindowFocus: query => needsUserAction(query) ? false : 'always',
    refetchOnReconnect: query => needsUserAction(query) ? false : 'always',
  });
}
