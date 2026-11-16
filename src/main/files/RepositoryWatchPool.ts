import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import type { RepositoryWatchState } from '../../shared/runtime-events';
import { RepositoryWatcher, type RepositoryWatcherOptions, type RepositoryWatchStatus } from './RepositoryWatcher';

/**
 * Repositories watched at once. Each is one system watch on Windows and macOS, and one per folder
 * on Linux, where a large repository takes thousands: past this, a repository someone opens is read
 * on a timer instead, until a watch is given up.
 */
export const MAX_WATCHED_REPOSITORIES = 6;
/**
 * How long a watch nobody holds is kept: long enough for a reload, or a connection that drops and
 * comes back, to find the watch it left and not walk the repository again.
 */
export const WATCH_GRACE_MS = 15_000;
/**
 * How long a repository waits before its watch is set up when the same client opened another less
 * than this before: someone going through the repositories one after another starts only the watch
 * of the first and of the one they stop on. Opening one repository watches it at once.
 */
export const WATCH_START_DELAY_MS = 300;

export interface RepositoryWatchPoolOptions extends Omit<RepositoryWatcherOptions, 'onState'> {
  /**
   * A repository's watch went from one state to another, with the new watch's id once it is watching.
   * `paused`: stopped on purpose for a while (see `RepositoryWatchPool.pause`).
   */
  onState?: (repositoryId: string, state: RepositoryWatchState, watchId: string | null, paused?: boolean) => void;
  maxWatched?: number;
  graceMs?: number;
  startDelayMs?: number;
  /** Swapped in tests. */
  createWatcher?: (onState: NonNullable<RepositoryWatcherOptions['onState']>) => Pick<RepositoryWatcher, 'start' | 'stop' | 'status' | 'covers'>;
}

type Watcher = Pick<RepositoryWatcher, 'start' | 'stop' | 'status' | 'covers'>;

interface Entry {
  repository: RepositoryInfo;
  holders: Set<string>;
  watcher: Watcher | null;
  startTimer: NodeJS.Timeout | null;
  releaseTimer: NodeJS.Timeout | null;
  /** Held, but no room to watch it: its holders read it on a timer. The order it began waiting in, or 0. */
  waitingSince: number;
  /** Its holders were told it is not watched while it waits. */
  toldWaiting: boolean;
  /** When the last holder left, to give up the oldest idle watch first. */
  idleSince: number;
  /** Stopped on purpose for a while, as before its folder is deleted (see `pause`); whoever holds it keeps it. */
  paused: boolean;
}

/**
 * One watch per repository that someone has open, shared by everyone on it (see `RepositoryWatcher`).
 *
 * A holder is whoever has the repository open, such as a browser tab's connection. A watch starts
 * when the first holder arrives, or shortly after if that holder opened another just before, and
 * stops `WATCH_GRACE_MS` after the last one leaves; a repository given up before its watch started
 * never starts one. At most `maxWatched` watches run,
 * those nobody holds included, but not one that stopped by itself. An idle one is given up for a
 * held one. A held one beyond the bound waits, reported as `stopped`, and repositories waiting take
 * the first room that frees or is idle, the one waiting longest first. A watch that stopped by
 * itself starts again when someone opens its repository again.
 */
export class RepositoryWatchPool {
  private readonly entries = new Map<string, Entry>();
  /** Which repository each holder has open. */
  private readonly held = new Map<string, string>();
  private readonly maxWatched: number;
  private readonly graceMs: number;
  private readonly startDelayMs: number;
  private waitingSequence = 0;
  private stopped = false;
  /** Set while the pool itself stops a watch, whose end is not a place freed for others yet. */
  private removing = false;
  /** Set while it stops one for a while (see `pause`). */
  private pausing = false;
  /** Folders whose repositories are not watched for now (see `pause`), how many times each. */
  private readonly pausedFolders = new Map<string, number>();
  /** When each holder last opened a repository, to tell going through several quickly from opening one. */
  private readonly lastHold = new Map<string, number>();

  constructor(
    private readonly onChange: (repositoryId: string, scope: RepositoryChangeScope) => void,
    private readonly hasActiveGitProcess: () => boolean = () => false,
    private readonly options: RepositoryWatchPoolOptions = {},
  ) {
    this.maxWatched = Math.max(1, options.maxWatched ?? MAX_WATCHED_REPOSITORIES);
    this.graceMs = options.graceMs ?? WATCH_GRACE_MS;
    this.startDelayMs = options.startDelayMs ?? WATCH_START_DELAY_MS;
  }

