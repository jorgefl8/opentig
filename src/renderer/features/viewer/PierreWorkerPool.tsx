import type { PropsWithChildren } from 'react';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import { JUSTGIT_DIFF_THEMES } from './diffThemes';

export function PierreWorkerPool({ children }: PropsWithChildren) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffWorker(), poolSize: 1, totalASTLRUCacheSize: 20 }}
      highlighterOptions={{ theme: JUSTGIT_DIFF_THEMES, tokenizeMaxLineLength: 10_000 }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
