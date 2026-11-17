import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { PullRequestsSection } from '@/features/pulls/PullRequestsView';
import { askFreshReads } from '@/lib/fresh-reads';
import type { RefreshView } from './refresh-policy';

/** What of GitHub is on screen: the GitHub section's list, by its tab, and the item open in the viewer. */
export interface GitHubOnScreen {
  list: PullRequestsSection | null;
  viewer: { type: 'pull-request'; number: number } | { type: 'workflow-run'; runId: number } | { type: 'release'; tag: string } | null;
}

/**
 * Reads what a phone shows one pane at a time: the list only while it is the pane
 * shown, the viewer only while it is. Elsewhere both are on screen side by side.
 */
export function githubOnScreen(input: {
  view: RefreshView;
  section: PullRequestsSection;
  viewer: { type: string; number?: number; runId?: number; tag?: string } | null;
  phonePane: 'list' | 'viewer' | null;
}): GitHubOnScreen {
  const { view, section, viewer, phonePane } = input;
  const list = view === 'prs' && phonePane !== 'viewer' ? section : null;
  if (phonePane === 'list' || !viewer) return { list, viewer: null };
  if (viewer.type === 'pull-request' && viewer.number !== undefined) return { list, viewer: { type: 'pull-request', number: viewer.number } };
  if (viewer.type === 'workflow-run' && viewer.runId !== undefined) return { list, viewer: { type: 'workflow-run', runId: viewer.runId } };
  if (viewer.type === 'release' && viewer.tag !== undefined) return { list, viewer: { type: 'release', tag: viewer.tag } };
  return { list, viewer: null };
}

/** A read of what is on screen; `fresh` when the backend would otherwise answer it from what it read moments ago. */
export interface GitHubRefreshRead {
  queryKey: QueryKey;
  fresh: boolean;
}

/**
 * What a manual refresh reads again from GitHub, in two steps: a pull request
 * list's stacks and line counts follow the list, which tells the backend they
 * are to be read again too. Keys are prefixes of the queries on screen.
 */
export function githubRefreshReads(repositoryId: string, onScreen: GitHubOnScreen): { first: GitHubRefreshRead[]; then: GitHubRefreshRead[] } {
  const key = (...rest: unknown[]): QueryKey => ['repository', repositoryId, ...rest];
  const first: GitHubRefreshRead[] = [];
  const then: GitHubRefreshRead[] = [];
  if (onScreen.list === 'pulls') {
    first.push({ queryKey: key('pulls'), fresh: true });
    then.push({ queryKey: key('pull-stacks'), fresh: false }, { queryKey: key('pull-line-counts'), fresh: false });
  } else if (onScreen.list === 'actions') first.push({ queryKey: key('action-runs'), fresh: false });
  else if (onScreen.list === 'releases') first.push({ queryKey: key('releases'), fresh: true });
  const viewer = onScreen.viewer;
  if (viewer?.type === 'pull-request') {
    first.push(
      { queryKey: key('pull-request', viewer.number), fresh: true },
      { queryKey: key('pull-request-state', viewer.number), fresh: false },
      { queryKey: key('pull-request-conversation', viewer.number), fresh: true },
    );
  } else if (viewer?.type === 'workflow-run') first.push({ queryKey: key('action-run', viewer.runId), fresh: false });
  else if (viewer?.type === 'release') first.push({ queryKey: key('release', viewer.tag), fresh: false });
  return { first, then };
}

/** A query a refresh read this recently isn't read again by the next one, so pressing Refresh twice reads once. */
export const GITHUB_REFRESH_FLOOR_MS = 5_000;

/** When a refresh last read each query, by query client. */
const refreshes = new WeakMap<QueryClient, Map<string, number>>();

/**
 * Reads again what of GitHub is on screen, and settles when those reads do.
 * Only queries something shows are read, and not those a refresh read in the last
 * `GITHUB_REFRESH_FLOOR_MS`. One that fails keeps what it showed, and says so where
 * that query's notices do, so this doesn't throw.
 */
export async function refreshGitHubOnScreen(client: QueryClient, repositoryId: string, onScreen: GitHubOnScreen, now: () => number = Date.now): Promise<void> {
  const refreshedAt = refreshes.get(client) ?? new Map<string, number>();
  refreshes.set(client, refreshedAt);
  for (const [key, at] of refreshedAt) if (now() - at >= GITHUB_REFRESH_FLOOR_MS) refreshedAt.delete(key);
  const read = (reads: GitHubRefreshRead[]) => Promise.all(reads.flatMap(({ queryKey: prefix, fresh }) =>
    client.getQueryCache().findAll({ queryKey: prefix, type: 'active' })
      .filter((query) => !refreshedAt.has(query.queryHash))
      .map(async (query) => {
        const queryKey = query.queryKey;
        const asks = askFreshReads(fresh ? [queryKey] : []);
        try {
          // Cancels a read under way, which may predate the refresh; a first load can't be cancelled and is waited for.
          await client.refetchQueries({ queryKey, exact: true, type: 'active' });
          // That first load, or a read that replaced a cancelled one and isn't done, leaves the ask unanswered: read until it is.
          for (let attempt = 0; attempt < 2 && !asks.answered(queryKey); attempt++) {
            await client.refetchQueries({ queryKey, exact: true, type: 'active' }, { cancelRefetch: false });
          }
          refreshedAt.set(query.queryHash, now());
        } finally {
          asks.drop();
        }
      })));
  const { first, then } = githubRefreshReads(repositoryId, onScreen);
  await read(first);
  await read(then);
}

/**
 * Runs GitHub's part of manual refreshes beside their Git part, one at a time per
 * repository: a Refresh pressed while it still reads leaves it to finish rather
 * than starting more reads. `onRunning` says which repository's part runs, for
 * the Refresh icon, which keeps turning until it is done.
 */
export function createGitHubRefresher(onRunning: (repositoryId: string | null) => void) {
  let running: { repositoryId: string; reads: Promise<void> } | null = null;
  return {
    run(repositoryId: string, read: () => Promise<void>): void {
      if (running?.repositoryId === repositoryId) return;
      // A read that fails says so where its list or viewer shows it.
      const reads: Promise<void> = read().catch(() => undefined).finally(() => {
        if (running?.reads !== reads) return;
        running = null;
        onRunning(null);
      });
      running = { repositoryId, reads };
      onRunning(repositoryId);
    },
  };
}
