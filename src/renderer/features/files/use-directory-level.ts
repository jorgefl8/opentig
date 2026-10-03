import { useEffect, useState } from 'react';
import type { FileTreeEntry } from '@shared/git-types';

/** A response for an old destination must never replace the current folder. */
export function useDirectoryLevel(path: string, revision: number, load: (path: string) => Promise<FileTreeEntry[]>, enabled = true) {
  const [level, setLevel] = useState<{ path: string; revision: number; entries: FileTreeEntry[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void load(path).then(
      (entries) => { if (!cancelled) setLevel({ path, revision, entries, failed: false }); },
      () => { if (!cancelled) setLevel({ path, revision, entries: [], failed: true }); },
    );
    return () => { cancelled = true; };
  }, [path, revision, load, enabled]);
  const current = enabled && level?.path === path && level.revision === revision;
  return { entries: current ? level.entries : null, failed: current && level.failed };
}
