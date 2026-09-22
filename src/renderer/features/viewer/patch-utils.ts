import { getSingularPatch } from '@pierre/diffs';

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
 * Splits a unified patch into one string per file so each can be fed to `PatchDiff`,
 * which only accepts a single-file patch. A single-file patch yields one entry unchanged.
 */
export function splitPatchFiles(patch: string): string[] {
  const headers = [...patch.matchAll(/^diff --git .*$/gm)];
  if (headers.length <= 1) return patch.trim() ? [patch] : [];
  return headers.map((header, index) => patch.slice(header.index, headers[index + 1]?.index ?? patch.length));
}

export interface DiffFileEntry {
  key: string;
  path: string;
  previousPath?: string | undefined;
  patch: string;
  additions: number;
  deletions: number;
  changeType: 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted';
}

/** Builds the lightweight file model used by the shared diff toolbar and rows. */
export function buildDiffFileEntries(patch: string): DiffFileEntry[] {
  return splitPatchFiles(patch).map((filePatch, index) => {
    const parsed = getSingularPatch(filePatch);
    return {
      key: `${parsed.prevName ?? ''}:${parsed.name}:${index}`,
      path: parsed.name,
      previousPath: parsed.prevName,
      patch: filePatch,
      additions: parsed.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
      deletions: parsed.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
      changeType: parsed.type,
    };
  });
}
