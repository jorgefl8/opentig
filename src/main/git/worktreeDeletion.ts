import { lstat, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Deletes one file or folder, recursively and without following links. */
export type RemoveEntry = (target: string) => Promise<void>;

export type WorktreeFolderDeletion =
  | { deleted: true }
  /** The folder is not a linked worktree with a `.git` file, so nothing was touched. */
  | { deleted: false; notLinked: true }
  | {
    deleted: false;
    notLinked?: false;
    /** The file or folder that could not be deleted. */
    blockedPath: string;
    error: Error;
    /** Something was, or may have been, deleted before the failure. */
    removedSomething: boolean;
    /** False when `.git` could not be put back, so Git can no longer use the worktree. */
    gitFileIntact: boolean;
  };

/**
 * Node's `rm` unlinks symbolic links and Windows junctions instead of following
 * them, and on Windows clears the read-only attribute it meets. The retries cover
 * short locks such as an antivirus or indexer scanning a file.
 */
const defaultRemove: RemoveEntry = (target) => rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });

/**
 * Deletes a linked worktree's folder, keeping its `.git` file until everything
 * else is gone. When a file can't be deleted, for example because another program
 * on Windows has it open, the worktree keeps its link to the repository, so Git
 * still lists it and removing it again can finish the job. Git's own removal
 * deletes `.git` early and drops its record even when files stay behind.
 */
export async function deleteWorktreeFolder(worktreePath: string, { remove = defaultRemove }: { remove?: RemoveEntry } = {}): Promise<WorktreeFolderDeletion> {
  const folder = path.resolve(worktreePath);
  const gitPath = path.join(folder, '.git');
  // A linked worktree is a real folder whose `.git` is a file. A main worktree's `.git`
  // is a folder, and a linked folder could lead anywhere, so neither is touched.
  const [folderStat, gitStat] = await Promise.all([lstat(folder).catch(() => null), lstat(gitPath).catch(() => null)]);
  if (!folderStat?.isDirectory() || !gitStat?.isFile()) return { deleted: false, notLinked: true };
  const gitFile = await readFile(gitPath).catch(() => null);
  if (gitFile === null || !gitFile.toString('utf8').startsWith('gitdir:')) return { deleted: false, notLinked: true };

  let entries: string[];
  try {
    entries = (await readdir(folder)).filter((name) => name !== '.git').sort();
  } catch (error) {
    return { deleted: false, blockedPath: folder, error: asError(error), removedSomething: false, gitFileIntact: true };
  }

  let removedSomething = false;
  for (const name of entries) {
    const entry = path.join(folder, name);
    const directory = await lstat(entry).then((stats) => stats.isDirectory(), () => false);
    try {
      await remove(entry);
      removedSomething = true;
    } catch (error) {
      // A folder may have lost some of its files before the one that failed.
      return { deleted: false, blockedPath: blockedPathOf(error, entry), error: asError(error), removedSomething: removedSomething || directory, gitFileIntact: true };
    }
  }

  try {
    await remove(gitPath);
    await rmdir(folder);
    return { deleted: true };
  } catch (error) {
    // Something appeared meanwhile, or the folder itself is held open. Put `.git` back
    // so the worktree stays registered and usable.
    const blockedPath = blockedPathOf(error, folder);
    return { deleted: false, blockedPath, error: asError(error), removedSomething, gitFileIntact: await restoreGitFile(gitPath, gitFile) };
  }
}

async function restoreGitFile(gitPath: string, contents: Buffer): Promise<boolean> {
  // `.git` survives when deleting it was what failed; anything else there is not ours to replace.
  const existing = await lstat(gitPath).catch(() => null);
  if (existing) return existing.isFile();
  try {
    await writeFile(gitPath, contents, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function blockedPathOf(error: unknown, fallback: string): string {
  const reported = (error as NodeJS.ErrnoException | null)?.path;
  return typeof reported === 'string' && reported ? reported : fallback;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
