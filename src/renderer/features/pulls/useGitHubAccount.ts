import { useQuery } from '@tanstack/react-query';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

/** Used at operation surfaces; Settings itself reads only the cached context. */
export function useGitHubAccount(repositoryId: string | null) {
  return useQuery({ queryKey: queryKeys.githubAccount(repositoryId ?? ''),
    queryFn: () => opentig.github.repositoryAccount(repositoryId!, true), enabled: repositoryId !== null,
    staleTime: 60_000,
  });
}
