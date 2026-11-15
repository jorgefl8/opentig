import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RepositorySnapshot } from '../../shared/contracts';
import { writeFileAtomically } from './atomicWrite';

export type RepositorySnapshotPart = 'status' | 'branches' | 'worktrees' | 'files';

export const REPOSITORY_SNAPSHOT_LIMITS = {
  /** Repositories with a saved snapshot; the least recently read go first. */
  repositories: 12,
  /** One repository's file as written, in bytes. A file tree that would not fit is left out of it. */
  fileBytes: 4 * 1024 * 1024,
  /** A part read longer ago than this is not painted; without its status, nothing is. */
  maxAgeMs: 30 * 24 * 60 * 60_000,
  /** A burst of reads writes the file once. */
  writeDelayMs: 2_000,
} as const;

/** Bumped whenever what a snapshot holds changes shape: a file of another format is discarded. */
const FORMAT = 2;

const fileSchema = z.object({
  format: z.literal(FORMAT),
  repositoryId: z.string().max(64),
  path: z.string().max(4096),
  /** SHA-256 of `parts` as written: a file changed or cut short outside OpenTig is not trusted. */
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  parts: z.string(),
});
/** Each part with when it was read: one not read again keeps its own date. */
const dated = <T extends z.ZodTypeAny>(value: T) => z.object({ readAt: z.number().finite(), value }).nullable();
const partsSchema = z.object({
  status: dated(z.record(z.string(), z.unknown())),
  branches: dated(z.array(z.unknown())),
  worktrees: dated(z.array(z.unknown())),
  files: dated(z.array(z.unknown())),
});
type Parts = z.infer<typeof partsSchema>;
type DatedPart = { readAt: number; value: unknown };

interface Pending {
  path: string;
  parts: Partial<Record<RepositorySnapshotPart, DatedPart>>;
  timer: NodeJS.Timeout | null;
}

/** Repository ids are hexadecimal; anything else could name a path, and is never written. */
const REPOSITORY_ID = /^[0-9a-f]{8,64}$/;

function fileName(repositoryId: string): string {
  return `${repositoryId}.json`;
}

/**
 * The last status, branches, worktrees and file tree read for each repository,
 * written to the server's data folder so a client starting up paints them at
 * once. What is painted from here is never treated as current: the client reads
 * the repository again and holds every change until that read lands.
 */
