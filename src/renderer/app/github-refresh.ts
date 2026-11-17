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

/** When a refresh last got an answer for each query, by query client, on a clock that only moves forward. */
const refreshes = new WeakMap<QueryClient, Map<string, number>>();

/**
 * Reads again what of GitHub is on screen, and settles when those reads do.
 * Only queries something shows are read, and not those a refresh got an answer
 * for in the last `GITHUB_REFRESH_FLOOR_MS`: one that failed or was cancelled is
 * read again by the next Refresh. A read that fails keeps what it showed, and
 * says so where that query's notices do, so this doesn't throw.
 */
export async function refreshGitHubOnScreen(client: QueryClient, repositoryId: string, onScreen: GitHubOnScreen, now: () => number = () => performance.now()): Promise<void> {
  const refreshedAt = refreshes.get(client) ?? new Map<string, number>();
  refreshes.set(client, refreshedAt);
  for (const [key, at] of refreshedAt) if (now() - at >= GITHUB_REFRESH_FLOOR_MS) refreshedAt.delete(key);
  const read = (reads: GitHubRefreshRead[]) => Promise.all(reads.flatMap(({ queryKey: prefix, fresh }) =>
    client.getQueryCache().findAll({ queryKey: prefix, type: 'active' })
      .filter((query) => !refreshedAt.has(query.queryHash))
      .map(async (query) => {
        const queryKey = query.queryKey;
        const startedWith = query.state.dataUpdateCount;
        // A first load under way isn't fresh, and a fresh read can be cancelled with nothing in its
        // place: read again until a fresh read completed and the query took its answer, or failed.
        for (let attempt = 0; attempt < 3; attempt++) {
          const answeredBefore = { data: query.state.dataUpdateCount, error: query.state.errorUpdateCount };
          const asks = askFreshReads(fresh ? [queryKey] : []);
          try {
            // The first attempt cancels a read under way, which may predate the refresh; a first load can't be
            // cancelled and is waited for. A read that replaced a cancelled one is waited for, not cancelled again.
            await client.refetchQueries({ queryKey, exact: true, type: 'active' }, { cancelRefetch: attempt === 0 });
            for (let wait = 0; wait < 3 && query.state.fetchStatus === 'fetching'; wait++) {
              await client.refetchQueries({ queryKey, exact: true, type: 'active' }, { cancelRefetch: false });
            }
          } finally {
            asks.drop();
          }
          const landed = query.state.dataUpdateCount !== answeredBefore.data || query.state.errorUpdateCount !== answeredBefore.error;
          if (asks.answered(queryKey) && landed) break;
        }
        // Only an answer counts, so a Refresh after one that failed or was cancelled tries again.
        if (query.state.status === 'success' && query.state.dataUpdateCount !== startedWith) refreshedAt.set(query.queryHash, now());
      })));
  const { first, then } = githubRefreshReads(repositoryId, onScreen);
  await read(first);
  await read(then);
}

/**
 * Runs GitHub's part of manual refreshes beside their Git part, one at a time for
 * each repository. A Refresh pressed while that repository's part still reads
 * doesn't start more reads beside it: it leaves one follow-up, which reads what
 * is on screen when the running part ends; what that part just read is skipped
 * then, so only what it didn't cover, such as a pull request opened meanwhile, is
 * read. `onRunning` says which repositories' parts run, for the Refresh icon.
 */
export function createGitHubRefresher(onRunning: (repositoryIds: ReadonlySet<string>) => void) {
  const runs = new Map<string, { again: (() => Promise<void>) | null }>();
  const announce = () => onRunning(new Set(runs.keys()));
  return {
    run(repositoryId: string, read: () => Promise<void>): void {
      const running = runs.get(repositoryId);
      if (running) { running.again = read; return; }
      const run = { again: null as (() => Promise<void>) | null };
      runs.set(repositoryId, run);
      announce();
      void (async () => {
        for (let next: (() => Promise<void>) | null = read; next; next = run.again, run.again = null) {
          // A read that fails says so where its list or viewer shows it.
          await next().catch(() => undefined);
        }
      })().finally(() => {
        runs.delete(repositoryId);
        announce();
      });
    },
  };
}
