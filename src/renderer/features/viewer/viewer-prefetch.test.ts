import { afterEach, expect, it, vi } from 'vitest';
import type { DiffResult, FileResult } from '@shared/contracts';
import type { CommitFile } from '@shared/git-types';

const api = vi.hoisted(() => ({ files: vi.fn(), readFile: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { commits: { files: api.files }, repository: { readFile: api.readFile } } }));
// The signal a shared read hands the transport, which is what cancels it on the server.
vi.mock('@/lib/websocket-transport', () => ({
  inBackground: <T>(start: () => T) => start(),
  withSignal: <T>(signal: AbortSignal, start: () => T) => { api.signals.push(signal); return start(); },
}));

import { clearCommitFilesCache } from '@/features/history/commit-files-cache';
import { commitFiles, dropFilesAhead, immutableDiff, prefetchCommitFiles, prefetchFile, takeFileAhead } from './viewer-prefetch';

const diff = (patch: string): DiffResult => ({ path: 'commit', patch, binary: false, truncated: false, lineCount: 1 });
const file = (content: string) => ({ path: 'notes.txt', content }) as FileResult;
const listed = (path: string): CommitFile[] => [{ path, oldPath: null, kind: 'modified', additions: 1, deletions: 0, binary: false }];
let unique = 0;
const key = () => `repo:commit-file:${++unique}`;

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); api.signals.length = 0; clearCommitFilesCache(); });

it('lets the click on a commit being read ahead join that read, and opens it from memory afterwards', async () => {
  let answer!: (value: CommitFile[]) => void;
  api.files.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  prefetchCommitFiles('repo', 'abc');
  const clicked = commitFiles('repo', 'abc', new AbortController().signal);
  answer(listed('src/app.js'));
  expect((await clicked)[0]!.path).toBe('src/app.js');
  expect((await commitFiles('repo', 'abc'))[0]!.path).toBe('src/app.js');
  expect(api.files).toHaveBeenCalledExactlyOnceWith('repo', 'abc');
});

it('reads a commit again after a failed read ahead, and keeps each repository’s commits apart', async () => {
  api.files.mockRejectedValueOnce(new Error('connection lost'));
  prefetchCommitFiles('repo', 'abc');
  await vi.waitFor(() => expect(api.files).toHaveBeenCalledOnce());
  await Promise.resolve();
  // The failure was not the user's: opening the commit reads it and reports whatever happens then.
  api.files.mockResolvedValue(listed('read on click'));
  expect((await commitFiles('repo', 'abc'))[0]!.path).toBe('read on click');
  api.files.mockResolvedValue(listed('other repository'));
  expect((await commitFiles('other', 'abc'))[0]!.path).toBe('other repository');
  expect((await commitFiles('repo', 'abc'))[0]!.path).toBe('read on click');
  expect(api.files).toHaveBeenCalledTimes(3);
});

it('reads ahead at most two commits at a time, so a click never waits behind rows the pointer only passed over', async () => {
  const answers: Array<(value: CommitFile[]) => void> = [];
  api.files.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
  for (const oid of ['a1', 'b2', 'c3', 'd4']) prefetchCommitFiles('repo', oid);
  expect(api.files).toHaveBeenCalledTimes(2);
  answers[0]!(listed('a1'));
  await vi.waitFor(() => { prefetchCommitFiles('repo', 'e5'); expect(api.files).toHaveBeenCalledTimes(3); });
});

it('cancels a shared read only once everyone waiting for it has given up', async () => {
  const read = vi.fn(() => new Promise<DiffResult>(() => {}));
  const shared = key();
  const first = new AbortController();
  const second = new AbortController();
  const firstRead = immutableDiff(shared, read, first.signal);
  const secondRead = immutableDiff(shared, read, second.signal);
  expect(read).toHaveBeenCalledOnce();
  first.abort();
  await expect(firstRead).rejects.toThrow('cancelled');
  // The other caller still wants it, so it keeps going.
  expect(api.signals[0]!.aborted).toBe(false);
  second.abort();
  await expect(secondRead).rejects.toThrow('cancelled');
  expect(api.signals[0]!.aborted).toBe(true);
  // A read that was called off is not joined by the next caller.
  const again = vi.fn(async () => diff('+again'));
  expect((await immutableDiff(shared, again)).patch).toBe('+again');
});

it('hands a file read ahead to one click within ten seconds, and never to a later one', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  api.readFile.mockImplementation(async () => file('read ahead'));
  prefetchFile('repo', 'notes.txt');
  // Resting on the same row again does not read it twice.
  prefetchFile('repo', 'notes.txt');
  expect(api.readFile).toHaveBeenCalledExactlyOnceWith('repo', 'notes.txt', false);
  expect((await takeFileAhead('repo', 'notes.txt')?.read)?.content).toBe('read ahead');
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

it('forgets a file read ahead when the working tree changes before the click', async () => {
  api.readFile.mockImplementation(async () => file('before the change'));
  prefetchFile('repo', 'notes.txt');
  prefetchFile('other', 'notes.txt');
  dropFilesAhead('repo');
  expect(takeFileAhead('repo', 'notes.txt')).toBeNull();
  expect((await takeFileAhead('other', 'notes.txt')?.read)?.content).toBe('before the change');
});
