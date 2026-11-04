import type { QueryClient } from '@tanstack/react-query';
import type { PullRequestSummary } from '../../../shared/contracts';
import { queryKeys } from '@/lib/query-client';

/**
 * What the pull request list, or the branch's own PR, already knows about this PR,
 * so its viewer can show the header straight away while the details load.
 */
export function cachedPullRequestSummary(client: QueryClient, repositoryId: string, number: number): PullRequestSummary | null {
  const repository = queryKeys.repository(repositoryId);
  for (const [, pulls] of client.getQueriesData<PullRequestSummary[]>({ queryKey: [...repository, 'pulls'] })) {
    const found = pulls?.find((pull) => pull.number === number);
    if (found) return found;
  }
  for (const [, pull] of client.getQueriesData<PullRequestSummary | null>({ queryKey: [...repository, 'branch-pull-request'] })) {
    if (pull?.number === number) return pull;
  }
  return null;
}
