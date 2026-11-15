import { useState, type PropsWithChildren } from 'react';
import { WorkerPoolContext } from '@pierre/diffs/react';
import { getHighlightPool } from './pierre-pool';

/**
 * Gives the viewers below the session's highlighting pool. Mounting or
 * unmounting this does not start or stop it: see `getHighlightPool`.
 */
export function PierreWorkerPool({ children }: PropsWithChildren) {
  const [pool] = useState(getHighlightPool);
  return <WorkerPoolContext.Provider value={pool}>{children}</WorkerPoolContext.Provider>;
}
