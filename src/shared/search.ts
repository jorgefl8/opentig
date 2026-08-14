/** Options mirror the toggles of the search panel: case, whole word, regex. */
export interface SearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
  /** Matched inside a file excluded by .gitignore rules. */
  ignored: boolean;
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
