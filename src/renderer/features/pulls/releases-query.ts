import { queryOptions } from '@tanstack/react-query';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

/** Kept apart from the Releases view, so the app can read the list before that view is opened or downloaded. */
export function releasesQueryOptions(repositoryId: string) {
  return queryOptions({
    queryKey: queryKeys.releases(repositoryId),
    queryFn: () => opentig.github.listReleases(repositoryId),
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  });
}
