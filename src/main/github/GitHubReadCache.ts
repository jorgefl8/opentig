import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomically } from '../persistence/atomicWrite';

/**
 * Where an answer came from: the GitHub repository and host it describes, the
 * account that read it, and the local repository that asked. An answer is only
 * ever served for the same five, so one account's answers never reach another
 * and a repository whose remote now points elsewhere does not see the old one's.
 */
export interface GitHubReadScope {
  host: string;
  nameWithOwner: string;
  login: string;
  /** The checkout (repository or worktree) that asked. */
  path: string;
  /** Git's common directory, which the account choice is saved under. */
  commonDir: string;
  /** A one-way fingerprint of the remote URL, which may carry credentials and is never written itself. */
  remote: string;
}

export interface GitHubReadEntry {
  key: string;
  scope: GitHubReadScope;
  value: unknown;
  /** When GitHub gave this answer, by the server's clock. */
  readAt: number;
  usedAt: number;
  /** Kept past the usual age limit, as a finished workflow run is; only the size bounds drop it. */
  noExpiry: boolean;
  /** Its size as JSON, which the bounds count. */
  bytes: number;
}

export const GITHUB_READ_CACHE_LIMITS = {
  /** Answers held in memory, of every repository and account. */
  entries: 600,
  memoryBytes: 32 * 1024 * 1024,
  /** What is written to disk: the most recently used answers that fit. */
  diskBytes: 8 * 1024 * 1024,
  /** A larger answer, such as a long conversation, is kept in memory only. */
  diskEntryBytes: 512 * 1024,
  /** Past this, an answer is not shown at all, not even marked as old. */
  maxAgeMs: 14 * 24 * 60 * 60_000,
  /** How long after a change the file is written, so a burst of reads writes it once. */
  writeDelayMs: 15_000,
  /** The file as written, in bytes, envelope and escaping included: a larger one is not read. */
  fileBytes: 16 * 1024 * 1024,
} as const;

/** Bumped whenever what an entry holds changes shape: a file of another format is discarded. */
const FORMAT = 1;

const scopeSchema = z.object({
  host: z.string().max(255), nameWithOwner: z.string().max(300), login: z.string().max(64),
  path: z.string().max(4096), commonDir: z.string().max(4096), remote: z.string().regex(/^[0-9a-f]{64}$/),
});
const fileSchema = z.object({
  format: z.literal(FORMAT),
  /** SHA-256 of the entries as written, so a file changed or cut short outside OpenTig is not trusted. */
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  entries: z.string(),
});
const entriesSchema = z.array(z.object({
  key: z.string().max(16 * 1024), scope: scopeSchema, value: z.unknown(),
  readAt: z.number().finite(), usedAt: z.number().finite(), noExpiry: z.boolean(),
})).max(GITHUB_READ_CACHE_LIMITS.entries);

