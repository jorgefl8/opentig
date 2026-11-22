import { useEffect, useState } from 'react';
import type { FileDiffMetadata } from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import { gainsFromWholeFiles, type FileVersionsReader, type WholeFileDiffs } from './whole-file-diff';

/**
 * How long a file whose patch changed, as in a refresh of a change being edited, keeps its previous
 * whole-file diff on screen while the new one is read, rather than going back to its patch's colors
 * for a moment. Reading a file whole usually takes a few tens of milliseconds.
 */
const HOLD_PREVIOUS_MS = 250;

/**
 * The diff to show for a file: its patch's at first, then the same hunks with both files once they are
 * read, as `WholeFileDiffs` allows. Their colors are worked out before they replace the patch's, so
 * the change shows only in the colors and in the unmodified lines that can be unfolded. A file read
 * whole before, in the same document, starts that way when its colors are still kept; otherwise it
 * starts from its patch, as the first time.
 */
export function useWholeFileDiff(fileKey: string, partial: FileDiffMetadata, store: WholeFileDiffs | null | undefined, read: FileVersionsReader | null | undefined): FileDiffMetadata {
  const pool = useWorkerPool();
  const [whole, setWhole] = useState<{ patchKey: string | undefined; diff: FileDiffMetadata } | null>(() => {
    const kept = store?.kept(fileKey, partial);
    // Without workers a diff is colored where it is drawn, before it is painted.
    return kept && (!pool || pool.getDiffResultCache(kept)) ? { patchKey: partial.cacheKey, diff: kept } : null;
  });
  /** The patch whose read finished without a whole-file diff, or took too long: its own diff shows. */
  const [settled, setSettled] = useState<string | undefined>(undefined);
  const current = whole?.patchKey === partial.cacheKey;
  const readable = Boolean(store && read && gainsFromWholeFiles(partial));
  useEffect(() => {
    if (current || !readable) return;
    const controller = new AbortController();
    const patchKey = partial.cacheKey;
    const timer = setTimeout(() => setSettled(patchKey), HOLD_PREVIOUS_MS);
    const settle = () => { if (!controller.signal.aborted) setSettled(patchKey); };
    void store!.load(fileKey, partial, read!, controller.signal).then(async (diff) => {
      if (!diff) return settle();
      // Colored before it takes the patch's place: a diff given to a viewer before its colors are ready is painted plain meanwhile.
      if (pool) await pool.primeDiffHighlightCache(diff).catch(() => undefined);
      if (!controller.signal.aborted) setWhole({ patchKey, diff });
    }).catch(settle);
    // A file folded, or a document closed, before its files came back stops reading them.
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [current, fileKey, partial, pool, read, readable, store]);
  if (!whole) return partial;
  if (current) return whole.diff;
  return readable && settled !== partial.cacheKey ? whole.diff : partial;
}
