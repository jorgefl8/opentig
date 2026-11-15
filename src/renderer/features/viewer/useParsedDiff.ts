import { useEffect, useMemo, useState } from 'react';
import { DIFF_PARSE_WORKER_THRESHOLD, DiffParser } from './diff-parser';
import type { DiffFileEntry } from './patch-utils';

type ParsedDiffState = { parser: DiffParser; patch: string; files: DiffFileEntry[]; error?: never } | { parser: DiffParser; patch: string; error: string; files?: never };

const failure = (reason: unknown) => reason instanceof Error ? reason.message : 'Could not parse the diff.';

/**
 * The parsed files of `patch`, or `null` while a large one is still being
 * parsed in its worker. A small patch is parsed while rendering, so it never
 * has a frame without its files. The caller decides what stays on screen in
 * the meantime: this only ever answers for the patch it was given.
 */
export function useParsedDiff(patch: string, contentKey: string): ParsedDiffState | null {
  const { parser } = useMemo(() => ({ contentKey, parser: new DiffParser() }), [contentKey]);
  useEffect(() => () => parser.clearCache(), [parser]);
  const immediate = useMemo<ParsedDiffState | null>(() => {
    if (patch.length >= DIFF_PARSE_WORKER_THRESHOLD) return null;
    try { return { parser, patch, files: parser.parseNow(patch) }; }
    catch (reason) { return { parser, patch, error: failure(reason) }; }
  }, [parser, patch]);
  const [result, setResult] = useState<ParsedDiffState | null>(null);
  useEffect(() => {
    if (immediate) return;
    const controller = new AbortController();
    void parser.parse(patch, controller.signal).then(
      (files) => { if (!controller.signal.aborted) setResult({ parser, patch, files }); },
      (reason: unknown) => { if (!controller.signal.aborted) setResult({ parser, patch, error: failure(reason) }); },
    );
    return () => { controller.abort(); };
  }, [immediate, parser, patch]);
  if (immediate) return immediate;
  // Effects run after render: a result for another patch or document is not this one's.
  return result?.parser === parser && result.patch === patch ? result : null;
}
