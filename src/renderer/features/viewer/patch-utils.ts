import { getSingularPatch, type FileDiffMetadata } from '@pierre/diffs';
import { resolvePierreLanguage } from './pierreLanguages';

export const VIEWER_SCROLLBAR_CSS = `
  [data-code] {
    overflow-x: auto;
    overflow-y: clip;
    scrollbar-gutter: auto;
    scrollbar-width: thin;
  }

  [data-code]::-webkit-scrollbar {
    width: 0;
    height: 7px;
  }

  [data-code]::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
  }

  /* Editor widgets live in Pierre's shadow tree and cannot inherit the app's
     input rules. Keep keyboard focus from triggering iOS viewport zoom. */
  @media (max-width: 767px) {
    input, textarea, [contenteditable="true"] { font-size: 16px; }
    button { min-height: 40px; touch-action: manipulation; }
  }
`;

/**
 * Splits a unified patch into single-file patches for parsing and per-file metadata.
 * A single-file patch yields one entry unchanged.
 */
export function splitPatchFiles(patch: string): string[] {
  const headers = [...patch.matchAll(/^diff --git .*$/gm)];
  if (headers.length <= 1) return patch.trim() ? [patch] : [];
  return headers.map((header, index) => patch.slice(header.index, headers[index + 1]?.index ?? patch.length));
}

/** Lines added and removed in a unified patch. A `+++` or `---` counts as a line only inside a hunk. */
export function patchLineStats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (let start = 0; start < patch.length;) {
    const end = patch.indexOf('\n', start);
    const next = end < 0 ? patch.length : end + 1;
    const first = patch[start];
    if (first === 'd' && patch.startsWith('diff --git ', start)) inHunk = false;
    else if (first === '@' && patch.startsWith('@@', start)) inHunk = true;
    else if (inHunk && first === '+') additions++;
    else if (inHunk && first === '-') deletions++;
    start = next;
  }
  return { additions, deletions };
}

export interface DiffFileEntry {
  key: string;
  path: string;
  previousPath?: string | undefined;
  patch: string;
  fileDiff: FileDiffMetadata;
  additions: number;
  deletions: number;
  changeType: 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted';
}

/** Builds the lightweight file model used by the shared diff toolbar and rows. */
export function buildDiffFileEntries(patch: string): DiffFileEntry[] {
  return splitPatchFiles(patch).map(buildDiffFileEntry);
}

export function buildDiffFileEntry(filePatch: string, index: number): DiffFileEntry {
  const parsed = getSingularPatch(filePatch);
  return {
    key: `${parsed.prevName ?? ''}:${parsed.name}:${index}`,
    path: parsed.name,
    previousPath: parsed.prevName,
    patch: filePatch,
    fileDiff: { ...parsed, lang: resolvePierreLanguage(parsed.name) },
    additions: parsed.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
    deletions: parsed.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
    changeType: parsed.type,
  };
}
