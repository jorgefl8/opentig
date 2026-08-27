import type { CommitFile } from '../../../shared/git-types';

const commitFilesCache = new Map<string, CommitFile[]>();

export function readCommitFilesCache(key: string): CommitFile[] | undefined {
  return commitFilesCache.get(key);
}

export function writeCommitFilesCache(key: string, files: CommitFile[]): void {
  commitFilesCache.set(key, files);
  while (commitFilesCache.size > 100) commitFilesCache.delete(commitFilesCache.keys().next().value as string);
}

export function clearCommitFilesCache(): void {
  commitFilesCache.clear();
}
