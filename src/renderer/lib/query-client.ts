import { focusManager, QueryClient } from '@tanstack/react-query';
import type { PullRequestState } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { refreshOperationsForScope, type RefreshView } from '../app/refresh-policy';
import { listenForWindowReturn, onReturnFromIdle, pausePollingWhileIdle } from './window-focus';

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  focusManager.setEventListener(listenForWindowReturn(window));
  pausePollingWhileIdle(focusManager);
}

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

/**
 * What is on screen and read on a timer is read again now. The timers stop
 * while nobody is there, and without this the first look back at a run or a
 * pull request's checks showed them as they were, for up to a whole interval.
 */
export function resumePolling(client: QueryClient): void {
  void client.refetchQueries({
    type: 'active',
    predicate: (query) => query.observers.some((observer) => Boolean(observer.options.refetchInterval)),
  }, { cancelRefetch: false });
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') onReturnFromIdle(() => resumePolling(queryClient));

/** GitHub is slow to answer again, so what it said stays available this long after it was last on screen, instead of five minutes. */
export const GITHUB_DATA_GC_MS = 30 * 60_000;
const GITHUB_RESOURCES = new Set(['push-context', 'github-account', 'pulls', 'pull-stacks', 'pull-line-counts', 'pull-request', 'pull-request-state', 'pull-request-conversation', 'pull-request-stack', 'pull-request-diff', 'pull-request-commits', 'pull-request-commit-diff', 'branch-pull-request', 'releases', 'release', 'release-tag', 'workflows', 'workflows-runnable', 'workflow-triggers', 'action-runs', 'action-run', 'action-job-log']);
/**
 * A pull request's code can be megabytes, and Git reads it again from the clone: it keeps the usual five minutes.
 * A job's log is large and may hold what a workflow printed: it sets its own, shorter life (see `JOB_LOG_GC_MS`).
 */
const GITHUB_CODE = new Set(['pull-request-diff', 'pull-request-commit-diff', 'action-job-log']);

/** Gives every GitHub read made through `client` the longer life of `GITHUB_DATA_GC_MS`. A query's lifetime only ever grows, so later options don't shorten it. */
export function keepGitHubData(client: QueryClient): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== 'added') return;
    const [scope, , resource] = event.query.queryKey as readonly unknown[];
    if (scope !== 'repository' || !GITHUB_RESOURCES.has(String(resource)) || GITHUB_CODE.has(String(resource))) return;
    event.query.setOptions({ ...event.query.options, gcTime: GITHUB_DATA_GC_MS });
  });
}
keepGitHubData(queryClient);

