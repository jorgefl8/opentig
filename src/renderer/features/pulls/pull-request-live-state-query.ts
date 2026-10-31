import { queryOptions, type Query, type QueryKey } from '@tanstack/react-query';
import type { PullRequestLiveState } from '../../../shared/contracts';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { serializedErrorFromReason } from '@shared/errors';
import { failureCode, needsUserAction } from './branch-pull-request-query';

const CALCULATING_WINDOW_MS = 60_000;
const unknownSince = new WeakMap<object, number>();

/** GitHub computes mergeability with a delay, so an unknown result is worth checking soon, but not for long. */
export function pullRequestLiveStateInterval(query: Query<PullRequestLiveState, Error, PullRequestLiveState, QueryKey>): number | false {
  const { data } = query.state;
  if (data && data.state !== 'OPEN') return false;
  // Asking again can't help: returning to the window checks again after a rate limit,
  // and a failure only the user can fix waits for them.
  if (failureCode(query) === 'GH_RATE_LIMITED' || needsUserAction(query)) return false;
  if (data && (data.mergeable === 'UNKNOWN' || data.mergeStateStatus === 'UNKNOWN')) {
    const since = unknownSince.get(query) ?? Date.now();
    unknownSince.set(query, since);
    return Date.now() - since < CALCULATING_WINDOW_MS ? 10_000 : 60_000;
  }
  unknownSince.delete(query);
  const waiting = data && (data.checks.rollup === 'PENDING' || data.checks.items.some((check) => check.result === 'pending') || data.autoMerge || data.mergeQueue.queued);
  return waiting ? 45_000 : 60_000;
}

export function pullRequestLiveStateQueryOptions(repositoryId: string, number: number, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.pullRequestLiveState(repositoryId, number),
    queryFn: () => opentig.github.getPullRequestLiveState(repositoryId, number),
    enabled,
    refetchInterval: pullRequestLiveStateInterval,
    refetchIntervalInBackground: false,
    // Right after waking the machine the network usually needs a few more seconds.
    retry: (failures, error) => {
      const detail = serializedErrorFromReason(error);
      return failures < 1 && detail !== null && 'retryable' in detail && detail.retryable === true;
    },
    retryDelay: 5_000,
    retryOnMount: false,
    refetchOnWindowFocus: (query) => needsUserAction(query) ? false : 'always',
    refetchOnReconnect: (query) => needsUserAction(query) ? false : 'always',
  });
}

/** The reads a newer live state has made outdated: a new head changes the code, any other update only the details and conversation. */
export function queriesOutdatedByLiveState(repositoryId: string, previous: PullRequestLiveState, next: PullRequestLiveState): QueryKey[] {
  if (previous.number !== next.number) return [];
  if (previous.headRefOid !== next.headRefOid) {
    return [queryKeys.pullRequest(repositoryId, next.number), queryKeys.pullRequestConversation(repositoryId, next.number), queryKeys.pullRequestCommits(repositoryId, next.number), queryKeys.pullRequestDiff(repositoryId, next.number)];
  }
  return previous.updatedAt !== next.updatedAt ? [queryKeys.pullRequest(repositoryId, next.number), queryKeys.pullRequestConversation(repositoryId, next.number)] : [];
}
