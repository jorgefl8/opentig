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
  // A background refresh must not unmount the list or reset its scroll position.
  const current = enabled && level?.path === path;
  return { entries: current ? level.entries : null, failed: current && level.failed, refreshing: !current || level.revision !== revision };
}
