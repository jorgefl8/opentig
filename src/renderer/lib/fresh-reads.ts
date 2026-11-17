import { hashKey, type QueryKey } from '@tanstack/react-query';

/** One refresh's ask that a query be read from GitHub itself; `done` once such a read has completed. */
interface Ask { done: boolean }

const asks = new Map<string, Ask>();

/**
 * Asks that the next reads of these queries come from GitHub itself, past what
 * the backend read moments ago and serves as current, as a manual refresh should.
 * The ask holds until a fresh read of the query completes, so a read that
 * replaces a cancelled one is fresh too. Whoever asks drops it when its reads
 * settle, so an ask nothing took doesn't make some later, ordinary read fresh.
 */
export function askFreshReads(queryKeys: readonly QueryKey[]): { answered(queryKey: QueryKey): boolean; drop(): void } {
  const own = new Map(queryKeys.map((queryKey) => [hashKey(queryKey), { done: false } as Ask]));
  for (const [key, ask] of own) asks.set(key, ask);
  return {
    answered: (queryKey) => own.get(hashKey(queryKey))?.done ?? true,
    drop: () => { for (const [key, ask] of own) if (asks.get(key) === ask) asks.delete(key); },
  };
}

/**
 * Reads a query, freshly when a refresh asked for it. A read that was cancelled
 * leaves the ask for the read that replaces it; one that completed, even with
 * an error, answers it.
 */
export async function readFresh<T>(queryKey: QueryKey, signal: AbortSignal | undefined, read: (fresh: boolean) => Promise<T>): Promise<T> {
  const key = hashKey(queryKey);
  const ask = asks.get(key);
  const settle = () => {
    if (!ask || signal?.aborted) return;
    ask.done = true;
    if (asks.get(key) === ask) asks.delete(key);
  };
  try {
    const value = await read(ask !== undefined);
    settle();
    return value;
  } catch (error) {
    settle();
    throw error;
  }
}

/** For tests: how many asks are waiting. */
export function pendingFreshReads(): number {
  return asks.size;
}
