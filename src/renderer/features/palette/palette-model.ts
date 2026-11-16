import type { PaletteMode } from './palette-types';

export interface PaletteModeInfo {
  mode: PaletteMode;
  /** The tab's name. */
  label: string;
  /** What its results are called: "No branches match …". */
  noun: string;
  /** Typed first, it switches to this tab. Files has none: it is where the palette starts. */
  prefix: string | null;
  /** The search field's accessible name and placeholder in this tab. */
  placeholder: string;
  /** The result list's accessible name. */
  listLabel: string;
}

export const PALETTE_MODES: readonly PaletteModeInfo[] = [
  { mode: 'files', label: 'Files', noun: 'files', prefix: null, placeholder: 'Search files by name or path', listLabel: 'Repository files' },
  { mode: 'commands', label: 'Commands', noun: 'commands', prefix: '>', placeholder: 'Search commands', listLabel: 'Commands' },
  { mode: 'branches', label: 'Branches', noun: 'branches', prefix: '@', placeholder: 'Search branches', listLabel: 'Branches' },
  { mode: 'commits', label: 'Commits', noun: 'commits', prefix: '~', placeholder: 'Search loaded commits', listLabel: 'Commits' },
  { mode: 'pulls', label: 'PRs', noun: 'pull requests', prefix: '#', placeholder: 'Search pull requests', listLabel: 'Pull requests' },
  { mode: 'runs', label: 'Runs', noun: 'workflow runs', prefix: '!', placeholder: 'Search workflow runs', listLabel: 'Workflow runs' },
  { mode: 'repositories', label: 'Repos', noun: 'repositories', prefix: '*', placeholder: 'Search repositories', listLabel: 'Repositories' },
];

export function modeInfo(mode: PaletteMode): PaletteModeInfo {
  return PALETTE_MODES.find((item) => item.mode === mode)!;
}

/** Longer text is cut here before matching: no name or subject a person types for is longer. */
export const MAX_QUERY_LENGTH = 200;

/**
 * What typing into the field means: a mode's sign typed (or pasted) first into an
 * empty field switches to its tab and is taken out of the text; anything else is
 * text to search for, as it is. Only an empty field: a sign already in the text
 * stays, and editing after it never takes away another character.
 */
export function readInput(value: string, mode: PaletteMode, previous: string): { mode: PaletteMode; text: string } {
  if (previous !== '') return { mode, text: value };
  const first = value.charAt(0);
  const switched = first ? PALETTE_MODES.find((item) => item.prefix === first) : undefined;
  if (switched) return { mode: switched.mode, text: value.slice(1) };
  return { mode, text: value };
}

/** The next or previous tab, as Tab and Shift+Tab move. */
export function stepMode(mode: PaletteMode, step: 1 | -1): PaletteMode {
  const index = PALETTE_MODES.findIndex((item) => item.mode === mode);
  return PALETTE_MODES[(index + step + PALETTE_MODES.length) % PALETTE_MODES.length]!.mode;
}

/** The largest line `name:line` goes to; a longer number is part of the name. */
const MAX_LINE = 9_999_999;

/**
 * Splits `name:line` (and `name:line:column`, as compilers print it) into the
 * name to search for and the line to open on. The line is only ever a number.
 */
export function readFileQuery(text: string): { name: string; line: number | null } {
  const trimmed = text.trim().slice(0, MAX_QUERY_LENGTH);
  const match = /^(.*?):(\d{1,7})(?::\d{1,7})?$/.exec(trimmed);
  if (!match || !match[1]!.trim()) return { name: trimmed, line: null };
  const line = Number(match[2]);
  return { name: match[1]!.trim(), line: line >= 1 && line <= MAX_LINE ? line : null };
}

/** Lower case, with the path separators of either system the same. */
export function normalizeText(value: string): string {
  return value.replace(/\\/g, '/').toLocaleLowerCase();
}

/**
 * How well `query` matches `text`, lower is better, or null: the whole text, its
 * start, a word in it, anywhere in it, then its letters in order. The query is
 * only compared, never compiled or run.
 */
export function matchScore(text: string, query: string): number | null {
  const candidate = normalizeText(text);
  const wanted = normalizeText(query).trim();
  if (!wanted) return 0;
  if (candidate === wanted) return 0;
  if (candidate.startsWith(wanted)) return 1 + (candidate.length - wanted.length) / 1_000;
  const index = candidate.indexOf(wanted);
  if (index >= 0) {
    const atWord = /[\s/._#@:-]/.test(candidate.charAt(index - 1));
    return (atWord ? 2 : 3) + index / 1_000;
  }
  const compact = wanted.replace(/\s+/g, '');
  let previous = -1;
  let gaps = 0;
  for (const character of compact) {
    const found = candidate.indexOf(character, previous + 1);
    if (found < 0) return null;
    if (previous >= 0) gaps += found - previous - 1;
    previous = found;
  }
  return 4 + Math.min(gaps, 999) / 1_000;
}

/**
 * Orders items by their best field, the first field counting before the others,
 * and keeps the first `limit`. Equal matches keep the order they came in.
 */
export function rankBy<T>(items: readonly T[], query: string, fields: (item: T) => readonly string[], limit: number): T[] {
  const wanted = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!wanted) return items.slice(0, limit);
  const scored: { item: T; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    let best: number | null = null;
    fields(item).forEach((field, position) => {
      const score = matchScore(field, wanted);
      if (score === null) return;
      // A later field (a branch name behind a pull request's title) ranks after a match of the first.
      const weighted = score + position * 5;
      if (best === null || weighted < best) best = weighted;
    });
    if (best !== null) scored.push({ item, score: best, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((entry) => entry.item);
}

/** Where `query` shows in `text`, for marking it, or null when it is only matched letter by letter. */
export function highlightRange(text: string, query: string): [number, number] | null {
  const wanted = normalizeText(query).trim();
  const candidate = normalizeText(text);
  // A letter whose lower case is longer would shift every position after it.
  if (!wanted || candidate.length !== text.length) return null;
  const index = candidate.indexOf(wanted);
  return index < 0 ? null : [index, index + wanted.length];
}
