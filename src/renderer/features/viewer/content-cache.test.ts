import { afterEach, expect, it } from 'vitest';
import type { DiffResult, FileResult } from '@shared/contracts';
import { changeGeneration, clearContentCache, keepDiff, keepFile, keptDiff, keptFile, noteChange, RACY_MARGIN_MS, setWatching } from './content-cache';

const modified = 1_700_000_000_000;
const read = (content: string, readAtMs: number): FileResult => ({ path: 'notes.txt', content, binary: false, tooLarge: false, size: content.length, mtimeMs: modified, readAtMs, watched: true });
const diff = (patch: string): DiffResult => ({ path: 'notes.txt', patch, binary: false, truncated: false, lineCount: 1, watched: true });

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

it('opens a change again only while nothing has changed since it was read, and nothing at all without the watcher', () => {
  const before = changeGeneration();
  keepDiff('repo', 'unstaged', 'notes.txt', diff('+one'), before);
  expect(keptDiff('repo', 'unstaged', 'notes.txt')?.patch).toBe('+one');
  expect(keptDiff('repo', 'staged', 'notes.txt')).toBeNull();
  noteChange();
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
  // A read that started before a change and came back after it is already out of date.
  keepDiff('repo', 'unstaged', 'notes.txt', diff('+two'), before);
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();

  keepDiff('repo', 'unstaged', 'notes.txt', diff('+three'), changeGeneration());
  keepFile('repo', read('settled', modified + RACY_MARGIN_MS), changeGeneration());
  setWatching(false);
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
  expect(keptFile('repo', 'notes.txt', { size: 7, mtimeMs: modified })).toBeNull();
});

it('reads again on every open a file or change in a folder the server does not watch', () => {
  keepFile('repo', { ...read('ignored folder', modified + RACY_MARGIN_MS), watched: false }, changeGeneration());
  keepDiff('repo', 'unstaged', 'notes.txt', { ...diff('+unwatched'), watched: false }, changeGeneration());
  expect(keptFile('repo', 'notes.txt', null)).toBeNull();
  expect(keptDiff('repo', 'unstaged', 'notes.txt')).toBeNull();
});
