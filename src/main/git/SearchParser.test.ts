import { describe, expect, it } from 'vitest';
import { parseSearchOutput } from './SearchParser';
import { SEARCH_MAX_MATCHES_PER_FILE } from '../../shared/search';

describe('parseSearchOutput', () => {
  it('groups matches by file and keeps line numbers', () => {
    const output = [
      'src/app.ts\x0012:const value = 1;',
      'src/app.ts\x0018:  return value;',
      'README.md\x003:# value',
    ].join('\n');
    expect(parseSearchOutput(output)).toEqual({
      files: [
        { path: 'src/app.ts', matches: [{ line: 12, text: 'const value = 1;' }, { line: 18, text: '  return value;' }] },
        { path: 'README.md', matches: [{ line: 3, text: '# value' }] },
      ],
      totalMatches: 3,
      truncated: false,
    });
  });

  it('keeps colons that belong to the path and to the matched text', () => {
    const result = parseSearchOutput('weird:name.ts\x007:url: https://example.com');
    expect(result.files[0]).toEqual({ path: 'weird:name.ts', matches: [{ line: 7, text: 'url: https://example.com' }] });
  });

  it('reads the NUL-separated line numbers Git emits with -z', () => {
    const result = parseSearchOutput('src/main.ts\x0010\x00import { SearchService } from \'./SearchService\';\r');
    expect(result.files[0]).toEqual({
      path: 'src/main.ts',
      matches: [{ line: 10, text: "import { SearchService } from './SearchService';" }],
    });
  });

  it('ignores rows without a separator or a usable line number', () => {
    expect(parseSearchOutput('no separator here\nsrc/a.ts\x00x:text\n').files).toEqual([]);
  });

  it('caps the matches reported for a single file', () => {
    const rows = Array.from({ length: SEARCH_MAX_MATCHES_PER_FILE + 5 }, (_, index) => `src/a.ts\x00${index + 1}:hit`);
    const result = parseSearchOutput(rows.join('\n'));
    expect(result.files[0]?.matches).toHaveLength(SEARCH_MAX_MATCHES_PER_FILE);
    expect(result.totalMatches).toBe(SEARCH_MAX_MATCHES_PER_FILE);
    expect(result.truncated).toBe(true);
  });

  it('truncates the matched text of very long lines', () => {
    const result = parseSearchOutput(`src/a.ts\x001:${'x'.repeat(900)}`);
    expect(result.files[0]?.matches[0]?.text).toHaveLength(500);
  });
});
