import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
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
 * file system proves counts: anything it can't tell, such as a folder that can't be read, a
 * drive that isn't connected, or a file system without inode numbers, is `none` and handled
 * as before.
 */
export type WorktreeLink =
  /** Its `.git` file leads to this repository's record of it. */
  | { state: 'linked'; admin: string }
  /** This repository's record names this `.git`, which provably doesn't lead back to it. */
  | { state: 'broken'; record: WorktreeRecord; link: BrokenWorktreeLink }
  | { state: 'none' };

export interface WorktreeLinkContext {
  commonDir: string;
  /** Whether two paths name the same place once resolved; false when either can't be resolved. */
  samePath(left: string, right: string): Promise<boolean>;
  /** Only where the file system gives no inode numbers: whether `admin` is this record pointing back, by path. */
  linkedByPath(admin: string): Promise<boolean>;
}

export async function readWorktreeRecords(commonDir: string): Promise<WorktreeRecords> {
  const root = path.join(commonDir, 'worktrees');
  const byGitFile = new Map<string, WorktreeRecord | null>();
  const ids = await readdir(root).catch(() => [] as string[]);
  await Promise.all(ids.map(async (id) => {
    // One record that can't be read is left out; it never stops the others.
    try {
      const dir = path.join(root, id);
      const written = (await readFile(path.join(dir, 'gitdir'), 'utf8')).trim();
      const gitFile = await resolveFrom(dir, written);
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

export async function worktreeLink(worktreePath: string, records: WorktreeRecords, context: WorktreeLinkContext): Promise<WorktreeLink> {
  try {
    return await classify(worktreePath, records, context);
  } catch {
    return { state: 'none' };
  }
}

async function classify(worktreePath: string, records: WorktreeRecords, context: WorktreeLinkContext): Promise<WorktreeLink> {
  const gitPath = path.join(worktreePath, '.git');
  const git = await lstat(gitPath, { bigint: true }).catch(() => null);
  if (!git) return { state: 'none' };
  const gitKey = identity(git);
  const candidate = gitKey ? records.byGitFile.get(gitKey) ?? null : null;
  // The same identity and the same path, both: an identifier that isn't unique on this file
  // system must never pick another worktree's record.
  if (candidate && !await context.samePath(candidate.gitFile, gitPath)) return { state: 'none' };
  const record = candidate;
  // A linked worktree has a `.git` file; a folder there is a repository of its own.
  if (git.isDirectory()) return record ? { state: 'broken', record, link: { kind: 'taken', by: 'repository', owner: gitPath } } : { state: 'none' };
  if (!git.isFile()) return { state: 'none' };

  const pointer = parseGitFile(await readFile(gitPath, 'utf8'));
  if (pointer === null) return record ? { state: 'broken', record, link: { kind: 'unlinked', pointsTo: null } } : { state: 'none' };
  const admin = await resolveFrom(worktreePath, pointer);
  const target = await stat(admin, { bigint: true }).then(
    (value): BigIntStats | 'missing' | 'unknown' => value,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'missing' : 'unknown',
  );
  if (!record) {
    return gitKey === null && typeof target === 'object' && await context.linkedByPath(admin).catch(() => false)
      ? { state: 'linked', admin } : { state: 'none' };
  }
  if (target === 'unknown') return { state: 'none' };
  if (target === 'missing') {
    // A drive or share that isn't connected says "not found" too, which proves nothing.
    const volume = volumeOf(admin);
    if (volume !== null && !await exists(volume)) return { state: 'none' };
    const otherDrive = volume !== volumeOf(context.commonDir);
    return { state: 'broken', record, link: { kind: 'unlinked', pointsTo: pointer, ...(otherDrive ? { otherDrive } : {}) } };
  }
  const targetKey = identity(target);
  if (targetKey === null || record.identity === null) return { state: 'none' };
  const sameRecord = await context.samePath(admin, record.dir);
  if (targetKey === record.identity && sameRecord) return { state: 'linked', admin };
  if (targetKey === record.identity || sameRecord) return { state: 'none' };
  // It leads to a place that exists and provably isn't this record. Whatever that place is,
  // another repository's record or store, a submodule's, or no Git folder at all, the folder
  // isn't this repository's to point back here.
  return { state: 'broken', record, link: { kind: 'taken', ...await ownerOf(admin, context) } };
}

/** The folder a `.git` file names, read as Git reads it: `gitdir: ` at its very start, then one line. */
export function parseGitFile(content: string): string | null {
  if (!content.startsWith('gitdir: ')) return null;
  const value = content.slice('gitdir: '.length).replace(/[\r\n]+$/, '');
  return value && !/[\r\n]/.test(value) ? value : null;
}

/**
 * Where a path written in a `.git` or `gitdir` file leads from the folder holding it. The
 * system resolves it: on Linux and macOS `..` steps out of the folder's real location, so a
 * link in the path leads where the link points; Windows steps back by name.
 */
async function resolveFrom(folder: string, written: string): Promise<string> {
  if (path.isAbsolute(written)) return path.resolve(written);
  return path.resolve(await realBase(folder), written);
}

async function realBase(folder: string): Promise<string> {
  return process.platform === 'win32' ? path.resolve(folder) : realpath(folder);
}

async function ownerOf(admin: string, context: WorktreeLinkContext): Promise<{ by: 'worktree' | 'repository' | 'other'; owner: string }> {
  if (!await exists(path.join(admin, 'HEAD'))) return { by: 'other', owner: admin };
  const written = await readFile(path.join(admin, 'commondir'), 'utf8').catch(() => null);
  if (written === null) return { by: 'repository', owner: admin };
  const common = await resolveFrom(admin, written.trim());
  // Another record of this same repository is no other repository's.
  return await context.samePath(common, context.commonDir) ? { by: 'other', owner: admin } : { by: 'worktree', owner: common };
}

/**
 * The folder a drive, a share or a removable volume is reached through, or null where the
 * path shows none: a Windows drive or share root, or the folder under `/Volumes`, `/media`,
 * `/run/media` or `/mnt` (with the user's folder under the media ones). When it is missing,
 * the volume is not connected, not proof that anything moved.
 */
export function volumeOf(target: string): string | null {
  if (process.platform === 'win32') return path.win32.parse(path.win32.resolve(target)).root.toLowerCase() || null;
  const parts = path.posix.resolve(target).split('/').filter(Boolean);
  for (const base of [['Volumes'], ['run', 'media'], ['media'], ['mnt']]) {
    if (!base.every((part, index) => parts[index] === part)) continue;
    const depth = base.length + (base.at(-1) === 'media' ? 2 : 1);
    return parts.length >= depth ? `/${parts.slice(0, depth).join('/')}` : null;
  }
  return null;
}

/** What became of a `.git` file a repair could not write. */
export class GitFileWriteError extends Error {
  /** `damaged`: the file now holds `now`, neither what it held nor what was written. */
  constructor(readonly state: 'unchanged' | 'damaged', error: unknown, readonly now?: string) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'GitFileWriteError';
  }
}

/**
 * Points one worktree's `.git` file at this repository's record of it, as Git's own repair
 * would for that worktree alone: relative when the record is, with forward slashes. On Linux
 * and macOS a new file replaces it in one step. On Windows the file is rewritten in place:
 * it is never removed, and keeps its attributes, such as hidden, which a replacement would lose.
 * A failure says whether the file is unchanged or now holds something else.
 */
export async function writeGitFile(worktreePath: string, record: WorktreeRecord): Promise<void> {
  const gitPath = path.join(worktreePath, '.git');
  const target = (record.relative ? path.relative(await realBase(worktreePath), await realBase(record.dir)) : record.dir).replace(/\\/g, '/');
  const content = Buffer.from(`gitdir: ${target}\n`);
  if (process.platform !== 'win32') {
    const temporary = path.join(worktreePath, `.git.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { flag: 'wx' });
      await rename(temporary, gitPath);
    } catch (error) {
      throw new GitFileWriteError('unchanged', error);
    } finally {
      await rm(temporary, { force: true });
    }
    return;
  }
  const original = await readFile(gitPath).catch((error: unknown) => { throw new GitFileWriteError('unchanged', error); });
  // Opening an existing file to update it works on a hidden one, where creating it again would not.
  const handle = await open(gitPath, 'r+').catch((error: unknown) => { throw new GitFileWriteError('unchanged', error); });
  try {
    await handle.write(content, 0, content.length, 0);
    await handle.truncate(content.length);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    const now = await readFile(gitPath).catch(() => null);
    if (now !== null && now.equals(original)) throw new GitFileWriteError('unchanged', error);
    if (now !== null && now.equals(content)) return;
    throw new GitFileWriteError('damaged', error, now?.toString('utf8'));
  }
  await handle.close();
}

/**
 * Whether the worktree's record holds work beyond its HEAD and index, from the record alone:
 * a merge, rebase, cherry-pick, revert, sequence of them or bisect under way, or refs of its
 * own under `refs/worktree` or `refs/bisect`. Null when it can't be told.
 */
export async function recordHoldsWork(recordDir: string): Promise<boolean | null> {
  const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply', 'sequencer'];
  const found = await Promise.all([
    ...markers.map((name) => lstat(path.join(recordDir, name)).then(
      () => true,
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? false : null,
    )),
    holdsFiles(path.join(recordDir, 'refs', 'worktree')),
    holdsFiles(path.join(recordDir, 'refs', 'bisect')),
  ]);
  return found.includes(true) ? true : found.includes(null) ? null : false;
}

/** Whether a folder holds any file, at any depth; false when it doesn't exist, null when it can't be read or is too large to read. */
async function holdsFiles(folder: string, limit = 2_000): Promise<boolean | null> {
  let budget = limit;
  const pending = [folder];
  try {
    for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
      const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (directory === folder && error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        if (--budget < 0) return null;
        if (!entry.isDirectory()) return true;
        pending.push(path.join(directory, entry.name));
      }
    }
    return false;
  } catch {
    return null;
  }
}

async function exists(target: string): Promise<boolean> {
  return lstat(target).then(() => true, () => false);
}

/** Device and inode, exact as big integers; null where the file system reports no inode. */
function identity(value: BigIntStats): string | null {
  return value.ino === 0n ? null : `${value.dev}:${value.ino}`;
}
