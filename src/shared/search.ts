/** Options mirror the toggles of the search panel: case, whole word, regex. */
export interface SearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchMatch {
  line: number;
  /** One-based UTF-16 column of this exact occurrence. */
  column?: number;
  /** UTF-16 length of this exact occurrence. */
  length?: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
  /** Matched inside a file excluded by .gitignore rules. */
  ignored: boolean;
  /** Content fingerprint used to reject stale replacements. */
  revision?: string;
  /** More occurrences exist in this file than the ones listed in `matches`. */
  truncatedMatches?: boolean;
}

export interface SearchResult {
  files: SearchFileResult[];
  totalMatches: number;
  /** Matches that live in ignored files; already counted in `totalMatches`. */
  ignoredMatches: number;
  /** True when the caps below cut the result set short. */
  truncated: boolean;
}

export const SEARCH_MAX_MATCHES = 2_000;
export const SEARCH_MAX_MATCHES_PER_FILE = 50;
export const SEARCH_MAX_QUERY_LENGTH = 512;
export const SEARCH_MAX_REPLACEMENT_LENGTH = 1024 * 1024;
export const SEARCH_REPLACE_MAX_FILES = 2_000;

export type SearchReplaceScope =
  | { kind: 'match'; path: string; revision: string; line: number; column: number }
  | { kind: 'file'; path: string; revision: string }
  | { kind: 'all'; files: { path: string; revision: string }[] };

export interface SearchReplaceRequest {
  options: SearchOptions;
  replacement: string;
  scope: SearchReplaceScope;
}

export type SearchReplaceResult =
  | { status: 'replaced'; replacements: number; files: string[] }
  | { status: 'stale'; paths: string[] }
  | { status: 'no-match' };

export interface ExactSearchMatch {
  start: number;
  end: number;
  line: number;
  column: number;
  text: string;
  captures: (string | undefined)[];
  groups?: Record<string, string | undefined>;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The renderer highlights matches itself, so it needs the same pattern Git
 * matched with. Returns null when the user typed an invalid regular expression.
 */
export function buildSearchRegex(options: SearchOptions): RegExp | null {
  if (!options.query) return null;
  const source = options.regex ? options.query : escapeRegExp(options.query);
  const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(pattern, options.matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/** Finds exact occurrences using the same expression used by highlighting and replacement. */
export function findSearchMatches(content: string, options: SearchOptions, limit = Number.POSITIVE_INFINITY): ExactSearchMatch[] {
  const pattern = buildSearchRegex(options);
  if (!pattern) return [];
  const matches: ExactSearchMatch[] = [];
  let line = 1;
  let lineStart = 0;
  let scannedTo = 0;
  for (let match = pattern.exec(content); match !== null && matches.length < limit; match = pattern.exec(content)) {
    if (match[0] === '') { pattern.lastIndex += 1; continue; }
    while (scannedTo < match.index) {
      if (content.charCodeAt(scannedTo) === 10) { line += 1; lineStart = scannedTo + 1; }
      scannedTo += 1;
    }
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      line,
      column: match.index - lineStart + 1,
      text: match[0],
      captures: match.slice(1),
      ...(match.groups ? { groups: { ...match.groups } } : {}),
    });
  }
  return matches;
}

/** Applies selected exact matches from right to left, preserving JavaScript replacement tokens. */
export function replaceSearchMatches(content: string, matches: ExactSearchMatch[], replacement: string): string {
  let next = content;
  for (const match of [...matches].sort((left, right) => right.start - left.start)) {
    const expanded = expandReplacement(content, match, replacement);
    next = `${next.slice(0, match.start)}${expanded}${next.slice(match.end)}`;
  }
  return next;
}

function expandReplacement(content: string, match: ExactSearchMatch, replacement: string): string {
  return replacement.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (token, key: string) => {
    if (key === '$') return '$';
    if (key === '&') return content.slice(match.start, match.end);
    if (key === '`') return content.slice(0, match.start);
    if (key === "'") return content.slice(match.end);
    if (key.startsWith('<')) return match.groups ? (match.groups[key.slice(1, -1)] ?? '') : token;
    const index = Number(key);
    if (index > 0 && index <= match.captures.length) return match.captures[index - 1] ?? '';
    if (key.length === 2) {
      const first = Number(key[0]);
      if (first > 0 && first <= match.captures.length) return `${match.captures[first - 1] ?? ''}${key[1]}`;
    }
    return token;
  });
}
