import type { LineBlameCommit, LineBlameResult } from '@shared/line-blame';

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** "3 months ago", spelled out as in an editor's inline blame. A time ahead of the clock reads as now. */
export function formatBlameAge(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const seconds = (now - time) / 1000;
  for (const [unit, length] of UNITS) {
    if (seconds >= length) return relativeTime.format(-Math.floor(seconds / length), unit);
  }
  return 'just now';
}

export const NOT_COMMITTED_LABEL = 'Not committed yet';

/** The faint text shown after a line: `Ada Lovelace, 3 months ago • Fix rounding in totals`. */
export function blameGhostText(commit: LineBlameCommit, now = Date.now()): string {
  if (commit.uncommitted) return NOT_COMMITTED_LABEL;
  const age = formatBlameAge(commit.authoredAt, now);
  return `${commit.authorName}${age ? `, ${age}` : ''} • ${commit.summary}`;
}

export function shortOid(oid: string): string {
  return oid.slice(0, 7);
}

/** The blame of one-based `lineNumber`, when that line was blamed. */
export function blameForLine(result: LineBlameResult | null, lineNumber: number): { commit: LineBlameCommit; originalLine: number } | null {
  if (result?.status !== 'ready') return null;
  const line = result.lines[lineNumber - 1];
  const commit = line && result.commits[line.commit];
  return commit ? { commit, originalLine: line.originalLine } : null;
}

/**
 * Which line shows its blame: the hovered line wins; otherwise the caret's
 * line while the editor has focus, as an editor's current-line blame does.
 */
export function blameTargetLine({ hovered, caret, focused }: { hovered: number | null; caret: number | null; focused: boolean }): number | null {
  return hovered ?? (focused ? caret : null);
}

/**
 * The one-based line under a pointer event inside Pierre's shadow DOM, from a
 * content row (`[data-line]`) or its gutter number (`[data-column-number]`).
 */
export function lineNumberFromEventPath(path: readonly EventTarget[]): number | null {
  for (const target of path) {
    if (!(target instanceof Element)) continue;
    const parent = target.parentElement;
    if (parent?.hasAttribute('data-content') && target.hasAttribute('data-line')) return positiveInteger(target.getAttribute('data-line'));
    if (parent?.hasAttribute('data-gutter') && target.hasAttribute('data-column-number')) return positiveInteger(target.getAttribute('data-column-number'));
    if (target.tagName === 'PRE') return null;
  }
  return null;
}

function positiveInteger(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
