import type { FileDiffMetadata } from '@pierre/diffs';
import { whenIdle } from '@/lib/when-idle';

/** Folded and off-screen files highlighted ahead of time, and the code they may add up to. */
const IDLE_PRIME_FILES = 12;
const IDLE_PRIME_CHARACTERS = 400_000;

interface IdleDiffPrimer {
  isWorkingPool(): boolean;
  /** Settles once the workers have started. */
  initialize(): Promise<unknown>;
  getStats(): { totalWorkers: number };
  primeDiffHighlightCache(diff: FileDiffMetadata): Promise<void>;
}

/**
 * Highlights a diff's files into the pool's cache while nothing else is
 * happening, one at a time, so a file unfolded later is painted with its
 * colors. It never takes the only worker: a file the user opens must not wait
 * behind one they may never look at. Returns how to stop.
 */
export function primeDiffsWhenIdle(pool: IdleDiffPrimer | undefined, diffs: readonly FileDiffMetadata[], idle: (run: () => void) => void = whenIdle): () => void {
  if (!pool?.isWorkingPool()) return () => undefined;
  let stopped = false;
  let characters = IDLE_PRIME_CHARACTERS;
  const queue = diffs.slice(0, IDLE_PRIME_FILES).filter((diff) => {
    const size = diff.additionCharacterCount + diff.deletionCharacterCount;
    if (diff.cacheKey == null || size > characters) return false;
    characters -= size;
    return true;
  });
  const next = (index: number) => {
    const diff = queue[index];
    if (stopped || !diff) return;
    idle(() => {
      if (stopped) return;
      void pool.primeDiffHighlightCache(diff).catch(() => undefined).then(() => next(index + 1));
    });
  };
  void pool.initialize().then(() => { if (pool.getStats().totalWorkers > 1) next(0); }, () => undefined);
  return () => { stopped = true; };
}
