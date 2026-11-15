import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DiffResult, FileResult } from '@shared/contracts';

const api = vi.hoisted(() => ({ getCommit: vi.fn(), readFile: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { diff: { getCommit: api.getCommit }, repository: { readFile: api.readFile } } }));

import { commitDiffKey, immutableDiff, prefetchCommitDiff, prefetchFile, scopeDiffCache, takeFileAhead } from './viewer-prefetch';

const diff = (patch: string): DiffResult => ({ path: 'commit', patch, binary: false, truncated: false, lineCount: 1 });
const file = (content: string) => ({ path: 'notes.txt', content }) as FileResult;

beforeEach(() => { scopeDiffCache(`repo-${Math.random()}`); scopeDiffCache('repo'); });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it('lets the click on a commit being read ahead join that read, and opens it from memory afterwards', async () => {
  let answer!: (value: DiffResult) => void;
  api.getCommit.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  prefetchCommitDiff('repo', 'abc');
  const ownRead = vi.fn();
  const clicked = immutableDiff(commitDiffKey('repo', 'abc'), ownRead);
  answer(diff('+ahead'));
  expect((await clicked).patch).toBe('+ahead');
  expect((await immutableDiff(commitDiffKey('repo', 'abc'), ownRead)).patch).toBe('+ahead');
  expect(api.getCommit).toHaveBeenCalledExactlyOnceWith('repo', 'abc');
  expect(ownRead).not.toHaveBeenCalled();
});

it('reads a commit again after a failed read ahead, and forgets what it kept for another repository', async () => {
  api.getCommit.mockRejectedValueOnce(new Error('connection lost'));
  prefetchCommitDiff('repo', 'abc');
  await vi.waitFor(() => expect(api.getCommit).toHaveBeenCalledOnce());
  await Promise.resolve();
  // The failure was not the user's: opening the commit reads it and reports whatever happens then.
  expect((await immutableDiff(commitDiffKey('repo', 'abc'), async () => diff('+read on click'))).patch).toBe('+read on click');
  scopeDiffCache('other');
  expect((await immutableDiff(commitDiffKey('repo', 'abc'), async () => diff('+read again'))).patch).toBe('+read again');
  // A row of a repository that is no longer open reads nothing.
  prefetchCommitDiff('repo', 'def');
  expect(api.getCommit).toHaveBeenCalledOnce();
});

it('hands a file read ahead to one click within ten seconds, and never to a later one', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  api.readFile.mockImplementation(async () => file('read ahead'));
  prefetchFile('repo', 'notes.txt');
  // Resting on the same row again does not read it twice.
  prefetchFile('repo', 'notes.txt');
  expect(api.readFile).toHaveBeenCalledExactlyOnceWith('repo', 'notes.txt', false);
  expect((await takeFileAhead('repo', 'notes.txt'))?.content).toBe('read ahead');
  // Taken once: a refresh of the open file must read the disk, not what was read before the click.
  expect(takeFileAhead('repo', 'notes.txt')).toBeNull();

  prefetchFile('repo', 'notes.txt');
  vi.setSystemTime(Date.now() + 10_000);
  expect(takeFileAhead('repo', 'notes.txt')).toBeNull();
  // Images and PDFs are fetched by the browser itself.
  prefetchFile('repo', 'logo.png');
  prefetchFile('repo', 'manual.pdf');
  expect(api.readFile).toHaveBeenCalledTimes(2);
});
