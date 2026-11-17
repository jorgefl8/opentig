import { queryOptions } from '@tanstack/react-query';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { readFresh } from '@/lib/fresh-reads';

/** Kept apart from the Releases view, so the app can read the list before that view is opened or downloaded. */
export function releasesQueryOptions(repositoryId: string) {
  return queryOptions({
    queryKey: queryKeys.releases(repositoryId),
    queryFn: ({ queryKey, signal }) => readFresh(queryKey, signal, (fresh) => opentig.github.listReleases(repositoryId, fresh)),
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  });
}
