import { useEffect, useRef, useState } from 'react';
import { LINE_BLAME_MAX_BYTES, type LineBlameResult } from '@shared/line-blame';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { opentig } from '@/lib/opentig-api';

/** Typing pauses this long before an unsaved draft is blamed again. */
export const DRAFT_BLAME_DELAY_MS = 600;

type LoadLineBlame = (repositoryId: string, path: string, draft?: string) => Promise<LineBlameResult>;

/**
 * Reads blame for the editor's text once it settles. The saved file is blamed
 * as it is on disk; an unsaved draft is sent along so Git maps edited lines onto
 * HEAD itself. A result only applies to the exact text it was read for, so the
 * blame disappears while typing and returns when typing pauses.
 */
export function useLineBlame({ enabled, repositoryId, path, revision, text, savedText, load = opentig.repository.lineBlame }: {
  enabled: boolean;
  repositoryId: string;
  path: string;
  revision: number;
  text: string;
  savedText: string;
  load?: LoadLineBlame;
}): LineBlameResult | null {
  const settled = useDebouncedValue(text, DRAFT_BLAME_DELAY_MS);
  const [state, setState] = useState<{ key: string; text: string; result: LineBlameResult | null } | null>(null);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const key = `${repositoryId}\0${path}\0${revision}`;
  useEffect(() => {
    if (!enabled || settled !== text) return;
    const draft = settled === savedText ? undefined : settled;
    if (draft !== undefined && draft.length > LINE_BLAME_MAX_BYTES) {
      setState({ key, text: settled, result: { status: 'too-large', limitBytes: LINE_BLAME_MAX_BYTES } });
      return;
    }
    let active = true;
    loadRef.current(repositoryId, path, draft).then(
      (result) => { if (active) setState({ key, text: settled, result }); },
      // Blame is optional context: a failed read simply shows none.
      () => { if (active) setState({ key, text: settled, result: null }); },
    );
    return () => { active = false; };
  }, [enabled, key, path, repositoryId, savedText, settled, text]);
  return enabled && state?.key === key && state.text === text ? state.result : null;
}