  /** Watches running or being set up; one that stopped by itself is not counted. */
  get watchedCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (this.running(entry)) count += 1;
    return count;
  }

  /** The repository `holder` has open, or null. */
  heldBy(holder: string): string | null {
    return this.held.get(holder) ?? null;
  }

  /** How the repository is watched; `stopped` while nobody has it open or it waits for room. */
  status(repositoryId: string): RepositoryWatchStatus {
    const entry = this.entries.get(repositoryId);
    if (entry?.watcher) return entry.watcher.status(repositoryId);
    return { state: entry?.startTimer ? 'starting' : 'stopped', watchId: null };
  }

  /** The id of the watch that reports changes to this file, or null when a change to it would go unreported. */
  covers(repositoryId: string, relativePath: string): string | null {
    return this.entries.get(repositoryId)?.watcher?.covers(repositoryId, relativePath) ?? null;
  }

  /** `holder` has `repository` open, and nothing else. */
  hold(holder: string, repository: RepositoryInfo): void {
    if (this.stopped) return;
    const previous = this.held.get(holder);
    if (previous !== undefined && previous !== repository.id) this.release(holder);
    this.held.set(holder, repository.id);
    let entry = this.entries.get(repository.id);
    if (!entry) {
      entry = { repository, holders: new Set(), watcher: null, startTimer: null, releaseTimer: null, waitingSince: 0, toldWaiting: false, idleSince: 0, paused: false };
      this.entries.set(repository.id, entry);
    }
    entry.holders.add(holder);
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
    // Its folder is being deleted: it is not watched until that is over, whoever opens it.
    if (this.pausedFolders.has(folderKey(repository.path))) entry.paused = true;
    const moved = entry.repository.path !== repository.path || entry.repository.commonDir !== repository.commonDir;
    entry.repository = repository;
    if (entry.watcher && !this.running(entry)) {
      // It stopped by itself, after failing to start again: opening the repository again tries once more.
      const dead = entry.watcher;
      entry.watcher = null;
      dead.stop();
    }
    if (entry.watcher) {
      // The same repository moved: its watch follows it.
      if (moved) entry.watcher.start(repository);
      return;
    }
    if (entry.startTimer || entry.waitingSince || entry.paused) return;
    // Opening one repository watches it at once; one opened moments after another, as someone going
    // through several does, waits a little, so only the one they stop on is set up.
    const now = Date.now();
    const quick = this.recentlyHeld(holder, now);
    if (!quick) {
      this.request(entry);
      return;
    }
    const target = entry;
    target.startTimer = setTimeout(() => {
      target.startTimer = null;
      if (this.entries.get(repository.id) === target && target.holders.size > 0) this.request(target);
    }, this.startDelayMs);
  }

  /** Whether `holder` opened another repository less than the start delay ago; notes this one. */
  private recentlyHeld(holder: string, now: number): boolean {
    for (const [other, at] of this.lastHold) if (now - at >= this.startDelayMs) this.lastHold.delete(other);
    const recent = this.lastHold.has(holder);
    this.lastHold.set(holder, now);
    return recent;
  }

  /**
   * Stops every watch of the repositories in `folder`, as before it is deleted, and keeps any from
   * starting there until `endPause`, whoever opens one meanwhile; who holds them keeps them, and is
   * told the watch stopped. Resolves, with what to give `endPause`, once the system had a turn to
   * close them.
   *
   * The folder is compared as the system names it, as Git does for a repository's own path: a name
   * spelled another way, such as a short name on Windows or one through a symbolic link, still
   * matches. One that can't be resolved is compared as given, and the server log says so.
   */
  async pause(folder: string): Promise<string> {
    let named = folder;
    try {
      named = await realpath(folder);
    } catch (error) {
      this.options.logger?.('warn', `Could not resolve a folder whose watch is paused (${errorCode(error)}); it is compared as given.`);
    }
    const key = folderKey(named);
    this.pausedFolders.set(key, (this.pausedFolders.get(key) ?? 0) + 1);
    let stopped = false;
    try {
      for (const entry of this.entries.values()) {
        if (folderKey(entry.repository.path) !== key) continue;
        if (entry.startTimer) clearTimeout(entry.startTimer);
        entry.startTimer = null;
        entry.waitingSince = 0;
        entry.paused = true;
        this.pausing = true;
        try { stopped = Boolean(entry.watcher) || stopped; this.stopWatcher(entry); } finally { this.pausing = false; }
      }
    } catch (error) {
      // The caller gets nothing to end the pause with, so a pause that failed is not left in place.
      this.endPause(key);
      throw error;
    }
    if (stopped) await new Promise<void>((resolve) => setImmediate(resolve));
    return key;
  }

  /** The folder `pause` stopped, by what it answered, may be watched again: whoever still holds a repository in it is. */
  endPause(paused: string): void {
    const key = folderKey(paused);
    const count = (this.pausedFolders.get(key) ?? 0) - 1;
    if (count > 0) {
      this.pausedFolders.set(key, count);
      return;
    }
    this.pausedFolders.delete(key);
    for (const [repositoryId, entry] of [...this.entries]) {
      if (!entry.paused || folderKey(entry.repository.path) !== key) continue;
      entry.paused = false;
      if (entry.holders.size > 0) this.request(entry);
      else this.remove(repositoryId, entry);
    }
    this.startWaiting();
  }

  /** `holder` left the repository it had open, or went away. */
  release(holder: string): void {
    const repositoryId = this.held.get(holder);
    this.held.delete(holder);
    if (repositoryId === undefined) return;
    const entry = this.entries.get(repositoryId);
    if (!entry) return;
    entry.holders.delete(holder);
    if (entry.holders.size > 0) return;
    entry.idleSince = Date.now();
    if (!entry.watcher) {
      // Never watched: nothing to keep.
      this.remove(repositoryId, entry);
      this.startWaiting();
      return;
    }
    entry.releaseTimer = setTimeout(() => {
      entry.releaseTimer = null;
      if (this.entries.get(repositoryId) === entry && entry.holders.size === 0) {
        this.remove(repositoryId, entry);
        this.startWaiting();
      }
    }, this.graceMs);
    // A repository waiting for room takes this one's now.
    this.startWaiting();
  }

  /** The repository is no longer in OpenTig: its watch stops now, whoever has it open. */
  forget(repositoryId: string): void {
    const entry = this.entries.get(repositoryId);
    if (!entry) return;
    for (const holder of entry.holders) this.held.delete(holder);
    entry.holders.clear();
    this.remove(repositoryId, entry);
    this.startWaiting();
  }

  stop(): void {
    this.stopped = true;
    for (const [repositoryId, entry] of [...this.entries]) this.remove(repositoryId, entry);
    this.held.clear();
  }

  private running(entry: Entry): boolean {
    return entry.watcher !== null && entry.watcher.status(entry.repository.id).state !== 'stopped';
  }

  /** The repository is to be watched: it waits its turn behind those already waiting. */
  private request(entry: Entry): void {
    if (!entry.waitingSince) entry.waitingSince = ++this.waitingSequence;
    this.startWaiting();
    if (entry.waitingSince && !entry.toldWaiting) {
      entry.toldWaiting = true;
      // Its holders cannot rely on reports: they read it on a timer until it is watched.
      this.options.onState?.(entry.repository.id, 'stopped', null);
    }
  }

  /** Starts the repositories waiting, longest first, while there is room or an idle watch to give up. */
  private startWaiting(): void {
    if (this.stopped) return;
    const waiting = [...this.entries.values()].filter((entry) => entry.waitingSince && entry.holders.size > 0)
      .sort((left, right) => left.waitingSince - right.waitingSince);
    for (const entry of waiting) {
      if (!this.makeRoom(entry)) return;
      this.start(entry);
    }
  }

  private start(entry: Entry): void {
    entry.waitingSince = 0;
    entry.toldWaiting = false;
    const repositoryId = entry.repository.id;
    const onState: NonNullable<RepositoryWatcherOptions['onState']> = (id, state, watchId) => {
      if (this.entries.get(repositoryId)?.watcher !== watcher) return;
      this.options.onState?.(id, state, watchId, this.pausing || undefined);
      // A watch that stopped by itself no longer takes a place: a repository waiting gets it.
      if (state === 'stopped' && !this.removing) this.startWaiting();
    };
    const watcher: Watcher = this.options.createWatcher
      ? this.options.createWatcher(onState)
      : new RepositoryWatcher(this.onChange, this.hasActiveGitProcess, { ...this.options, onState });
    entry.watcher = watcher;
    watcher.start(entry.repository);
  }

  /** Whether another watch may run, giving up the one idle the longest if that makes room. */
  private makeRoom(entry: Entry): boolean {
    if (this.watchedCount < this.maxWatched) return true;
    let oldest: [string, Entry] | null = null;
    for (const candidate of this.entries) {
      const [, other] = candidate;
      if (other === entry || !this.running(other) || other.holders.size > 0) continue;
      if (!oldest || other.idleSince < oldest[1].idleSince) oldest = candidate;
    }
    if (!oldest) return false;
    this.remove(oldest[0], oldest[1]);
    return true;
  }

  private remove(repositoryId: string, entry: Entry): void {
    if (entry.startTimer) clearTimeout(entry.startTimer);
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.startTimer = null;
    entry.releaseTimer = null;
    entry.waitingSince = 0;
    this.stopWatcher(entry);
    if (this.entries.get(repositoryId) === entry) this.entries.delete(repositoryId);
  }

  /** Stopped while still in place, so whoever holds it is told it ended (see `RepositoryWatcher.stop`). */
  private stopWatcher(entry: Entry): void {
    const watcher = entry.watcher;
    if (!watcher) return;
    this.removing = true;
    try { watcher.stop(); } finally { this.removing = false; }
    entry.watcher = null;
  }
}

/** A folder as the pool compares them: resolved, without a trailing separator, and case-blind on Windows. */
function folderKey(folder: string): string {
  const resolved = path.resolve(folder).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}
