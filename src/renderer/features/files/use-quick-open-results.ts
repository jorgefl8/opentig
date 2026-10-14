import { useEffect, useMemo, useState } from 'react';
import type { FileTreeEntry } from '@shared/git-types';
import { createQuickOpenIndex, rankQuickOpenIndex, rankQuickOpenIndexAsync, type QuickOpenIndex, type QuickOpenResult } from './quick-open';

// At 100k paths even indexed fuzzy searches can exceed a frame. Keep small
// repositories and the pre-sorted empty query immediate.
const ASYNC_SEARCH_FILE_COUNT = 10_000;
const NO_RESULTS: QuickOpenResult[] = [];

export function useQuickOpenResults(
  files: FileTreeEntry[] | null, query: string, includeIgnored: boolean, activePath: string | null, open: boolean,
): { results: QuickOpenResult[]; pending: boolean } {
  const [indexed, setIndexed] = useState<{ files: FileTreeEntry[]; index: QuickOpenIndex } | null>(null);
  let snapshot = indexed?.files === files ? indexed : null;
  // Do not synchronously walk and sort background file-tree refreshes while
  // the dialog is closed. Reopenings reuse the same immutable snapshot.
  if (!snapshot && open && files) snapshot = { files, index: createQuickOpenIndex(files) };
  if (snapshot !== indexed) setIndexed(snapshot);
  const index = snapshot?.index ?? null;
  const request = useMemo(() => ({ index, query, options: { includeIgnored, activePath, limit: 100 } }), [index, query, includeIgnored, activePath]);
  const deferred = open && index !== null && index.files.length >= ASYNC_SEARCH_FILE_COUNT && query.trim().length > 0;
  const immediate = useMemo(
    () => open && !deferred && index ? rankQuickOpenIndex(index, query, request.options) : NO_RESULTS,
    [open, deferred, index, query, request],
  );
  const [completed, setCompleted] = useState<{ request: typeof request; results: QuickOpenResult[] } | null>(null);

  useEffect(() => {
    if (!deferred || !request.index) {
      setCompleted(null);
      return;
    }
    const controller = new AbortController();
    void rankQuickOpenIndexAsync(request.index, request.query, request.options, controller.signal).then((results) => {
      if (results !== null && !controller.signal.aborted) setCompleted({ request, results });
    });
    return () => controller.abort();
  }, [deferred, request]);

  // Clear stale selectable rows immediately; publish only a complete pass for
  // the current snapshot, query and visibility. Cleanup also cancels on close.
  if (!deferred) return { results: immediate, pending: false };
  if (completed?.request === request) return { results: completed.results, pending: false };
  return { results: NO_RESULTS, pending: true };
}
