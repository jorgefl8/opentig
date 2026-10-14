import { useEffect, useMemo, useState } from 'react';
import type { FileTreeEntry } from '@shared/git-types';
import { createQuickOpenIndex, rankQuickOpenIndex, rankQuickOpenIndexAsync, type QuickOpenResult } from './quick-open';

// At 100k paths even indexed fuzzy searches can exceed a frame. Keep small
// repositories and the pre-sorted empty query immediate.
const ASYNC_SEARCH_FILE_COUNT = 10_000;
const NO_RESULTS: QuickOpenResult[] = [];

export function useQuickOpenResults(
  files: FileTreeEntry[] | null, query: string, includeIgnored: boolean, activePath: string | null, open: boolean,
): { results: QuickOpenResult[]; pending: boolean } {
  const index = useMemo(() => files ? createQuickOpenIndex(files) : null, [files]);
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
