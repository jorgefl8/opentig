import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ActionRunPage, ActionRunSummary } from '../../../shared/contracts';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { runListRefreshInterval } from './action-status';

/** GitHub serves a list's first 1,000 runs; past that, the list ends. */
const MAX_PAGES = 20;

/** Runs from loaded pages, once each: a run can move to the next page between two reads. */
export function runsOfPages(pages: readonly ActionRunPage[] | undefined): ActionRunSummary[] {
  const seen = new Set<number>();
  return (pages ?? []).flatMap((page) => page.runs).filter((run) => !seen.has(run.id) && seen.add(run.id));
}

/** The Actions list: newest first, a page at a time. Polling reads every loaded page again. */
export function actionRunListOptions(repositoryId: string, workflowId: number | null) {
  return infiniteQueryOptions({
    queryKey: queryKeys.actionRuns(repositoryId, workflowId),
    queryFn: ({ pageParam }) => opentig.github.listActionRuns(repositoryId, workflowId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: ActionRunPage, pages: ActionRunPage[]) => last.hasMore && pages.length < MAX_PAGES ? pages.length + 1 : undefined,
    // Only while the tab shows the list, and the window is visible.
    refetchInterval: (query) => runListRefreshInterval(runsOfPages(query.state.data?.pages)),
  });
}

/** Only the newest page: for a workflow's latest runs, and for spotting a run OpenTig just started. */
export function latestActionRunsOptions(repositoryId: string, workflowId: number | null) {
  return queryOptions({
    queryKey: [...queryKeys.actionRuns(repositoryId, workflowId), 'latest'] as const,
    queryFn: () => opentig.github.listActionRuns(repositoryId, workflowId, 1).then((page) => page.runs),
  });
}

/** Every run any list has shown, so a new one can be told apart. */
export function listedRunIds(client: QueryClient, repositoryId: string): Set<number> {
  const ids = new Set<number>();
  for (const [, data] of client.getQueriesData<unknown>({ queryKey: ['repository', repositoryId, 'action-runs'] })) {
    const runs = Array.isArray(data) ? data as ActionRunSummary[] : runsOfPages((data as { pages?: ActionRunPage[] } | undefined)?.pages);
    for (const run of runs) ids.add(run.id);
  }
  return ids;
}