export function remoteFingerprint(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/**
 * Answers read from GitHub, kept in this process and written to a private file
 * in the server's data folder so they outlive a restart. Only parsed answers are
 * held: never a token, a header or the output of a command. Bounded in entries,
 * memory and disk; least recently used answers go first.
 */
export class GitHubReadCache {
  /** Oldest use first, so the bounds drop from the front. */
  private readonly entries = new Map<string, GitHubReadEntry>();
  private memoryBytes = 0;
  private loading: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  private closed = false;
  private loaded = false;
  /** Drops made before the file was read, applied to what it holds as it is read. */
  private pendingDrops: Array<(entry: GitHubReadEntry) => boolean> = [];

  constructor(private readonly filePath: string | null, private readonly now: () => number = Date.now) {
    if (!filePath) this.loading = Promise.resolve();
  }

  get size(): number { return this.entries.size; }

  /** Reads the file once. A file that is missing, corrupt, too large or of another format is removed and the cache starts empty. */
  load(): Promise<void> {
    this.loading ??= this.readFile().finally(() => { this.loaded = true; this.pendingDrops = []; });
    return this.loading;
  }

  async get(key: string): Promise<GitHubReadEntry | undefined> {
    await this.load();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.expired(entry)) { this.remove(key); return undefined; }
    entry.usedAt = this.now();
    // Moved to the back: most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  /** Peeks without counting as a use, for checks such as whether a newer state outdates it. */
  peek(key: string): GitHubReadEntry | undefined {
    const entry = this.entries.get(key);
    return entry && !this.expired(entry) ? entry : undefined;
  }

  /** Keeps `value`; false when it was not kept, being too large, not JSON, or the cache closed. */
  set(key: string, scope: GitHubReadScope, value: unknown, options: { readAt?: number; noExpiry?: boolean } = {}): boolean {
    if (this.closed) return false;
    const text = JSON.stringify(value);
    // `undefined` and anything JSON can't hold are not kept.
    if (text === undefined) return false;
    const bytes = Buffer.byteLength(text);
    if (bytes > GITHUB_READ_CACHE_LIMITS.memoryBytes / 4) return false;
    this.remove(key);
    const now = this.now();
    this.entries.set(key, { key, scope: { ...scope }, value: structuredClone(value), readAt: options.readAt ?? now, usedAt: now, noExpiry: options.noExpiry ?? false, bytes });
    this.memoryBytes += bytes;
    this.enforceBounds();
    this.changed();
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.dropWhere((entry) => entry.key === key);
  }

  /**
   * Drops every answer `drop` matches, from memory and, at the next write, from disk. Before the
   * file has been read, the drop also applies to what it holds when it is.
   */
  dropWhere(drop: (entry: GitHubReadEntry) => boolean): number {
    let count = 0;
    for (const [key, entry] of [...this.entries]) if (drop(entry) && this.remove(key)) count++;
    if (!this.loaded && this.filePath) {
      this.pendingDrops.push(drop);
      // Read now, so the file is rewritten without them even if nothing asks for it.
      void this.load();
      this.changed();
    } else if (count) this.changed();
    return count;
  }

  clear(): void {
    this.dropWhere(() => true);
  }

  /** Writes what changed now, for a server shutting down. Later changes are not kept. */
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirty) this.write();
    this.closed = true;
    await this.writing;
  }

  /** Waits for a pending write, for tests. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirty) this.write();
    await this.writing;
  }

  private expired(entry: GitHubReadEntry): boolean {
    return !entry.noExpiry && this.now() - entry.readAt > GITHUB_READ_CACHE_LIMITS.maxAgeMs;
  }

  private remove(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.memoryBytes -= entry.bytes;
    return true;
  }

  private enforceBounds(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= GITHUB_READ_CACHE_LIMITS.entries && this.memoryBytes <= GITHUB_READ_CACHE_LIMITS.memoryBytes) break;
      this.entries.delete(key);
      this.memoryBytes -= entry.bytes;
    }
  }

  private changed(): void {
    if (!this.filePath || this.closed) return;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.write(); }, GITHUB_READ_CACHE_LIMITS.writeDelayMs);
    this.timer.unref?.();
  }

  private write(): void {
    const filePath = this.filePath;
    if (!filePath) return;
    this.dirty = false;
    // After the file has been read: what it holds and no drop has removed is part of what is written.
    this.writing = this.writing.then(() => this.load()).then(() => {
      // Newest first until the disk bound is reached; answers too large for disk stay in memory only.
      const kept: Array<Omit<GitHubReadEntry, 'bytes'>> = [];
      let total = 0;
      for (const entry of [...this.entries.values()].reverse()) {
        if (entry.bytes > GITHUB_READ_CACHE_LIMITS.diskEntryBytes || this.expired(entry)) continue;
        if (total + entry.bytes > GITHUB_READ_CACHE_LIMITS.diskBytes) break;
        total += entry.bytes;
        kept.push({ key: entry.key, scope: entry.scope, value: entry.value, readAt: entry.readAt, usedAt: entry.usedAt, noExpiry: entry.noExpiry });
      }
      kept.reverse();
      // Measured as written, in bytes, as reading it measures it: the oldest go until it fits.
      let contents = envelope(kept);
      while (kept.length && Buffer.byteLength(contents) > GITHUB_READ_CACHE_LIMITS.fileBytes) {
        kept.splice(0, Math.max(1, Math.ceil(kept.length / 10)));
        contents = envelope(kept);
      }
      return kept.length ? writeFileAtomically(filePath, contents) : rm(filePath, { force: true });
    }).catch(() => undefined);
  }

  private async readFile(): Promise<void> {
    const filePath = this.filePath;
    if (!filePath) return;
    await removeLeftovers(filePath);
    try {
      if ((await stat(filePath)).size > GITHUB_READ_CACHE_LIMITS.fileBytes) throw new Error('Too large');
      const file = fileSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
      if (createHash('sha256').update(file.entries).digest('hex') !== file.checksum) throw new Error('Checksum');
      const entries = entriesSchema.parse(JSON.parse(file.entries));
      for (const entry of entries) {
        // A change made before the file was read wins over what the file says.
        if (this.entries.has(entry.key)) continue;
        const text = JSON.stringify(entry.value);
        const loaded: GitHubReadEntry = { ...entry, bytes: text === undefined ? 0 : Buffer.byteLength(text) };
        if (this.expired(loaded) || !loaded.bytes || this.pendingDrops.some((drop) => drop(loaded))) continue;
        // Older entries go before the ones set while loading.
        this.entries.set(entry.key, loaded);
        this.memoryBytes += loaded.bytes;
      }
      this.reorderByUse();
      this.enforceBounds();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      // Not trusted: removed, and the cache starts with what this run reads.
      await rm(filePath, { force: true }).catch(() => undefined);
    }
  }

  private reorderByUse(): void {
    const sorted = [...this.entries.values()].sort((a, b) => a.usedAt - b.usedAt);
    this.entries.clear();
    for (const entry of sorted) this.entries.set(entry.key, entry);
  }
}

function envelope(entries: Array<Omit<GitHubReadEntry, 'bytes'>>): string {
  const text = JSON.stringify(entries);
  return JSON.stringify({ format: FORMAT, checksum: createHash('sha256').update(text).digest('hex'), entries: text });
}

/** Temporary files a write left behind when the process stopped between writing and renaming. */
export async function removeLeftovers(filePath: string): Promise<void> {
  const name = path.basename(filePath);
  const folder = path.dirname(filePath);
  for (const entry of await readdir(folder).catch(() => [] as string[])) {
    if (entry.startsWith(`${name}.`) && entry.endsWith('.tmp')) await rm(path.join(folder, entry), { force: true }).catch(() => undefined);
  }
}