export const queryKeys = {
  commitAuthorship: (repositoryId: string) => ['repository', repositoryId, 'commit-authorship'] as const,
  githubAccounts: ['github', 'accounts'] as const,
  githubCliStatus: ['github', 'cli-status'] as const,
  githubAccount: (repositoryId: string) => ['repository', repositoryId, 'github-account'] as const,
  aiRepositoryInstructions: (repositoryId: string) => ['repository', repositoryId, 'ai-instructions'] as const,
  aiStatuses: (executablePathsKey: string) => ['ai', 'statuses', executablePathsKey] as const,
  repository: (repositoryId: string) => ['repository', repositoryId] as const,
  status: (repositoryId: string) => ['repository', repositoryId, 'status'] as const,
  branches: (repositoryId: string) => ['repository', repositoryId, 'branches'] as const,
  worktrees: (repositoryId: string) => ['repository', repositoryId, 'worktrees'] as const,
  worktreeAgents: (repositoryId: string) => ['repository', repositoryId, 'worktree-agents'] as const,
  files: (repositoryId: string) => ['repository', repositoryId, 'files'] as const,
  fileHistory: (repositoryId: string) => ['repository', repositoryId, 'file-history'] as const,
  /** Every branch's history of a repository. */
  histories: (repositoryId: string) => ['repository', repositoryId, 'history'] as const,
  /** The history read from one HEAD (see `historyHead`), so a branch switch never shows the previous branch's commits. */
  history: (repositoryId: string, head: string) => ['repository', repositoryId, 'history', head] as const,
  githubInfo: (repositoryId: string) => ['repository', repositoryId, 'github-info'] as const,
  pulls: (repositoryId: string, states: readonly PullRequestState[]) => ['repository', repositoryId, 'pulls', ...states] as const,
  pullStacks: (repositoryId: string, numbers: readonly number[]) => ['repository', repositoryId, 'pull-stacks', ...numbers] as const,
  pullLineCounts: (repositoryId: string, states: readonly PullRequestState[]) => ['repository', repositoryId, 'pull-line-counts', ...states] as const,
  pullRequest: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request', number] as const,
  pullRequestLiveState: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request-state', number] as const,
  pullRequestConversation: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request-conversation', number] as const,
  pullRequestStack: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request-stack', number] as const,
  pullRequestDiff: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request-diff', number] as const,
  pullRequestCommits: (repositoryId: string, number: number) => ['repository', repositoryId, 'pull-request-commits', number] as const,
  pullRequestCommitDiff: (repositoryId: string, oid: string) => ['repository', repositoryId, 'pull-request-commit-diff', oid] as const,
  releases: (repositoryId: string) => ['repository', repositoryId, 'releases'] as const,
  release: (repositoryId: string, tagName: string) => ['repository', repositoryId, 'release', tagName] as const,
  releaseTag: (repositoryId: string, tagName: string) => ['repository', repositoryId, 'release-tag', tagName] as const,
  workflows: (repositoryId: string) => ['repository', repositoryId, 'workflows'] as const,
  runnableWorkflows: (repositoryId: string) => ['repository', repositoryId, 'workflows-runnable'] as const,
  workflowTriggers: (repositoryId: string, path: string, ref: string) => ['repository', repositoryId, 'workflow-triggers', path, ref] as const,
  actionRuns: (repositoryId: string, workflowId: number | null) => ['repository', repositoryId, 'action-runs', workflowId] as const,
  actionRun: (repositoryId: string, runId: number) => ['repository', repositoryId, 'action-run', runId] as const,
  actionJobLog: (repositoryId: string, jobId: number) => ['repository', repositoryId, 'action-job-log', jobId] as const,
  search: (repositoryId: string, input: object) => ['repository', repositoryId, 'search', input] as const,
  localRefs: (repositoryId: string) => ['repository', repositoryId, 'local-refs'] as const,
  branchDetails: (repositoryId: string, fullName: string) => ['repository', repositoryId, 'branch-details', fullName] as const,
  remoteBranchDetails: (repositoryId: string, fullName: string) => ['repository', repositoryId, 'remote-branch-details', fullName] as const,
  branchPullRequest: (repositoryId: string, name: string) => ['repository', repositoryId, 'branch-pull-request', name] as const,
  commitsAfter: (repositoryId: string, oid: string, headOid: string) => ['repository', repositoryId, 'commits-after', oid, headOid] as const,
  worktreeDetails: (repositoryId: string, path: string) => ['repository', repositoryId, 'worktree-details', path] as const,
};

export function queryResourcesForScope(scope: RepositoryChangeScope, view: RefreshView): string[] {
  const operations = refreshOperationsForScope(scope, view);
  return (['status', 'branches', 'worktrees', 'files', 'history'] as const).filter((resource) => operations[resource]);
}

/** Reset only GitHub reads, cancelling old results before another identity loads. */
export async function resetGitHubQueries(client: QueryClient, repositoryIds?: string[], inventoryChanged = false): Promise<void> {
  const predicate = (query: { queryKey: readonly unknown[] }) => ((!repositoryIds || inventoryChanged && query.queryKey[1] === 'accounts') && query.queryKey[0] === 'github')
    || (query.queryKey[0] === 'repository' && (!repositoryIds || repositoryIds.includes(String(query.queryKey[1]))) && GITHUB_RESOURCES.has(String(query.queryKey[2])));
  await client.cancelQueries({ predicate });
  await client.resetQueries({ predicate });
}

/**
 * After the connection comes back: everything read from GitHub is read again,
 * and stays on screen meanwhile. Emptying it turned every dropped connection
 * into a screen of placeholders, for data that is nearly always still right.
 */
export async function refreshGitHubQueries(client: QueryClient, openRepositoryId: string | null = null): Promise<void> {
  const fromGitHub = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === 'github' || (query.queryKey[0] === 'repository' && GITHUB_RESOURCES.has(String(query.queryKey[2])));
  // The account may have changed while the connection was down, and that notice was missed. What is
  // not on screen for another repository would keep the old account's answers, so it is let go.
  client.removeQueries({ type: 'inactive', predicate: (query) => fromGitHub(query) && query.queryKey[0] === 'repository' && query.queryKey[1] !== openRepositoryId });
  const accountKey = openRepositoryId ? queryKeys.githubAccount(openRepositoryId) : null;
  const account = (): { login: string | null; revision: number } | undefined => accountKey ? client.getQueryData(accountKey) : undefined;
  const before = account();
  await client.invalidateQueries({ predicate: fromGitHub });
  const after = account();
  // For the open repository the account is read again with everything else: if it is another one, nothing read before is kept.
  if (before && after && (before.login !== after.login || before.revision !== after.revision)) await resetGitHubQueries(client);
}

/** What a history is read from: the checked-out branch, or the commit a detached HEAD points at. */
export function historyHead(status: { branch: string | null; oid: string | null; detached: boolean }): string {
  return !status.detached && status.branch ? `branch:${status.branch}` : `commit:${status.oid ?? ''}`;
}
