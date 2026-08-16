import { describe, expect, it } from 'vitest';
import { buildSearchRegex, findSearchMatches, replaceSearchMatches } from './search';

const base = { matchCase: false, wholeWord: false, regex: false };

describe('buildSearchRegex', () => {
  it('treats a plain query as literal text', () => {
    const pattern = buildSearchRegex({ ...base, query: 'a.b(' });
    expect(pattern?.test('xxa.b(yy')).toBe(true);
    expect(buildSearchRegex({ ...base, query: 'a.b' })?.test('axb')).toBe(false);
  });

  it('honours case sensitivity', () => {
    expect(buildSearchRegex({ ...base, query: 'value' })?.test('VALUE')).toBe(true);
    expect(buildSearchRegex({ ...base, matchCase: true, query: 'value' })?.test('VALUE')).toBe(false);
  });

  it('anchors whole-word searches', () => {
    const pattern = buildSearchRegex({ ...base, wholeWord: true, query: 'value' });
    expect(pattern?.test('a value here')).toBe(true);
    expect(buildSearchRegex({ ...base, wholeWord: true, query: 'value' })?.test('valuable')).toBe(false);
  });

  it('returns null for an empty query or an invalid regular expression', () => {
    expect(buildSearchRegex({ ...base, query: '' })).toBeNull();
    expect(buildSearchRegex({ ...base, regex: true, query: '(' })).toBeNull();
  });
});

describe('search replacement', () => {
  it('locates every occurrence with stable line and column coordinates', () => {
    const matches = findSearchMatches('one value value\nVALUE', { ...base, query: 'value' });
    expect(matches.map(({ line, column, text }) => ({ line, column, text }))).toEqual([
      { line: 1, column: 5, text: 'value' },
      { line: 1, column: 11, text: 'value' },
      { line: 2, column: 1, text: 'VALUE' },
    ]);
  });

  it('replaces selected occurrences without shifting later offsets', () => {
    const content = 'foo foo foo';
    const matches = findSearchMatches(content, { ...base, query: 'foo' });
    expect(replaceSearchMatches(content, [matches[0]!, matches[2]!], 'longer')).toBe('longer foo longer');
  });

  it('expands numbered, named and literal-dollar replacement tokens', () => {
    const content = 'Ada Lovelace';
    const options = { ...base, regex: true, query: '(?<first>\\w+) (\\w+)' };
    const matches = findSearchMatches(content, options);
    expect(replaceSearchMatches(content, matches, '$2, $<first> $$ $&')).toBe('Lovelace, Ada $ Ada Lovelace');
  });
});
