import { describe, expect, it } from 'vitest';
import { REF_FORMAT, parseRefs } from './RefParser';

/** Builds one `for-each-ref` record exactly as `REF_FORMAT` emits it. */
function record(fields: Partial<Record<Field, string>>): string {
  return ORDER.map((field) => fields[field] ?? '').join('\0') + '\0';
}

type Field = 'refname' | 'short' | 'head' | 'upstream' | 'track' | 'worktree' | 'oid' | 'shortOid' | 'subject' | 'author' | 'date';
const ORDER: Field[] = ['refname', 'short', 'head', 'upstream', 'track', 'worktree', 'oid', 'shortOid', 'subject', 'author', 'date'];

/** Git separates records with a newline and leaves a trailing NUL at the end. */
function output(...records: string[]): Buffer {
  return Buffer.from(records.join('\n'), 'utf8');
}

describe('REF_FORMAT', () => {
  it('requests every management field exactly once, NUL delimited', () => {
    expect(REF_FORMAT.split('%00').filter(Boolean)).toEqual([
      '%(refname)', '%(refname:short)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)',
      '%(worktreepath)', '%(objectname)', '%(objectname:short)', '%(subject)', '%(authorname)', '%(committerdate:iso-strict)',
    ]);
    expect(REF_FORMAT.endsWith('%00')).toBe(true);
  });
});

describe('parseRefs', () => {
  it('parses a local branch with tip metadata', () => {
    const [branch] = parseRefs(output(record({
      refname: 'refs/heads/main', short: 'main', head: '*', oid: 'a'.repeat(40), shortOid: 'aaaaaaa',
      subject: 'Initial commit', author: 'Ada Lovelace', date: '2026-08-04T10:11:12+02:00',
    })));
    expect(branch).toEqual({
      fullName: 'refs/heads/main', name: 'main', current: true, remote: false, upstream: null,
      ahead: 0, behind: 0, worktreePath: null, oid: 'a'.repeat(40), shortOid: 'aaaaaaa',
      subject: 'Initial commit', author: 'Ada Lovelace', date: '2026-08-04T10:11:12+02:00',
    });
  });

  it('separates local and remote refs and marks only the checked-out branch', () => {
    const branches = parseRefs(output(
      record({ refname: 'refs/heads/main', short: 'main', head: '*' }),
      record({ refname: 'refs/heads/feature', short: 'feature', head: ' ' }),
      record({ refname: 'refs/remotes/origin/main', short: 'origin/main' }),
      record({ refname: 'refs/remotes/origin/HEAD', short: 'origin/HEAD' }),
    ));
    expect(branches.map((branch) => [branch.name, branch.remote, branch.current])).toEqual([
      ['main', false, true], ['feature', false, false], ['origin/main', true, false], ['origin/HEAD', true, false],
    ]);
  });

  it('reads every ahead/behind combination from the upstream track field', () => {
    const branches = parseRefs(output(
      record({ refname: 'refs/heads/ahead', short: 'ahead', upstream: 'origin/ahead', track: '[ahead 3]' }),
      record({ refname: 'refs/heads/behind', short: 'behind', upstream: 'origin/behind', track: '[behind 2]' }),
      record({ refname: 'refs/heads/both', short: 'both', upstream: 'origin/both', track: '[ahead 4, behind 5]' }),
      record({ refname: 'refs/heads/even', short: 'even', upstream: 'origin/even', track: '' }),
      record({ refname: 'refs/heads/gone', short: 'gone', upstream: 'origin/gone', track: '[gone]' }),
    ));
    expect(branches.map((branch) => [branch.name, branch.upstream, branch.ahead, branch.behind])).toEqual([
      ['ahead', 'origin/ahead', 3, 0], ['behind', 'origin/behind', 0, 2], ['both', 'origin/both', 4, 5],
      ['even', 'origin/even', 0, 0], ['gone', 'origin/gone', 0, 0],
    ]);
  });

  it('reports the worktree that occupies a branch', () => {
    const branches = parseRefs(output(
      record({ refname: 'refs/heads/main', short: 'main', head: '*', worktree: 'C:\\repos\\app' }),
      record({ refname: 'refs/heads/review', short: 'review', worktree: 'C:\\repos\\app trees\\review' }),
      record({ refname: 'refs/heads/idle', short: 'idle' }),
    ));
    expect(branches.map((branch) => branch.worktreePath)).toEqual(['C:\\repos\\app', 'C:\\repos\\app trees\\review', null]);
  });

  it('preserves Unicode and spaces in subjects and author names', () => {
    const [branch] = parseRefs(output(record({
      refname: 'refs/heads/función/ñandú', short: 'función/ñandú',
      subject: 'Añade soporte para 日本語 — con guiones', author: 'José Ángel Muñoz',
    })));
    expect(branch?.name).toBe('función/ñandú');
    expect(branch?.subject).toBe('Añade soporte para 日本語 — con guiones');
    expect(branch?.author).toBe('José Ángel Muñoz');
  });

  it('keeps empty metadata fields as empty strings rather than dropping the ref', () => {
    const [branch] = parseRefs(output(record({ refname: 'refs/heads/bare', short: 'bare' })));
    expect(branch).toMatchObject({ name: 'bare', oid: '', shortOid: '', subject: '', author: '', date: '' });
  });

  it('ignores the trailing NUL and an empty final record', () => {
    expect(parseRefs(Buffer.from('', 'utf8'))).toEqual([]);
    expect(parseRefs(Buffer.from(`${record({ refname: 'refs/heads/main', short: 'main' })}\n`, 'utf8'))).toHaveLength(1);
  });

  it('ignores a truncated trailing record instead of emitting a partial branch', () => {
    const complete = record({ refname: 'refs/heads/main', short: 'main' });
    expect(parseRefs(Buffer.from(`${complete}\nrefs/heads/partial\0partial\0`, 'utf8'))).toHaveLength(1);
  });
});
