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
  let next = 0;
  const pool = new RepositoryWatchPool(() => undefined, () => false, {
    graceMs: 15_000,
    startDelayMs: 300,
    ...(options.maxWatched ? { maxWatched: options.maxWatched } : {}),
    onState: (id, state, watchId) => states.push([id, state, watchId]),
    createWatcher: (onState) => {
      let current: { id: string; watchId: string } | null = null;
      return {
        start: (target) => {
          started.push(target.id);
          current = { id: target.id, watchId: `watch-${++next}` };
          onState(target.id, 'watching', current.watchId);
          return true;
        },
        stop: () => {
          if (current) stopped.push(current.id);
          current = null;
        },
        status: (id) => current?.id === id ? { state: 'watching', watchId: current.watchId } : { state: 'stopped', watchId: null },
        covers: (id) => current?.id === id ? current.watchId : null,
      };
    },
  });
  return { pool, started, stopped, states };
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

  it('starts only the watch of the repository someone stops on when they go through many quickly', () => {
    vi.useFakeTimers();
    const { pool, started } = fixture();
    for (let index = 0; index < 12; index += 1) {
      pool.hold('tab', repository(`r${index}`));
      vi.advanceTimersByTime(150);
    }
    vi.advanceTimersByTime(300);
    expect(started).toEqual(['r11']);
    expect(pool.watchedCount).toBe(1);
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

    pool.release('tab-1');
    vi.advanceTimersByTime(14_999);
    expect(started).toEqual(['a', 'b']);
    vi.advanceTimersByTime(1);
    expect(started).toEqual(['a', 'b', 'c']);
    expect(pool.status('c').state).toBe('watching');
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
});
