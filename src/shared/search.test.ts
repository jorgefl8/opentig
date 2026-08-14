import { describe, expect, it } from 'vitest';
import { buildSearchRegex } from './search';

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
