import { useEffect, type PropsWithChildren } from 'react';
import type { ThemesType } from '@pierre/diffs';
import { useWorkerPool, WorkerPoolContextProvider } from '@pierre/diffs/react';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import { toast } from 'sonner';
import { JUSTGIT_DIFF_THEMES } from './diffThemes';

export function PierreWorkerPool({ children, theme = JUSTGIT_DIFF_THEMES }: PropsWithChildren<{ theme?: ThemesType }>) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffWorker(), poolSize: 1, totalASTLRUCacheSize: 20 }}
      highlighterOptions={{ theme, tokenizeMaxLineLength: 10_000 }}
    >
      <PierreWorkerThemeSync theme={theme} />
      {children}
    </WorkerPoolContextProvider>
  );
}

function PierreWorkerThemeSync({ theme }: { theme: ThemesType }) {
  const manager = useWorkerPool();
  const { light, dark } = theme;

  useEffect(() => {
    if (!manager) return;
    let active = true;
    void manager.setRenderOptions({
      theme: { light, dark },
      tokenizeMaxLineLength: 10_000,
    }).catch((reason: unknown) => {
      if (!active) return;
      toast.error('Could not update the syntax theme', {
        description: reason instanceof Error ? reason.message : 'Unknown error',
      });
    });
    return () => { active = false; };
  }, [dark, light, manager]);

  return null;
}
