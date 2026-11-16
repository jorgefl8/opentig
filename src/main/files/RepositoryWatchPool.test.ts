import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryWatchState } from '../../shared/runtime-events';
import { RepositoryWatchPool } from './RepositoryWatchPool';

const repository = (id: string): RepositoryInfo => ({ id, name: id, repositoryName: id, path: `/repositories/${id}`, commonDir: `/repositories/${id}/.git` });

/** A pool whose watches stand in for the system's: each starts watching at once and records being stopped. */
function fixture(options: { maxWatched?: number } = {}) {
  const started: string[] = [];
  const stopped: string[] = [];
  const states: [string, RepositoryWatchState, string | null][] = [];
  const watchers: { fail(): void }[] = [];
  let next = 0;
  const pool = new RepositoryWatchPool(() => undefined, () => false, {
    graceMs: 15_000,
    startDelayMs: 300,
    ...(options.maxWatched ? { maxWatched: options.maxWatched } : {}),
    onState: (id, state, watchId) => states.push([id, state, watchId]),
    createWatcher: (onState) => {
      let current: { id: string; watchId: string } | null = null;
      const watcher = {
        start: (target: RepositoryInfo) => {
          started.push(target.id);
          current = { id: target.id, watchId: `watch-${++next}` };
          onState(target.id, 'watching', current.watchId);
          return true;
        },
        stop: () => {
          if (current) {
            stopped.push(current.id);
            onState(current.id, 'stopped', null);
          }
          current = null;
        },
        status: (id: string) => current?.id === id ? { state: 'watching' as const, watchId: current.watchId } : { state: 'stopped' as const, watchId: null },
        covers: (id: string) => current?.id === id ? current.watchId : null,
        /** The watch gives up by itself, as after failing to start again. */
        fail: () => {
          const id = current!.id;
          current = null;
          onState(id, 'stopped', null);
        },
      };
      watchers.push(watcher);
      return watcher;
    },
  });
  return { pool, started, stopped, states, watchers };
}

