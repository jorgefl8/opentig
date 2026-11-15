import { expect, it } from 'vitest';
import type { FileChange, RepositoryStatus } from '../../shared/git-types';
import { SectionSelections, stillShowable } from './section-memory';

const change = (path: string, staged: boolean, unstaged: boolean): FileChange => ({
  path, indexStatus: staged ? 'M' : '.', worktreeStatus: unstaged ? 'M' : '.', kind: 'modified', staged, unstaged, conflict: false, submodule: '',
});
const status = (...changes: FileChange[]) => ({ changes } as RepositoryStatus);

it('does not bring back a change that was staged, committed or discarded meanwhile', () => {
  const left = { type: 'diff', path: 'a.txt', kind: 'unstaged' } as const;
  expect(stillShowable(left, { status: status(change('a.txt', false, true)), openTabs: new Set() })).toBe(true);
  // Staged since: the unstaged side has nothing left to show.
  expect(stillShowable(left, { status: status(change('a.txt', true, false)), openTabs: new Set() })).toBe(false);
  expect(stillShowable(left, { status: status(), openTabs: new Set() })).toBe(false);
  // A file is shown again only while its tab is open.
  expect(stillShowable({ type: 'file', path: 'b.txt' }, { status: null, openTabs: new Set(['b.txt']) })).toBe(true);
  expect(stillShowable({ type: 'file', path: 'b.txt' }, { status: null, openTabs: new Set() })).toBe(false);
});

it('keeps each repository apart and forgets the oldest past its limit', () => {
  const selections = new SectionSelections(2);
  selections.remember('one', 'history', { type: 'commit', oid: 'a', subject: 'A' });
  selections.remember('two', 'history', { type: 'commit', oid: 'b', subject: 'B' });
  expect(selections.recall('one', 'history')).toMatchObject({ oid: 'a' });
  expect(selections.recall('two', 'changes')).toBeNull();
  selections.remember('three', 'history', { type: 'commit', oid: 'c', subject: 'C' });
  expect(selections.recall('one', 'history')).toBeNull();
  expect(selections.size).toBe(2);
});
