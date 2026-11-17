import type { PullRequestFileList, PullRequestFilesScope } from '@shared/contracts';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

/** The files of a pull request's changes, or of one of its commits. The same commits always change the same files, so they are never read again. */
export function pullRequestFilesQueryOptions(repositoryId: string, number: number, scope: PullRequestFilesScope) {
  return {
    queryKey: [...queryKeys.pullRequestFiles(repositoryId, number), scope.baseOid, scope.headOid, scope.commitOid ?? null] as const,
    queryFn: (): Promise<PullRequestFileList> => opentig.github.getPullRequestFiles(repositoryId, number, scope),
    staleTime: Infinity,
  };
}
