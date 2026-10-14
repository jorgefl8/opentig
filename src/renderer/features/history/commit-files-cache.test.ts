import { afterEach, expect, it } from 'vitest';
import type { CommitFile } from '@shared/git-types';
import {
  clearCommitFilesCache, readCommitFilesCache, writeCommitFilesCache,
  COMMIT_FILES_CACHE_MAX_BYTES, COMMIT_FILES_CACHE_MAX_ENTRY_BYTES,
} from './commit-files-cache';

afterEach(clearCommitFilesCache);
const files = (count: number): CommitFile[] => Array.from({ length: count }, (_, index) => ({
  path: `src/${index}/${'a'.repeat(80)}.ts`, oldPath: null, kind: 'modified', additions: 1, deletions: 0, binary: false,
}));

it('keeps empty results and promotes recent reads before evicting by count', () => {
  for (let i = 0; i < 100; i++) writeCommitFilesCache(`repo:${i}`, []);
  expect(readCommitFilesCache('repo:0')).toEqual([]);
  writeCommitFilesCache('repo:100', []);
  expect(readCommitFilesCache('repo:0')).toEqual([]);
  expect(readCommitFilesCache('repo:1')).toBeUndefined();
});

it('evicts by retained size before reaching the entry limit', () => {
  // Distinct strings/arrays model browsing many file-heavy commits.
  for (let i = 0; i < 100; i++) writeCommitFilesCache(`repo:${i}`, files(1000));
  const retained = Array.from({ length: 100 }, (_, i) => readCommitFilesCache(`repo:${i}`)).filter(Boolean);
  expect(retained.length).toBeGreaterThan(1);
  expect(retained.length).toBeLessThan(100);
  // Text alone is a lower bound independent of the estimator's object constants.
  const textBytes = retained.flatMap(entry => entry!).reduce((sum, file) => sum + file.path.length * 2, 0);
  expect(textBytes).toBeLessThan(COMMIT_FILES_CACHE_MAX_BYTES);
  expect(readCommitFilesCache('repo:0')).toBeUndefined();
  expect(readCommitFilesCache('repo:99')).toHaveLength(1000);
});

it('does not cache oversized results or retain an older value under the same key', () => {
  const small = files(1);
  writeCommitFilesCache('repo:small', small);
  writeCommitFilesCache('repo:large', small);
  const large = files(10_000);
  expect(large.reduce((sum, file) => sum + file.path.length * 2, 0)).toBeGreaterThan(COMMIT_FILES_CACHE_MAX_ENTRY_BYTES);
  writeCommitFilesCache('repo:large', large);
  expect(readCommitFilesCache('repo:large')).toBeUndefined();
  expect(readCommitFilesCache('repo:small')).toBe(small);
  expect(large).toHaveLength(10_000); // The caller can still display the full response.
});

it('releases cached repository results on clear and accepts new results afterwards', () => {
  writeCommitFilesCache('first:oid', files(1000));
  writeCommitFilesCache('second:oid', files(1000));
  clearCommitFilesCache();
  expect(readCommitFilesCache('first:oid')).toBeUndefined();
  expect(readCommitFilesCache('second:oid')).toBeUndefined();
  writeCommitFilesCache('third:oid', []);
  expect(readCommitFilesCache('third:oid')).toEqual([]);
});