describe('RepositoryWatchPool', () => {
  afterEach(() => vi.useRealTimers());

  it('shares one watch between everyone on a repository and keeps it for the grace period after the last one leaves', () => {
    vi.useFakeTimers();
    const { pool, started, stopped } = fixture();
    pool.hold('tab-1', repository('a'));
    pool.hold('tab-2', repository('a'));
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['a']);
    expect(pool.status('a').state).toBe('watching');

    pool.release('tab-1');
    pool.release('tab-2');
    vi.advanceTimersByTime(14_999);
    expect(stopped).toEqual([]);
    expect(pool.status('a').state).toBe('watching');
    vi.advanceTimersByTime(1);
    expect(stopped).toEqual(['a']);
    expect(pool.watchedCount).toBe(0);
  });

  it('gives a reload back the watch it left within the grace period, without setting it up again', () => {
    vi.useFakeTimers();
    const { pool, started, stopped } = fixture();
    pool.hold('tab', repository('a'));
    vi.advanceTimersByTime(300);
    const before = pool.status('a').watchId;
    pool.release('tab');
    vi.advanceTimersByTime(5_000);
    pool.hold('reloaded-tab', repository('a'));
    vi.advanceTimersByTime(60_000);
    expect(started).toEqual(['a']);
    expect(stopped).toEqual([]);
    expect(pool.status('a').watchId).toBe(before);
  });

  it('starts only the watches of the first repository and of the one someone stops on when they go through many quickly', () => {
    vi.useFakeTimers();
    const { pool, started } = fixture();
    for (let index = 0; index < 12; index += 1) {
      pool.hold('tab', repository(`r${index}`));
      vi.advanceTimersByTime(150);
    }
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['r0', 'r11']);
  });

  it('watches a repository opened on its own at once, without waiting for the start delay', () => {
    vi.useFakeTimers();
    const { pool, started } = fixture();
    pool.hold('tab', repository('a'));
    expect(started).toEqual(['a']);
    vi.advanceTimersByTime(1_000);
    pool.hold('tab', repository('b'));
    expect(started).toEqual(['a', 'b']);
  });

  it('gives the place of a watch that stopped by itself to a repository waiting for one', () => {
    vi.useFakeTimers();
    const { pool, started, watchers } = fixture({ maxWatched: 1 });
    pool.hold('tab-1', repository('a'));
    pool.hold('tab-2', repository('b'));
    expect(started).toEqual(['a']);
    watchers[0]!.fail();
    expect(started).toEqual(['a', 'b']);
    expect(pool.status('b').state).toBe('watching');
  });

  it('gives up the watch idle the longest for a repository someone opens once the bound is reached', () => {
    vi.useFakeTimers();
    const { pool, started, stopped } = fixture({ maxWatched: 2 });
    pool.hold('tab-1', repository('a'));
    pool.hold('tab-2', repository('b'));
    vi.advanceTimersByTime(300);
    pool.release('tab-1');
    vi.advanceTimersByTime(1_000);
    pool.release('tab-2');
    pool.hold('tab-3', repository('c'));
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['a', 'b', 'c']);
    expect(stopped).toEqual(['a']);
    expect(pool.watchedCount).toBe(2);
  });

  it('beyond the bound, says a held repository is not watched, and watches it once another is given up', () => {
    vi.useFakeTimers();
    const { pool, started, states } = fixture({ maxWatched: 2 });
    pool.hold('tab-1', repository('a'));
    pool.hold('tab-2', repository('b'));
    pool.hold('tab-3', repository('c'));
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['a', 'b']);
    expect(pool.status('c')).toEqual({ state: 'stopped', watchId: null });
    expect(pool.covers('c', 'file.txt')).toBeNull();
    expect(states).toContainEqual(['c', 'stopped', null]);

    // The watch left idle goes to the repository waiting, at once rather than after its grace period.
    pool.release('tab-1');
    expect(started).toEqual(['a', 'b', 'c']);
    expect(pool.status('c').state).toBe('watching');
    expect(pool.watchedCount).toBe(2);
  });

  it('gives the first room to the repository waiting longest, not to one opened after it', () => {
    vi.useFakeTimers();
    const { pool, started } = fixture({ maxWatched: 1 });
    pool.hold('tab-1', repository('a'));
    vi.advanceTimersByTime(300);
    pool.hold('tab-2', repository('b'));
    vi.advanceTimersByTime(300);
    pool.hold('tab-3', repository('c'));
    vi.advanceTimersByTime(300);
    pool.release('tab-1');
    pool.hold('tab-1', repository('d'));
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['a', 'b']);
    pool.release('tab-2');
    expect(started).toEqual(['a', 'b', 'c']);
    pool.release('tab-3');
    expect(started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('starts a watch that stopped by itself again when its repository is opened again, and does not count it meanwhile', () => {
    vi.useFakeTimers();
    const { pool, started, watchers } = fixture({ maxWatched: 1 });
    pool.hold('tab-1', repository('a'));
    vi.advanceTimersByTime(300);
    watchers[0]!.fail();
    expect(pool.watchedCount).toBe(0);
    // Its room is free for another repository.
    pool.hold('tab-2', repository('b'));
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['a', 'b']);

    pool.release('tab-2');
    pool.hold('tab-1', repository('a'));
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['a', 'b', 'a']);
    expect(pool.status('a').state).toBe('watching');
    // Nothing starts it again by itself.
    watchers[2]!.fail();
    vi.advanceTimersByTime(60_000);
    expect(started).toEqual(['a', 'b', 'a']);
  });

  it('reports the end of every watch it gives up, so nobody told it was running keeps relying on it', () => {
    vi.useFakeTimers();
    const { pool, states } = fixture();
    pool.hold('tab-1', repository('a'));
    pool.hold('tab-2', repository('b'));
    vi.advanceTimersByTime(300);
    pool.release('tab-1');
    vi.advanceTimersByTime(15_000);
    pool.forget('b');
    expect(states.filter(([, state]) => state === 'stopped')).toEqual([['a', 'stopped', null], ['b', 'stopped', null]]);
  });

  it('stops a forgotten repository’s watch at once, whoever holds it, and makes room for one waiting', () => {
    vi.useFakeTimers();
    const { pool, started, stopped } = fixture({ maxWatched: 1 });
    pool.hold('tab-1', repository('a'));
    pool.hold('tab-2', repository('b'));
    vi.advanceTimersByTime(300);
    pool.forget('a');
    expect(stopped).toEqual(['a']);
    expect(pool.heldBy('tab-1')).toBeNull();
    expect(started).toEqual(['a', 'b']);
  });

  it('follows a repository that moved, and stops everything when closed', () => {
    vi.useFakeTimers();
    const { pool, started, stopped } = fixture();
    pool.hold('tab', repository('a'));
    vi.advanceTimersByTime(300);
    pool.hold('tab', { ...repository('a'), path: '/moved/a', commonDir: '/moved/a/.git' });
    expect(started).toEqual(['a', 'a']);
    pool.stop();
    expect(stopped).toEqual(['a']);
    pool.hold('tab', repository('b'));
    vi.advanceTimersByTime(1_000);
    expect(started).toEqual(['a', 'a']);
  });

  it('stops a watch before its folder goes, keeps who holds it, and watches it again when the folder may be', async () => {
    const { pool, started, stopped, states } = fixture();
    pool.hold('tab', repository('a'));
    pool.hold('other', repository('b'));
    await pool.pause('/repositories/a/');
    expect(stopped).toEqual(['a']);
    expect(states.at(-1)).toEqual(['a', 'stopped', null]);
    expect(pool.status('a').state).toBe('stopped');
    expect(pool.heldBy('tab')).toBe('a');
    // Held again meanwhile, it stays stopped until the pause ends.
    pool.hold('third', repository('a'));
    expect(started).toEqual(['a', 'b']);
    pool.endPause('/repositories/a');
    expect(started).toEqual(['a', 'b', 'a']);
    expect(pool.status('a').state).toBe('watching');
  });

  it('starts no watch in a folder being deleted, even for someone who opens it after everyone left it', async () => {
    const { pool, started } = fixture();
    pool.hold('tab', repository('a'));
    await pool.pause('/repositories/a');
    // Its last holder leaves, and a page reconnecting asks for it again.
    pool.release('tab');
    pool.hold('reconnected', repository('a'));
    expect(started).toEqual(['a']);
    expect(pool.status('a').state).toBe('stopped');
    pool.endPause('/repositories/a');
    expect(started).toEqual(['a', 'a']);
  });

});