export class RepositorySnapshotStore {
  private readonly pending = new Map<string, Pending>();
  private writing: Promise<void> = Promise.resolve();
  private pruned = false;
  private tidying: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly directory: string, private readonly isKnown: (repositoryId: string) => boolean, private readonly now: () => number = Date.now) {}

  /** Remembers what was just read for `repositoryId`, which lives at `repositoryPath`. Written shortly after. */
  record(repositoryId: string, repositoryPath: string, part: RepositorySnapshotPart, value: unknown): void {
    if (this.closed || !REPOSITORY_ID.test(repositoryId)) return;
    let entry = this.pending.get(repositoryId);
    if (!entry || entry.path !== repositoryPath) {
      if (entry?.timer) clearTimeout(entry.timer);
      entry = { path: repositoryPath, parts: {}, timer: null };
      this.pending.set(repositoryId, entry);
    }
    entry.parts[part] = { readAt: this.now(), value };
    if (entry.timer) return;
    entry.timer = setTimeout(() => { entry.timer = null; this.write(repositoryId); }, REPOSITORY_SNAPSHOT_LIMITS.writeDelayMs);
    entry.timer.unref?.();
  }

  /**
   * The saved snapshot of `repositoryId`, only if it was saved for the folder it is
   * at now, is recent enough and was written by this format. Anything else is
   * deleted and null returned.
   */
  async get(repositoryId: string, repositoryPath: string): Promise<RepositorySnapshot | null> {
    if (!REPOSITORY_ID.test(repositoryId)) return null;
    await this.tidy();
    await this.writing;
    const parts = await this.read(repositoryId, repositoryPath);
    if (!parts?.status) return null;
    const date = (part: DatedPart | null) => part ? new Date(part.readAt).toISOString() : null;
    return {
      savedAt: date(parts.status)!,
      readAt: { status: date(parts.status)!, branches: date(parts.branches), worktrees: date(parts.worktrees), files: date(parts.files) },
      status: parts.status.value,
      branches: parts.branches?.value ?? null,
      worktrees: parts.worktrees?.value ?? null,
      files: parts.files?.value ?? null,
    } as unknown as RepositorySnapshot;
  }

  /** The saved parts, each dropped once older than the limit; null when the file is missing or not trusted, which is then deleted. */
  private async read(repositoryId: string, repositoryPath: string): Promise<Parts | null> {
    const file = path.join(this.directory, fileName(repositoryId));
    try {
      if ((await stat(file)).size > REPOSITORY_SNAPSHOT_LIMITS.fileBytes) throw new Error('Too large');
      const saved = fileSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (createHash('sha256').update(saved.parts).digest('hex') !== saved.checksum) throw new Error('Checksum');
      if (saved.repositoryId !== repositoryId || saved.path !== repositoryPath) throw new Error('Another repository');
      const parts = partsSchema.parse(JSON.parse(saved.parts));
      const current = <T extends DatedPart | null>(part: T): T | null => part && this.now() - part.readAt <= REPOSITORY_SNAPSHOT_LIMITS.maxAgeMs ? part : null;
      return { status: current(parts.status), branches: current(parts.branches), worktrees: current(parts.worktrees), files: current(parts.files) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await rm(file, { force: true }).catch(() => undefined);
      return null;
    }
  }

  /**
   * Once per run: the folder is made private to the server's user if it was found looser, and
   * what a write cut short left behind is removed.
   */
  private tidy(): Promise<void> {
    this.tidying ??= (async () => {
      const info = await stat(this.directory).catch(() => null);
      if (!info) return;
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) await chmod(this.directory, 0o700).catch(() => undefined);
      for (const name of await readdir(this.directory).catch(() => [] as string[])) {
        if (name.endsWith('.tmp')) await rm(path.join(this.directory, name), { force: true }).catch(() => undefined);
      }
    })();
    return this.tidying;
  }

  /** Deletes the snapshots of repositories OpenTig no longer knows, such as one just forgotten. */
  forgetUnknown(): void {
    for (const [repositoryId, entry] of this.pending) {
      if (this.isKnown(repositoryId)) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(repositoryId);
    }
    this.writing = this.writing.then(() => this.prune()).catch(() => undefined);
  }

  /** Writes what is pending now. */
  async flush(): Promise<void> {
    for (const [repositoryId, entry] of this.pending) {
      if (!entry.timer) continue;
      clearTimeout(entry.timer);
      entry.timer = null;
      this.write(repositoryId);
    }
    await this.writing;
  }

  /** Writes what is pending, for a server shutting down; nothing read later is saved. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }

  private write(repositoryId: string): void {
    const entry = this.pending.get(repositoryId);
    if (!entry || this.closed) return;
    const prune = !this.pruned;
    this.pruned = true;
    this.writing = this.writing.then(async () => {
      await this.tidy();
      if (prune) await this.prune();
      const file = path.join(this.directory, fileName(repositoryId));
      // Parts not read since the server started keep what the file already has, with the date they were read.
      const previous = await this.read(repositoryId, entry.path);
      const parts = {
        status: entry.parts.status ?? previous?.status ?? null,
        branches: entry.parts.branches ?? previous?.branches ?? null,
        worktrees: entry.parts.worktrees ?? previous?.worktrees ?? null,
        files: entry.parts.files ?? previous?.files ?? null,
      };
      const contents = (written: typeof parts) => {
        const text = JSON.stringify(written);
        return JSON.stringify({ format: FORMAT, repositoryId, path: entry.path, checksum: createHash('sha256').update(text).digest('hex'), parts: text });
      };
      // Measured as written, in bytes, as reading measures it. A file tree that does not fit is left out rather than the rest.
      let written = contents(parts);
      if (Buffer.byteLength(written) > REPOSITORY_SNAPSHOT_LIMITS.fileBytes) written = contents({ ...parts, files: null });
      if (Buffer.byteLength(written) > REPOSITORY_SNAPSHOT_LIMITS.fileBytes) return;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.tidy();
      await writeFileAtomically(file, written);
      await this.enforceBound();
    }).catch(() => undefined);
  }

  /** Removes snapshots of repositories that are no longer known, and anything else in the folder. */
  private async prune(): Promise<void> {
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      const repositoryId = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
      if (!REPOSITORY_ID.test(repositoryId) || !this.isKnown(repositoryId)) await rm(path.join(this.directory, name), { force: true, recursive: true }).catch(() => undefined);
    }
  }

  /** Keeps the most recently written snapshots, and deletes the others. */
  private async enforceBound(): Promise<void> {
    const names = (await readdir(this.directory).catch(() => [] as string[])).filter((name) => name.endsWith('.json'));
    if (names.length <= REPOSITORY_SNAPSHOT_LIMITS.repositories) return;
    const dated = await Promise.all(names.map(async (name) => ({ name, at: (await stat(path.join(this.directory, name)).catch(() => null))?.mtimeMs ?? 0 })));
    dated.sort((a, b) => b.at - a.at);
    for (const { name } of dated.slice(REPOSITORY_SNAPSHOT_LIMITS.repositories)) await rm(path.join(this.directory, name), { force: true }).catch(() => undefined);
  }
}
