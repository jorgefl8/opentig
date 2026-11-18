import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrokenWorktreeLink } from '../../shared/git-types';

/** One of the repository's records of a linked worktree, under `<common dir>/worktrees`. */
export interface WorktreeRecord {
  dir: string;
  /** The `.git` file its `gitdir` names. */
  gitFile: string;
  /** Its `gitdir` is written relative to the record, as Git does when asked for relative paths. */
  relative: boolean;
  /** Device and inode of the record folder, or null when the file system gives none. */
  identity: string | null;
}

/** Every record of a repository, read once and reused for each of its worktrees. */
export interface WorktreeRecords {
  /** By the identity of the `.git` file each one names; null where two records name the same file. */
  byGitFile: Map<string, WorktreeRecord | null>;
}

/**
 * How a linked worktree's `.git` and this repository's record of it relate. Only what the
 * file system proves counts: anything it can't tell, such as a folder that can't be read
 * or a file system without inode numbers, is `none` and handled as before.
 */
export type WorktreeLink =
  /** Its `.git` file leads to this repository's record of it. */
  | { state: 'linked'; admin: string }
  /** This repository's record names this `.git`, which provably doesn't lead back to it. */
  | { state: 'broken'; record: WorktreeRecord; link: BrokenWorktreeLink }
  | { state: 'none' };

export async function readWorktreeRecords(commonDir: string): Promise<WorktreeRecords> {
  const root = path.join(commonDir, 'worktrees');
  const byGitFile = new Map<string, WorktreeRecord | null>();
  const ids = await readdir(root).catch(() => [] as string[]);
  await Promise.all(ids.map(async (id) => {
    // One record that can't be read is left out; it never stops the others.
    try {
      const dir = path.join(root, id);
      const written = (await readFile(path.join(dir, 'gitdir'), 'utf8')).trim();
      const gitFile = path.resolve(dir, written);
      const [folder, file] = await Promise.all([stat(dir, { bigint: true }), stat(gitFile, { bigint: true }).catch(() => null)]);
      const record: WorktreeRecord = { dir, gitFile, relative: !path.isAbsolute(written), identity: identity(folder) };
      const key = file && identity(file);
      if (key) byGitFile.set(key, byGitFile.has(key) ? null : record);
    } catch {
      // Left out.
    }
  }));
  return { byGitFile };
}

/**
 * `linkedByPath` decides `linked` by comparing paths, and is asked only when the file
 * system has no inode numbers; it can never make a worktree look broken.
 */
export async function worktreeLink(worktreePath: string, records: WorktreeRecords, linkedByPath: (admin: string) => Promise<boolean>): Promise<WorktreeLink> {
  try {
    return await classify(worktreePath, records, linkedByPath);
  } catch {
    return { state: 'none' };
  }
}

async function classify(worktreePath: string, records: WorktreeRecords, linkedByPath: (admin: string) => Promise<boolean>): Promise<WorktreeLink> {
  const gitPath = path.join(worktreePath, '.git');
  const git = await lstat(gitPath, { bigint: true }).catch(() => null);
  if (!git) return { state: 'none' };
  const gitKey = identity(git);
  const record = gitKey ? records.byGitFile.get(gitKey) ?? null : null;
  // A linked worktree has a `.git` file; a folder there is a repository of its own.
  if (git.isDirectory()) return record ? { state: 'broken', record, link: { kind: 'taken', by: 'repository', owner: gitPath } } : { state: 'none' };
  if (!git.isFile()) return { state: 'none' };

  const pointer = parseGitFile(await readFile(gitPath, 'utf8'));
  const admin = pointer === null ? null : path.resolve(worktreePath, pointer);
  const target = admin === null ? null : await stat(admin, { bigint: true }).then(
    (value): BigIntStats | 'missing' | 'unknown' => value,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'missing' : 'unknown',
  );
  if (!record) {
    return gitKey === null && admin !== null && typeof target === 'object' && target !== null && await linkedByPath(admin).catch(() => false)
      ? { state: 'linked', admin } : { state: 'none' };
  }
  if (admin !== null && typeof target === 'object' && target !== null && sameIdentity(target, record.identity)) return { state: 'linked', admin };

  if (pointer === null) return { state: 'broken', record, link: { kind: 'unlinked', pointsTo: null, pointsToMissing: false } };
  if (target === 'missing') return { state: 'broken', record, link: { kind: 'unlinked', pointsTo: pointer, pointsToMissing: true } };
  if (target === 'unknown' || target === null || identity(target) === null || record.identity === null) return { state: 'none' };
  // It leads somewhere that is provably not this record. If that is another repository's
  // record pointing back here, the folder is that repository's worktree now.
  const back = await readFile(path.join(admin!, 'gitdir'), 'utf8').then((written) => stat(path.resolve(admin!, written.trim()), { bigint: true })).catch(() => null);
  if (back && sameIdentity(back, gitKey)) return { state: 'broken', record, link: { kind: 'taken', by: 'worktree', owner: await commonDirOf(admin!) } };
  return { state: 'broken', record, link: { kind: 'unlinked', pointsTo: pointer, pointsToMissing: false } };
}

/** The folder a `.git` file names, read as Git reads it: `gitdir: ` at its very start, then one line. */
export function parseGitFile(content: string): string | null {
  if (!content.startsWith('gitdir: ')) return null;
  const value = content.slice('gitdir: '.length).replace(/[\r\n]+$/, '');
  return value && !/[\r\n]/.test(value) ? value : null;
}

/**
 * Points one worktree's `.git` file at this repository's record of it, as Git's own repair
 * would for that worktree alone: relative when the record is, with forward slashes. The new
 * file replaces the old one in one step, so the folder never lacks a `.git`.
 */
export async function writeGitFile(worktreePath: string, record: WorktreeRecord): Promise<void> {
  const gitPath = path.join(worktreePath, '.git');
  const target = (record.relative ? path.relative(worktreePath, record.dir) : record.dir).replace(/\\/g, '/');
  const temporary = path.join(worktreePath, `.git.${randomUUID()}.tmp`);
  await writeFile(temporary, `gitdir: ${target}\n`, { flag: 'wx' });
  try {
    await rename(temporary, gitPath);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    // Windows can refuse to replace a hidden file, and Git for Windows hides `.git`.
    const original = await readFile(gitPath);
    await rm(gitPath, { force: true });
    try {
      await rename(temporary, gitPath);
    } catch (again) {
      await writeFile(gitPath, original);
      throw again;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Whether a merge, rebase, cherry-pick, revert or bisect is under way, from the worktree's record alone; null when unknown. */
export async function recordOperation(recordDir: string): Promise<boolean | null> {
  const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply'];
  const found = await Promise.all(markers.map((name) => lstat(path.join(recordDir, name)).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? false : null,
  )));
  return found.includes(null) ? null : found.includes(true);
}

async function commonDirOf(admin: string): Promise<string> {
  const written = await readFile(path.join(admin, 'commondir'), 'utf8').catch(() => null);
  return written === null ? path.dirname(path.dirname(admin)) : path.resolve(admin, written.trim());
}

/** Device and inode, exact as big integers; null where the file system reports no inode. */
function identity(value: BigIntStats): string | null {
  return value.ino === 0n ? null : `${value.dev}:${value.ino}`;
}

function sameIdentity(value: BigIntStats, other: string | null): boolean {
  const own = identity(value);
  return own !== null && own === other;
}
