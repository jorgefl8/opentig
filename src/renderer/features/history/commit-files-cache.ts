import type { CommitFile } from '../../../shared/git-types';
import { ByteBudgetLru } from '@/lib/ByteBudgetLru';

export const COMMIT_FILES_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const COMMIT_FILES_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;

// Estimate retained UTF-16 text, array slots and object overhead. This bounds
// the cache, not the files currently displayed by mounted history rows.
function retainedBytes(key: string, files: CommitFile[]): number {
  return 64 + key.length * 2 + files.reduce((bytes, file) =>
    bytes + 128 + (file.path.length + (file.oldPath?.length ?? 0) + file.kind.length) * 2, 0);
}

const commitFilesCache = new ByteBudgetLru<string, { files: CommitFile[]; bytes: number }>({
  maxEntries: 100,
  maxBytes: COMMIT_FILES_CACHE_MAX_BYTES,
  sizeOf: (entry) => entry.bytes,
});

export function readCommitFilesCache(key: string): CommitFile[] | undefined {
  return commitFilesCache.get(key)?.files;
}

export function writeCommitFilesCache(key: string, files: CommitFile[]): void {
  const bytes = retainedBytes(key, files);
  if (bytes > COMMIT_FILES_CACHE_MAX_ENTRY_BYTES) {
    commitFilesCache.delete(key);
    return;
  }
  commitFilesCache.set(key, { files, bytes });
}

export function clearCommitFilesCache(): void {
  commitFilesCache.clear();
}
