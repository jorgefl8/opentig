import { opendir } from 'node:fs/promises';
import path from 'node:path';

/** Entries read at most before giving up, which then counts as holding files. */
const ENTRY_LIMIT = 2_000;

/**
 * Whether a worktree's folder holds nothing but its `.git` file and empty folders,
 * so deleting it would lose no work. Never follows a link or junction: one counts as
 * content. Stops at the first file, and answers no past `limit` entries or on any error.
 */
export async function holdsOnlyGitFile(folder: string, limit = ENTRY_LIMIT): Promise<boolean> {
  let budget = limit;
  const pending = [folder];
  try {
    for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
      for await (const entry of await opendir(directory)) {
        if (--budget < 0) return false;
        if (directory === folder && entry.name === '.git' && entry.isFile()) continue;
        if (!entry.isDirectory()) return false;
        pending.push(path.join(directory, entry.name));
      }
    }
    return true;
  } catch {
    return false;
  }
}
