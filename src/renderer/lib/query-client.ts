import { QueryClient } from '@tanstack/react-query';
import type { PullRequestState } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { refreshOperationsForScope, type RefreshView } from '../app/refresh-policy';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 0,
    },
    mutations: { networkMode: 'always', retry: false },
  },
});

export const queryKeys = {
  repository: (repositoryId: string) => ['repository', repositoryId] as const,
  status: (repositoryId: string) => ['repository', repositoryId, 'status'] as const,
  branches: (repositoryId: string) => ['repository', repositoryId, 'branches'] as const,
  worktrees: (repositoryId: string) => ['repository', repositoryId, 'worktrees'] as const,
  files: (repositoryId: string) => ['repository', repositoryId, 'files'] as const,
  fileHistory: (repositoryId: string) => ['repository', repositoryId, 'file-history'] as const,
  history: (repositoryId: string) => ['repository', repositoryId, 'history'] as const,
  githubInfo: (repositoryId: string) => ['repository', repositoryId, 'github-info'] as const,
  pulls: (repositoryId: string, states: readonly PullRequestState[]) => ['repository', repositoryId, 'pulls', ...states] as const,
  pullRequest: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request', number] as const,
  pullRequestDiff: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request-diff', number] as const,
  pullRequestCommitDiff: (repositoryId: string, oid: string) => ['repository', repositoryId, 'pull-request-commit-diff', oid] as const,
  search: (repositoryId: string, input: object) => ['repository', repositoryId, 'search', input] as const,
  localRefs: (repositoryId: string) => ['repository', repositoryId, 'local-refs'] as const,
  branchDetails: (repositoryId: string, fullName: string) => ['repository', repositoryId, 'branch-details', fullName] as const,
  branchPullRequest: (repositoryId: string, name: string) => ['repository', repositoryId, 'branch-pull-request', name] as const,
  worktreeDetails: (repositoryId: string, path: string) => ['repository', repositoryId, 'worktree-details', path] as const,
};

export function queryResourcesForScope(scope: RepositoryChangeScope, view: RefreshView): string[] {
  const operations = refreshOperationsForScope(scope, view);
  return (['status', 'branches', 'worktrees', 'files', 'history'] as const).filter((resource) => operations[resource]);
}
