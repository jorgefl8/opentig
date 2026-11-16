import { describe, expect, it } from 'vitest';
import { relocatedId, repositoryAgreement } from './repository-agreement';

const saved = (...ids: string[]) => (id: string) => ids.includes(id);

describe('which repository a page and the server agree on', () => {
  it('opens again what the page shows when an open the server took last is one the page no longer stands by', () => {
    // The page landed on z, whose open the server refused after a move to main; or a choice queued
    // offline was answered before the start-up request that put the server back on a.
    expect(repositoryAgreement({ shownId: 'z', serverId: 'main', known: saved('z', 'main') })).toBe('reopen');
    expect(repositoryAgreement({ shownId: 'b', serverId: 'a', known: saved('a', 'b') })).toBe('reopen');
  });

  it('goes where the server put it when what the page shows is gone, as a removed worktree or a relocated repository’s old id', () => {
    expect(repositoryAgreement({ shownId: 'worktree', serverId: 'main', known: saved('main') })).toBe('follow');
    expect(repositoryAgreement({ shownId: 'old-id', serverId: 'new-id', known: saved('new-id') })).toBe('follow');
  });

  it('does nothing when they agree, when the server has not said, or when neither is known', () => {
    expect(repositoryAgreement({ shownId: 'a', serverId: 'a', known: saved('a') })).toBe('agree');
    expect(repositoryAgreement({ shownId: 'a', serverId: null, known: saved('a') })).toBe('agree');
    expect(repositoryAgreement({ shownId: null, serverId: 'gone', known: saved() })).toBe('none');
  });

  it('follows a repository through each relocation, and stops on a loop', () => {
    expect(relocatedId(new Map([['a', 'b'], ['b', 'c']]), 'a')).toBe('c');
    expect(relocatedId(new Map(), 'a')).toBe('a');
    expect(['a', 'b']).toContain(relocatedId(new Map([['a', 'b'], ['b', 'a']]), 'a'));
  });
});
