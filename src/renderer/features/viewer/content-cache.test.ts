import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DiffResult, FileResult } from '@shared/contracts';
import { changeGeneration, clearContentCache, confirmWatch, doubtWatch, keepDiff, keepFile, keptDiff, keptFile, noteChange, RACY_MARGIN_MS } from './content-cache';

const modified = 1_700_000_000_000;
const read = (content: string, readAtMs: number, watchId = 'watch-1'): FileResult => ({ path: 'notes.txt', content, binary: false, tooLarge: false, size: content.length, mtimeMs: modified, readAtMs, watchId });
const diff = (patch: string, watchId = 'watch-1'): DiffResult => ({ path: 'notes.txt', patch, binary: false, truncated: false, lineCount: 1, watchId });

beforeEach(() => confirmWatch('repo', 'watch-1'));
afterEach(clearContentCache);

it('opens a file again from memory until something changes, then only while the tree still gives it the same size and time', () => {
  keepFile('repo', read('settled', modified + RACY_MARGIN_MS), changeGeneration());
  expect(keptFile('repo', 'notes.txt', null)?.content).toBe('settled');
  noteChange();
  // Something changed: without a current tree there is no telling whether it was this file.
  expect(keptFile('repo', 'notes.txt', null)).toBeNull();
  expect(keptFile('repo', 'notes.txt', { size: 7, mtimeMs: modified })?.content).toBe('settled');
  expect(keptFile('repo', 'notes.txt', { size: 7, mtimeMs: modified + 1 })).toBeNull();
  expect(keptFile('repo', 'notes.txt', { size: 8, mtimeMs: modified })).toBeNull();
  expect(keptFile('other', 'notes.txt', { size: 7, mtimeMs: modified })).toBeNull();
});

it('does not trust the size and time of a file read moments after it was written, which a second write could repeat', () => {
  // Read within the timestamp granularity of the last write: the same size and time may hide new content.
  keepFile('repo', read('racy', modified + RACY_MARGIN_MS - 1), changeGeneration());
  expect(keptFile('repo', 'notes.txt', null)?.content).toBe('racy');
  noteChange();
  expect(keptFile('repo', 'notes.txt', { size: 4, mtimeMs: modified })).toBeNull();
  // An older server says nothing about when it read: the same applies.
  const { readAtMs: _unknown, ...older } = read('unknown', 0);
  keepFile('repo', older, changeGeneration());
  noteChange();
  expect(keptFile('repo', 'notes.txt', { size: 7, mtimeMs: modified })).toBeNull();
});

it('opens a change again only while nothing has changed since it was read', () => {
  const before = changeGeneration();
  keepDiff('repo', 'unstaged', 'notes.txt', diff('+one'), before);
  expect(keptDiff('repo', 'unstaged', 'notes.txt')?.patch).toBe('+one');
  expect(keptDiff('repo', 'staged', 'notes.txt')).toBeNull();
  noteChange();
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
  // A read that started before a change and came back after it is already out of date.
  keepDiff('repo', 'unstaged', 'notes.txt', diff('+two'), before);
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
});

it('serves nothing it cannot be sure about: a read no watch covers, another repository’s watch, or a watch that is not the one it was read under', () => {
  const settled = modified + RACY_MARGIN_MS;
  const unwatched = read('ignored folder', settled);
  delete unwatched.watchId;
  keepFile('repo', unwatched, changeGeneration());
  expect(keptFile('repo', 'notes.txt', null)).toBeNull();

  keepFile('repo', read('first watch', settled), changeGeneration());
  keepDiff('repo', 'unstaged', 'notes.txt', diff('+first watch'), changeGeneration());
  expect(keptFile('repo', 'notes.txt', null)?.content).toBe('first watch');
  // The server now watches another repository: this one's changes go unreported.
  confirmWatch('other', 'watch-2');
  expect(keptFile('repo', 'notes.txt', { size: 11, mtimeMs: modified })).toBeNull();
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
  // Watched again, but by a new watch: what happened in between was never reported.
  confirmWatch('repo', 'watch-3');
  expect(keptFile('repo', 'notes.txt', { size: 11, mtimeMs: modified })).toBeNull();
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
});

it('stops serving the moment the client cannot be sure it heard every change, such as a dropped connection', () => {
  keepFile('repo', read('before the drop', modified + RACY_MARGIN_MS), changeGeneration());
  keepDiff('repo', 'unstaged', 'notes.txt', diff('+before the drop'), changeGeneration());
  doubtWatch();
  expect(keptFile('repo', 'notes.txt', null)).toBeNull();
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
  // Told again that the same watch covers it: only what a tree read since then vouches for is served.
  confirmWatch('repo', 'watch-1');
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
  expect(keptFile('repo', 'notes.txt', null)).toBeNull();
  expect(keptFile('repo', 'notes.txt', { size: 15, mtimeMs: modified })?.content).toBe('before the drop');
});
