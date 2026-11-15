import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/contracts';
import type { KeptRefreshOutcome } from '@shared/kept-reads';
import { KeptReads, keptReadTarget } from './kept-reads';
import { createOpenTigServerClient } from './server-client';

afterEach(() => { vi.useRealTimers(); });

function deferred() {
  let resolve!: (outcome: KeptRefreshOutcome) => void;
  const promise = new Promise<KeptRefreshOutcome>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('kept answers on screen', () => {
  const target = keptReadTarget(IPC.githubPrView, ['repo', 12])!;
  const prefixes = [['repository', 'repo', 'pull-request', 12]];

  it('stays marked as not current until a current answer confirms it, even after a refresh succeeds', async () => {
    const store = new KeptReads();
    const refreshed = vi.fn();
    store.onRefreshed(refreshed);
    const refresh = deferred();
    store.kept(target, '2026-11-15T10:00:00.000Z', refresh.promise);
    expect(store.summary(prefixes)).toEqual({ readAt: '2026-11-15T10:00:00.000Z', status: 'refreshing' });
    refresh.resolve({ outcome: 'updated' });
    await Promise.resolve(); await Promise.resolve();
    // Told to read again, but what is on screen is still the kept answer.
    expect(refreshed).toHaveBeenCalledWith(target);
    expect(store.summary(prefixes)?.status).toBe('refreshing');
    store.confirm(target);
    expect(store.summary(prefixes)).toBeNull();
  });

  it('says why when the refresh fails, and when no answer about it ever arrives', async () => {
    vi.useFakeTimers();
    const store = new KeptReads();
    store.kept(target, '2026-11-15T10:00:00.000Z', Promise.resolve({ outcome: 'failed', error: { code: 'GH_RATE_LIMITED', operation: 'gh-pr-view', message: 'GitHub rate limit reached.' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.summary(prefixes)).toMatchObject({ status: 'failed', error: { message: 'GitHub rate limit reached.' } });

    const lost = keptReadTarget(IPC.githubActionRunView, ['repo', 5])!;
    store.kept(lost, '2026-11-15T10:00:00.000Z', new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(store.get(lost.stateKey)?.status).toBe('failed');
  });

  it('reads every page of a run list again once one page is refreshed', () => {
    expect(keptReadTarget(IPC.githubActionRunList, ['repo', null, 2])).toEqual({
      stateKey: ['repository', 'repo', 'action-runs', null, 'page', 2],
      invalidateKey: ['repository', 'repo', 'action-runs', null],
    });
  });
});

describe('which reads may get a kept answer', () => {
  function client(hasData: boolean) {
    const store = new KeptReads();
    store.setDataLookup(() => hasData);
    const asked: boolean[] = [];
    const transport = {
      request: vi.fn(async (_command: string, _args: unknown[], options: { onKept?: unknown } = {}) => { asked.push(options.onKept !== undefined); return { number: 12 }; }),
      onEvent: () => () => undefined,
      onReconnect: () => () => undefined,
    };
    const { api } = createOpenTigServerClient({ transport: transport as never, keptReads: store });
    return { api, store, asked };
  }

  it('shows a kept answer where there is nothing yet', async () => {
    const { api, asked } = client(false);
    await api.github.getPullRequest('repo', 12);
    expect(asked).toEqual([true]);
  });

  it('never swaps a confirmed answer on screen for a kept one: the refresh waits for GitHub', async () => {
    const { api, store, asked } = client(true);
    await api.github.getPullRequestLiveState('repo', 12);
    expect(asked).toEqual([false]);
    expect(store.summary([['repository', 'repo', 'pull-request-state', 12]])).toBeNull();
  });

  it('asks for the fresh answer once a kept one has been read again', async () => {
    const { api, store, asked } = client(true);
    store.kept(keptReadTarget(IPC.githubPrView, ['repo', 12])!, '2026-11-15T10:00:00.000Z', Promise.resolve({ outcome: 'updated' }));
    await Promise.resolve(); await Promise.resolve();
    await api.github.getPullRequest('repo', 12);
    expect(asked).toEqual([false]);
  });
});
