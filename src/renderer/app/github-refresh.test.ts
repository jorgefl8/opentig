import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { pendingFreshReads, readFresh } from '@/lib/fresh-reads';
import { createGitHubRefresher, githubOnScreen, githubRefreshReads, refreshGitHubOnScreen } from './github-refresh';

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

/** A query on screen whose reads say whether they were fresh, and can be held until released. */
function screen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  const reads: Array<{ key: string; fresh: boolean; release(): void }> = [];
  let hold = false;
  const watch = (queryKey: readonly unknown[]) => {
    const observer = new QueryObserver(client, { queryKey, queryFn: ({ queryKey: key, signal }) => readFresh(key, signal, async (fresh) => {
      const held = hold ? new Promise<void>((resolve) => reads.push({ key: String(key[2]), fresh, release: resolve })) : (reads.push({ key: String(key[2]), fresh, release: () => undefined }), undefined);
      await held;
      return `${fresh ? 'fresh' : 'kept'} ${reads.length}`;
    }) });
    return observer.subscribe(() => undefined);
  };
  return { client, reads, watch, holding: (value: boolean) => { hold = value; } };
}

it('reads again only the queries on screen, past the backend\'s recent answers, and settles when they do', async () => {
  const { client, reads, watch, holding } = screen();
  const stop = [watch(['repository', 'repo', 'pulls', 'OPEN']), watch(['repository', 'repo', 'action-run', 3])];
  // Read before, and nothing shows it now.
  await client.fetchQuery({ queryKey: ['repository', 'repo', 'pulls', 'CLOSED'], queryFn: async () => 'old' });
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  reads.length = 0;
  holding(true);

  let settled = false;
  const refreshing = refreshGitHubOnScreen(client, 'repo', { list: 'pulls', viewer: null }).then(() => { settled = true; });
  await vi.waitFor(() => expect(reads.map(({ key, fresh }) => ({ key, fresh }))).toEqual([{ key: 'pulls', fresh: true }]));
  await Promise.resolve();
  expect(settled).toBe(false);
  reads[0]!.release();
  await refreshing;
  // The run is open in no viewer, and the closed list is on no screen.
  expect(reads).toHaveLength(1);
  expect(pendingFreshReads()).toBe(0);
  for (const unsubscribe of stop) unsubscribe();
});

it('follows a first load under way with a fresh read, rather than taking it as the refresh', async () => {
  const { client, reads, watch, holding } = screen();
  holding(true);
  const stop = watch(['repository', 'repo', 'pull-request', 7]);
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  const refreshing = refreshGitHubOnScreen(client, 'repo', { list: null, viewer: { type: 'pull-request', number: 7 } });
  reads[0]!.release();
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  expect(reads.map(({ fresh }) => fresh)).toEqual([false, true]);
  reads[1]!.release();
  await refreshing;
  expect(client.getQueryData(['repository', 'repo', 'pull-request', 7])).toBe('fresh 2');
  // Nothing is left asking the next ordinary read to be fresh.
  expect(pendingFreshReads()).toBe(0);
  stop();
});

it('keeps a fresh read fresh when something else cancels it and reads again', async () => {
  const { client, reads, watch, holding } = screen();
  const stop = watch(['repository', 'repo', 'pull-request', 7]);
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  holding(true);
  const refreshing = refreshGitHubOnScreen(client, 'repo', { list: null, viewer: { type: 'pull-request', number: 7 } });
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  // An edit, or a kept answer refreshed behind it, reads the pull request again meanwhile.
  void client.invalidateQueries({ queryKey: ['repository', 'repo', 'pull-request', 7] });
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(reads.map(({ fresh }) => fresh)).toEqual([false, true, true]);
  for (const read of reads) read.release();
  await refreshing;
  expect(client.getQueryData(['repository', 'repo', 'pull-request', 7])).toBe('fresh 3');
  expect(pendingFreshReads()).toBe(0);
  stop();
});

it('leaves what a refresh read moments ago to the next refresh only once the floor has passed', async () => {
  const { client, reads, watch } = screen();
  const stop = watch(['repository', 'repo', 'action-runs', null]);
  await vi.waitFor(() => expect(client.getQueryData(['repository', 'repo', 'action-runs', null])).toBeDefined());
  let now = 1_000_000;
  await refreshGitHubOnScreen(client, 'repo', { list: 'actions', viewer: null }, () => now);
  expect(reads).toHaveLength(2);
  now += 2_000;
  await refreshGitHubOnScreen(client, 'repo', { list: 'actions', viewer: null }, () => now);
  expect(reads).toHaveLength(2);
  now += 4_000;
  await refreshGitHubOnScreen(client, 'repo', { list: 'actions', viewer: null }, () => now);
  expect(reads).toHaveLength(3);
  stop();
});

it('reads again after a fresh read that was cancelled outright, and leaves no ask behind when the query leaves the screen', async () => {
  const { client, reads, watch, holding } = screen();
  const key = ['repository', 'repo', 'pull-request', 7];
  let stop = watch(key);
  await vi.waitFor(() => expect(client.getQueryData(key)).toBeDefined());
  holding(true);
  let refreshing = refreshGitHubOnScreen(client, 'repo', { list: null, viewer: { type: 'pull-request', number: 7 } });
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  await client.cancelQueries({ queryKey: key });
  reads[1]!.release();
  // The cancelled read's answer was dropped, so the refresh reads again, freshly.
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(reads[2]!.fresh).toBe(true);
  reads[2]!.release();
  await refreshing;
  expect(client.getQueryData(key)).toBe('fresh 3');

  // Closing the pull request mid-refresh cancels its read; the ask goes with the refresh.
  refreshing = refreshGitHubOnScreen(client, 'repo', { list: null, viewer: { type: 'pull-request', number: 7 } }, () => Date.now() + 60_000);
  await vi.waitFor(() => expect(reads).toHaveLength(4));
  stop();
  reads[3]!.release();
  await refreshing;
  expect(pendingFreshReads()).toBe(0);
  stop = () => undefined;
  stop();
});

it('leaves GitHub\'s reads to finish when Refresh is pressed again, and says which repository they are for until then', async () => {
  const running: Array<string | null> = [];
  const refresher = createGitHubRefresher((repositoryId) => running.push(repositoryId));
  let finish!: () => void;
  const read = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  refresher.run('repo', read);
  refresher.run('repo', read);
  expect(read).toHaveBeenCalledOnce();
  expect(running).toEqual(['repo']);
  finish();
  await vi.waitFor(() => expect(running).toEqual(['repo', null]));
  // Once they are done, the next Refresh reads again; a failure ends them the same way.
  refresher.run('repo', () => Promise.reject(new Error('GitHub did not answer')));
  await vi.waitFor(() => expect(running).toEqual(['repo', null, 'repo', null]));
});
