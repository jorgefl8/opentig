import { queryOptions, type Query, type QueryKey } from '@tanstack/react-query';
import type { PullRequestLiveState } from '../../../shared/contracts';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ghDetail } from './gh-utils';

const CALCULATING_WINDOW_MS = 60_000;
const unknownSince = new WeakMap<object, number>();

/** GitHub computes mergeability with a delay, so an unknown result is worth checking soon, but not for long. */
export function pullRequestLiveStateInterval(query: Query<PullRequestLiveState, Error, PullRequestLiveState, QueryKey>): number | false {
  const { data, error } = query.state;
  if (data && data.state !== 'OPEN') return false;
  // Polling can't help during a rate limit. Returning to the window checks again.
  if (ghDetail(error)?.code === 'GH_RATE_LIMITED') return false;
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
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

/** The reads a newer live state has made outdated: a new head changes the code, any other update only the details. */
export function queriesOutdatedByLiveState(repositoryId: string, previous: PullRequestLiveState, next: PullRequestLiveState): QueryKey[] {
  if (previous.number !== next.number) return [];
  if (previous.headRefOid !== next.headRefOid) {
    return [queryKeys.pullRequest(repositoryId, next.number), queryKeys.pullRequestCommits(repositoryId, next.number), queryKeys.pullRequestDiff(repositoryId, next.number)];
  }
  return previous.updatedAt !== next.updatedAt ? [queryKeys.pullRequest(repositoryId, next.number)] : [];
}
