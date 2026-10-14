import { useEffect, useMemo, useState } from 'react';
import { DiffParser } from './diff-parser';
import type { DiffFileEntry } from './patch-utils';

type ParsedDiffState = { parser: DiffParser; patch: string; files: DiffFileEntry[]; error?: never } | { parser: DiffParser; patch: string; error: string; files?: never };

export function useParsedDiff(patch: string, contentKey: string) {
  const { parser } = useMemo(() => ({ contentKey, parser: new DiffParser() }), [contentKey]);
  useEffect(() => () => parser.clearCache(), [parser]);
  const [result, setResult] = useState<ParsedDiffState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void parser.parse(patch, controller.signal).then(
      (files) => { if (!controller.signal.aborted) setResult({ parser, patch, files }); },
      (reason: unknown) => {
        if (!controller.signal.aborted) setResult({ parser, patch, error: reason instanceof Error ? reason.message : 'Could not parse the diff.' });
      },
    );
    return () => { controller.abort(); };
  }, [parser, patch]);
  // Effects run after render. Hide the previous revision immediately, including
  // the interval before cleanup cancels its request.
  return result?.parser === parser && result.patch === patch ? result : null;
}
