import { SEARCH_MAX_MATCHES, SEARCH_MAX_MATCHES_PER_FILE, type SearchResult } from '../../shared/search';

/**
 * Parses `git grep -n -z` output. With `-z` the field separators become NUL
 * bytes, so paths and matched text containing colons still parse
 * unambiguously; older Git versions only replace the one after the path, so a
 * colon is accepted as the line-number separator too.
 */
export function parseSearchOutput(output: string): SearchResult {
  const files: SearchResult['files'] = [];
  const byPath = new Map<string, SearchResult['files'][number]>();
  let totalMatches = 0;
  let truncated = false;

  for (const row of output.split('\n')) {
    if (!row) continue;
    const separator = row.indexOf('\0');
    if (separator < 0) continue;
    const path = row.slice(0, separator);
    const rest = row.slice(separator + 1);
    const nul = rest.indexOf('\0');
    const colon = rest.indexOf(':');
    const end = nul < 0 ? colon : colon < 0 ? nul : Math.min(nul, colon);
    if (end < 0) continue;
    const line = Number(rest.slice(0, end));
    if (!Number.isInteger(line) || line <= 0) continue;

    if (totalMatches >= SEARCH_MAX_MATCHES) { truncated = true; break; }
    let file = byPath.get(path);
    if (!file) {
      file = { path, matches: [] };
      byPath.set(path, file);
      files.push(file);
    }
    if (file.matches.length >= SEARCH_MAX_MATCHES_PER_FILE) { truncated = true; continue; }
    // Long minified lines would bloat the payload without helping anyone read them.
    file.matches.push({ line, text: rest.slice(end + 1).replace(/\r$/, '').slice(0, 500) });
    totalMatches += 1;
  }

  return { files, totalMatches, truncated };
}
