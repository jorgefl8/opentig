import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { PullRequestsSection } from '@/features/pulls/PullRequestsView';
import { askFreshRead } from '@/lib/query-client';
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

/**
 * Reads again what of GitHub is on screen, and settles when those reads do.
 * Only queries something shows are read; one that fails keeps what it showed,
 * and says so where that query's notices do, so it doesn't throw.
 */
export async function refreshGitHubOnScreen(client: QueryClient, repositoryId: string, onScreen: GitHubOnScreen): Promise<void> {
  const read = (reads: GitHubRefreshRead[]) => Promise.all(reads.map(({ queryKey, fresh }) => {
    const shown = client.getQueryCache().findAll({ queryKey, type: 'active' });
    if (shown.length === 0) return undefined;
    if (fresh) for (const query of shown) askFreshRead(query.queryKey);
    return client.refetchQueries({ queryKey, type: 'active' });
  }));
  const { first, then } = githubRefreshReads(repositoryId, onScreen);
  await read(first);
  await read(then);
}
