import { describe, expect, it } from 'vitest';
import type { CommitInfo } from '@shared/git-types';
import { commitReference, historyColor, historyRows, matchesHistory } from './history-presentation';

function commit(oid: string, parentOids: string[] = [], overrides: Partial<CommitInfo> = {}): CommitInfo {
  return { oid, parentOids, parentCount: parentOids.length, shortOid: oid, subject: oid, body: '', author: 'Jorge', email: '', date: '', decorations: [], upstreamState: 'published', isHead: false, ...overrides };
}
const merged = () => [commit('merge', ['main', 'branch']), commit('branch', ['older']), commit('older', ['base']), commit('main', ['base']), commit('base')];

describe('history presentation', () => {
  it('keeps a squash reference linear without claiming its merge method', () => {
    const squash = commit('squash', ['base'], { subject: 'feat: spaces (#87)' });
    expect(commitReference(squash)).toEqual({ number: 87, source: 'subject' });
    expect(historyRows([squash, commit('base')], true)[0]).toMatchObject({ parentOids: ['base'], grouped: [] });
    expect(commitReference(commit('merge', ['a', 'b'], { subject: 'Merge pull request #85 from team/topic' }))).toEqual({ number: 85, source: 'merge' });
    expect(commitReference(commit('fix', ['base'], { subject: 'fix issue #85 in loading' }))).toBeNull();
    expect(commitReference(commit('x', [], { subject: 'fix (#0)' }))).toBeNull();
  });
  it('groups only the side branch and leaves the original topology untouched', () => {
    const commits = merged();
    const rows = historyRows(commits, true);
    expect(rows.map((row) => row.commit.oid)).toEqual(['merge', 'main', 'base']);
    expect(rows[0]?.grouped.map((item) => item.oid)).toEqual(['branch', 'older']);
    expect(rows[0]?.parentOids).toEqual(['main']);
    expect(commits[0]?.parentOids).toEqual(['main', 'branch']);
    expect(historyRows(commits, false)).toHaveLength(5);
  });
  it('does not hide partial pages, shared branches, HEAD, or nested merges', () => {
    expect(historyRows(merged().slice(0, 4), true)).toHaveLength(4);
    expect(historyRows([commit('other', ['branch']), ...merged()], true)).toHaveLength(6);
    const withHead = merged(); withHead[1]!.isHead = true;
    expect(historyRows(withHead, true)).toHaveLength(5);
    const nested = merged(); nested[1]!.parentOids.push('side');
    expect(historyRows(nested, true)).toHaveLength(5);
  });
  it('distinguishes local, published, base, and unknown states', () => {
    expect(historyColor(commit('local', [], { baseState: 'included', upstreamState: 'local-only' }))).toBe(0);
    expect(historyColor(commit('published', [], { baseState: 'outside' }))).toBe(1);
    expect(historyColor(commit('main', [], { baseState: 'included' }))).toBe(2);
    expect(historyColor(commit('unknown', [], { upstreamState: 'unknown' }))).toBeUndefined();
  });
  it('finds commits by reference, author and hash without filtering graph rows', () => {
    const item = commit('abcdef', [], { subject: 'feat: spaces (#87)', decorations: ['origin/feature'] });
    for (const term of ['#87', 'JORGE', 'abcdef', 'origin/feature']) expect(matchesHistory(item, term)).toBe(true);
    expect(matchesHistory(item, ' ')).toBe(false);
    expect(matchesHistory(item, 'absent')).toBe(false);
  });
});
