import { describe, expect, it } from 'vitest';
import { parseBlamePorcelain } from './LineBlame';

const first = 'a'.repeat(40);
const second = 'b'.repeat(40);
const zero = '0'.repeat(40);

const porcelain = [
  `${first} 1 1 2`,
  'author Ada Lovelace',
  'author-mail <ada@example.com>',
  'author-time 1767348000',
  'author-tz +0000',
  'committer Ada Lovelace',
  'committer-mail <ada@example.com>',
  'committer-time 1767348000',
  'committer-tz +0000',
  'summary Add totals',
  'boundary',
  'filename src/totals.ts',
  '\texport function total() {',
  `${first} 2 2`,
  '\t  let sum = 0;',
  `${second} 2 3 1`,
  'author Grace Hopper',
  'author-mail <grace@example.com>',
  'author-time 1778000000',
  'author-tz -0500',
  'committer Grace Hopper',
  'committer-mail <grace@example.com>',
  'committer-time 1778000000',
  'committer-tz -0500',
  'summary Fix rounding in totals',
  `previous ${first} src/totals.ts`,
  'filename src/totals.ts',
  '\t  return Math.round(sum);',
  `${zero} 4 4 1`,
  'author External file (--contents)',
  'author-mail <external.file>',
  'author-time 1778100000',
  'author-tz +0000',
  'committer External file (--contents)',
  'committer-mail <external.file>',
  'committer-time 1778100000',
  'committer-tz +0000',
  'summary Version of src/totals.ts from standard input',
  `previous ${second} src/totals.ts`,
  'filename src/totals.ts',
  '\t}',
  '',
].join('\n');

describe('parseBlamePorcelain', () => {
  it('reads each commit once and maps every final line to it', () => {
    const { commits, lines } = parseBlamePorcelain(porcelain);
    expect(commits).toEqual([
      { oid: first, uncommitted: false, authorName: 'Ada Lovelace', authorEmail: 'ada@example.com', authoredAt: '2026-01-02T10:00:00.000Z', summary: 'Add totals' },
      { oid: second, uncommitted: false, authorName: 'Grace Hopper', authorEmail: 'grace@example.com', authoredAt: new Date(1778000000 * 1000).toISOString(), summary: 'Fix rounding in totals' },
      expect.objectContaining({ oid: zero, uncommitted: true }),
    ]);
    expect(lines).toEqual([
      { commit: 0, originalLine: 1 },
      { commit: 0, originalLine: 2 },
      { commit: 1, originalLine: 2 },
      { commit: 2, originalLine: 4 },
    ]);
  });

  it('does not mistake line content for headers', () => {
    const tricky = [`${first} 1 1 1`, 'author Ada', 'author-time 0', 'summary Add', 'filename a.txt', `\t${second} 9 9 9`, ''].join('\n');
    const { commits, lines } = parseBlamePorcelain(tricky);
    expect(commits.map((commit) => commit.oid)).toEqual([first]);
    expect(lines).toEqual([{ commit: 0, originalLine: 1 }]);
  });

  it('accepts SHA-256 object ids and an empty file', () => {
    const oid = 'c'.repeat(64);
    expect(parseBlamePorcelain(`${oid} 1 1 1\nsummary Add\n\tline\n`).commits[0]?.oid).toBe(oid);
    expect(parseBlamePorcelain('')).toEqual({ commits: [], lines: [] });
  });
});
