import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { takeFreshRead } from '@/lib/query-client';
import { githubOnScreen, githubRefreshReads, refreshGitHubOnScreen } from './github-refresh';

const keys = (reads: { queryKey: readonly unknown[]; fresh: boolean }[]) => reads.map(({ queryKey, fresh }) => `${queryKey.slice(2).join(':')}${fresh ? ' (fresh)' : ''}`);

it('reads the open tab\'s list only while the GitHub section is shown, and the viewer\'s item from any section', () => {
  const pull = { type: 'pull-request', number: 7 };
  expect(githubOnScreen({ view: 'prs', section: 'actions', viewer: null, phonePane: null })).toEqual({ list: 'actions', viewer: null });
  expect(githubOnScreen({ view: 'history', section: 'actions', viewer: pull, phonePane: null })).toEqual({ list: null, viewer: { type: 'pull-request', number: 7 } });
  // A file or a commit in the viewer is not GitHub's.
  expect(githubOnScreen({ view: 'prs', section: 'pulls', viewer: { type: 'commit' }, phonePane: null })).toEqual({ list: 'pulls', viewer: null });
  // A phone shows one pane at a time.
  expect(githubOnScreen({ view: 'prs', section: 'pulls', viewer: pull, phonePane: 'list' })).toEqual({ list: 'pulls', viewer: null });
  expect(githubOnScreen({ view: 'prs', section: 'pulls', viewer: pull, phonePane: 'viewer' })).toEqual({ list: null, viewer: { type: 'pull-request', number: 7 } });
});

it('asks GitHub itself for what the backend would answer from a recent read, and reads a list\'s parts after the list', () => {
  const pulls = githubRefreshReads('repo', { list: 'pulls', viewer: { type: 'pull-request', number: 7 } });
  expect(keys(pulls.first)).toEqual(['pulls (fresh)', 'pull-request:7 (fresh)', 'pull-request-state:7', 'pull-request-conversation:7 (fresh)']);
  expect(keys(pulls.then)).toEqual(['pull-stacks', 'pull-line-counts']);
  expect(keys(githubRefreshReads('repo', { list: 'actions', viewer: { type: 'workflow-run', runId: 3 } }).first)).toEqual(['action-runs', 'action-run:3']);
  expect(keys(githubRefreshReads('repo', { list: 'releases', viewer: { type: 'release', tag: 'v1' } }).first)).toEqual(['releases (fresh)', 'release:v1']);
  expect(githubRefreshReads('repo', { list: null, viewer: null })).toEqual({ first: [], then: [] });
});

const clients: QueryClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

it('reads again only the queries on screen, past the backend\'s recent answers, and settles when they do', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  const asked: Array<{ key: string; fresh: boolean }> = [];
  let finish: () => void = () => undefined;
  const watch = (queryKey: readonly unknown[], slow = false) => {
    const observer = new QueryObserver(client, { queryKey, queryFn: async () => {
      asked.push({ key: String(queryKey[2]), fresh: takeFreshRead(queryKey) });
      if (slow && asked.filter((entry) => entry.key === queryKey[2]).length > 1) await new Promise<void>((resolve) => { finish = resolve; });
      return 'read';
    } });
    return observer.subscribe(() => undefined);
  };
  const stopList = watch(['repository', 'repo', 'pulls', 'OPEN'], true);
  // Read before, and nothing shows it now.
  await client.fetchQuery({ queryKey: ['repository', 'repo', 'pulls', 'CLOSED'], queryFn: async () => 'old' });
  const stopRun = watch(['repository', 'repo', 'action-run', 3]);
  await vi.waitFor(() => expect(asked).toHaveLength(2));
  asked.length = 0;

  let settled = false;
  const refreshing = refreshGitHubOnScreen(client, 'repo', { list: 'pulls', viewer: null }).then(() => { settled = true; });
  await vi.waitFor(() => expect(asked).toEqual([{ key: 'pulls', fresh: true }]));
  expect(settled).toBe(false);
  finish();
  await refreshing;
  // The run is open in no viewer, and the closed list is on no screen.
  expect(asked).toEqual([{ key: 'pulls', fresh: true }]);
  stopList(); stopRun();
});
