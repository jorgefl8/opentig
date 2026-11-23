import { describe, expect, it } from 'vitest';
import { createBackgroundSyncPool } from './background-sync-pool';

function harness(concurrency: number) {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const pool = createBackgroundSyncPool(concurrency, (repositoryId) => {
    started.push(repositoryId);
    return new Promise<void>((resolve) => { finish.set(repositoryId, resolve); });
  });
  const complete = async (repositoryId: string) => {
    finish.get(repositoryId)!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { pool, started, complete };
}

describe('background sync pool', () => {
  it('syncs a few repositories at a time and starts the next as each one ends', async () => {
    const { pool, started, complete } = harness(3);
    pool.request(['a', 'b', 'c', 'd', 'e']);
    expect(started).toEqual(['a', 'b', 'c']);
    await complete('b');
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    await complete('a');
    await complete('c');
    expect(started).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not start a second sync of a repository that is waiting or running', async () => {
    const { pool, started, complete } = harness(1);
    pool.request(['a', 'b']);
    pool.request(['a', 'b', 'c']);
    await complete('a');
    await complete('b');
    await complete('c');
    expect(started).toEqual(['a', 'b', 'c']);
    pool.request(['a']);
    expect(started).toEqual(['a', 'b', 'c', 'a']);
  });

  it('stop drops the repositories still waiting and lets the running ones finish', async () => {
    const { pool, started, complete } = harness(2);
    pool.request(['a', 'b', 'c', 'd']);
    expect(pool.stop()).toEqual(['c', 'd']);
    await complete('a');
    await complete('b');
    expect(started).toEqual(['a', 'b']);
  });
});
