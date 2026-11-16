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
 * How long a newly held repository waits before its watch is set up. Someone going through the
 * repositories one after another starts only the watch of the one they stop on.
 */
export const WATCH_START_DELAY_MS = 300;

export interface RepositoryWatchPoolOptions extends Omit<RepositoryWatcherOptions, 'onState'> {
  /** A repository's watch went from one state to another, with the new watch's id once it is watching. */
  onState?: (repositoryId: string, state: RepositoryWatchState, watchId: string | null) => void;
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
}

/**
 * One watch per repository that someone has open, shared by everyone on it (see `RepositoryWatcher`).
 *
 * A holder is whoever has the repository open, such as a browser tab's connection. A watch starts
 * shortly after the first holder arrives, and stops `WATCH_GRACE_MS` after the last one leaves; a
 * repository given up before its watch started never starts one. At most `maxWatched` watches run,
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
      entry = { repository, holders: new Set(), watcher: null, startTimer: null, releaseTimer: null, waitingSince: 0, toldWaiting: false, idleSince: 0 };
      this.entries.set(repository.id, entry);
    }
    entry.holders.add(holder);
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
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
    if (entry.startTimer || entry.waitingSince) return;
    const target = entry;
    target.startTimer = setTimeout(() => {
      target.startTimer = null;
      if (this.entries.get(repository.id) === target && target.holders.size > 0) this.request(target);
    }, this.startDelayMs);
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
      if (this.entries.get(repositoryId)?.watcher === watcher) this.options.onState?.(id, state, watchId);
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
    // Stopped while still in place, so whoever holds it is told it ended (see `RepositoryWatcher.stop`).
    entry.watcher?.stop();
    entry.watcher = null;
    if (this.entries.get(repositoryId) === entry) this.entries.delete(repositoryId);
  }
}
