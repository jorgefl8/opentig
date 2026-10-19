import { describe, expect, it, vi } from 'vitest';
import { ReadSingleFlight } from './ReadSingleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('pending read generations', () => {
  it.each(['success', 'failure'])('bounds retries under continuous invalidation and settles with the last %s', async (outcome) => {
    const flights = new ReadSingleFlight();
    let attempts = 0;
    const read = vi.fn(async () => {
      // Stop the fixture after ten invalidations so a regression fails without hanging.
      if (++attempts <= 10) flights.invalidate('repo');
      if (outcome === 'failure') throw new Error('obsolete failure');
      return 'obsolete snapshot';
    });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => flights.run('repo', 'status', read)));
    expect(attempts).toBe(3);
    for (const result of results) {
      if (outcome === 'failure') expect(result).toMatchObject({ status: 'rejected', reason: { message: 'obsolete failure' } });
      else expect(result).toEqual({ status: 'fulfilled', value: 'obsolete snapshot' });
    }
    expect(await flights.run('repo', 'status', async () => 'settled')).toBe('settled');
  });

  it('shares four readers, releases settled results, and isolates resources and repositories', async () => {
    const flights = new ReadSingleFlight();
    const gate = deferred<string>();
    const read = vi.fn(() => gate.promise);
    const readers = Array.from({ length: 4 }, () => flights.run('repo', 'status', read));
    const otherRepo = flights.run('other', 'status', read);
    const otherResource = flights.run('repo', 'branches', read);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(3);
    gate.resolve('ready');
    expect(await Promise.all([...readers, otherRepo, otherResource])).toEqual(Array(6).fill('ready'));
    await flights.run('repo', 'status', read);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('does not retain errors and lets four consumers retry together', async () => {
    const flights = new ReadSingleFlight();
    const gate = deferred<string>();
    const read = vi.fn(() => gate.promise);
    const readers = Array.from({ length: 4 }, () => flights.run('repo', 'status', read));
    const settled = Promise.allSettled(readers);
    gate.reject(new Error('offline'));
    expect((await settled).every(result => result.status === 'rejected')).toBe(true);
    read.mockResolvedValue('recovered');
    expect(await Promise.all(Array.from({ length: 4 }, () => flights.run('repo', 'status', read)))).toEqual(Array(4).fill('recovered'));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'failure'])('retries an invalidated %s without removing the new generation', async (outcome) => {
    const flights = new ReadSingleFlight();
    const old = deferred<string>();
    const fresh = deferred<string>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValue(fresh.promise);
    const original = flights.run('repo', 'status', read);
    await Promise.resolve();
    flights.invalidate('repo');
    const current = flights.run('repo', 'status', read);
    await Promise.resolve();
    if (outcome === 'success') old.resolve('stale');
    else old.reject(new Error('stale failure'));
    await Promise.resolve();
    await Promise.resolve();
    const joined = flights.run('repo', 'status', read);
    fresh.resolve('fresh');
    expect(await Promise.all([original, current, joined])).toEqual(['fresh', 'fresh', 'fresh']);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
