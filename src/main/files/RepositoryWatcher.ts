import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { DirectoryTreeWatcher, type DirectoryTreeWatcherOptions, type WatchFailure } from './DirectoryTreeWatcher';
import path from 'node:path';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { mergeRepositoryChangeScopes } from '../../shared/repository-change';
import type { RepositoryWatchState } from '../../shared/runtime-events';

const MAX_DEFERRALS = 10;

// Inside the git dir only these paths change what OpenTig displays; everything
// else (objects, logs, fsmonitor cookies, gc.pid, sharedindex…) is bookkeeping
// that must never trigger a refresh, or git's own activity loops the watcher.
const GIT_DIR_FILES = new Set(['HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'index', 'packed-refs', 'config']);
const GIT_DIR_PREFIXES = ['refs/', 'worktrees/', 'rebase-merge/', 'rebase-apply/'];

export function shouldIgnore(normalized: string, insideGitDir: boolean): boolean {
  return classifyRepositoryChange(normalized, insideGitDir) === null;
}

export function classifyRepositoryChange(
  normalized: string,
  insideGitDir: boolean,
): RepositoryChangeScope | null {
  if (!normalized) return 'unknown';
  if (normalized.split('/').includes('node_modules')) return null;
  const gitRelative = insideGitDir
    ? normalized
    : normalized === '.git' ? '' : normalized.startsWith('.git/') ? normalized.slice(5) : null;
  // In the worktree a `.lock` file is the user's, such as yarn.lock or Cargo.lock.
  if (gitRelative === null) return 'worktree';
  // In the Git directory it is one of Git's own locks, which come and go with every write.
  if (gitRelative === '' || gitRelative.endsWith('.lock')) return null;
  // What the repository's own excludes leave out changes the untracked files.
  if (gitRelative === 'info/exclude') return 'worktree';
  if (gitRelative === 'index') return 'index';
  if (gitRelative === 'config') return 'unknown';
  if (gitRelative === 'HEAD' || gitRelative === 'ORIG_HEAD'
    || gitRelative === 'MERGE_HEAD' || gitRelative === 'CHERRY_PICK_HEAD'
    || gitRelative === 'REVERT_HEAD' || gitRelative === 'BISECT_LOG'
    || gitRelative === 'packed-refs' || gitRelative.startsWith('refs/')
    || gitRelative.startsWith('rebase-merge/') || gitRelative.startsWith('rebase-apply/')) {
    return 'refs';
  }
  // A linked worktree's HEAD moves when a branch is checked out in it: the worktree list shows that
  // branch, and when it is the worktree on screen so do its history and branch menu.
  if (/^worktrees\/[^/]+\/HEAD$/.test(gitRelative)) return 'unknown';
  if (gitRelative.startsWith('worktrees/')) return 'worktrees';
  if (GIT_DIR_FILES.has(gitRelative) || GIT_DIR_PREFIXES.some((prefix) => gitRelative.startsWith(prefix))) {
    return 'unknown';
  }
  return null;
}

export type { RepositoryWatchState } from '../../shared/runtime-events';

/** How the open repository is watched, and, while every change is reported, the id of that watch. */
export interface RepositoryWatchStatus {
  state: RepositoryWatchState;
  /**
   * New each time watching begins: a client that was told this id saw every change
   * since then, as long as it was connected. Null unless `state` is `watching`.
   */
  watchId: string | null;
}

export interface RepositoryWatcherOptions {
  platform?: NodeJS.Platform;
  logger?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /**
   * The repository's watch went from one state to another, with the new watch's id
   * once it is watching. Called for every change but to `starting`.
   */
  onState?: (repositoryId: string, state: RepositoryWatchState, watchId: string | null) => void;
  /** Git-ignored folders of a worktree, relative to it, which are not watched on Linux. */
  listIgnoredDirectories?: (repository: RepositoryInfo) => Promise<string[]>;
  /** How long a failed native watch waits before starting again. */
  retryDelayMs?: number;
  /** Swapped in tests to stand for the system's watches. */
  watchDirectory?: DirectoryTreeWatcherOptions['watch'];
}

/** Native watches that fail are started again this many times before the watch counts as stopped. */
const MAX_RESTARTS = 3;
// Inside the git dir only these folders hold what OpenTig shows; objects, logs and hooks are never watched.
// `info` holds the repository's own excludes, which decide what is ignored and so what is watched.
const GIT_DIR_FOLDERS = /^(?:refs|worktrees|rebase-merge|rebase-apply|info)(?:\/|$)/;
const WORKTREE_IGNORE_FILES = /(?:^|\/)\.gitignore$|^\.git\/info\/exclude$/;

/**
 * Reports changes in the open repository, batched per 250 ms and widened to the
 * narrowest scope that covers them.
 *
 * On Windows and macOS one native recursive watch covers the worktree. On
 * Linux, where Node walks every folder synchronously to emulate that, folders
 * are watched one by one, asynchronously, and Git-ignored ones are left out
 * (see `DirectoryTreeWatcher`); once they are all in place a change is reported,
 * in case one landed while they were being set up.
 *
 * A watch that fails is reported in the server log, never silently dropped.
 * Running out of the system's watches keeps what is watched and reports the
 * watch as degraded; losing the repository's folder, or a native watch that
 * fails again after restarting, reports it as stopped. Clients then read the
 * repository on a timer instead of waiting for changes.
 */
export class RepositoryWatcher {
  private watchers: FSWatcher[] = [];
  private trees: DirectoryTreeWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private active: RepositoryInfo | null = null;
  private deferrals = 0;
  private restarts = 0;
  private pendingScope: RepositoryChangeScope | null = null;
  private watchState: RepositoryWatchState = 'stopped';
  private watchId: string | null = null;
  private readonly platform: NodeJS.Platform;
  private readonly logger: NonNullable<RepositoryWatcherOptions['logger']>;
  private ignoredDirectories: ReadonlySet<string> = new Set();
  private generation = 0;

  constructor(
    private readonly onChange: (repositoryId: string, scope: RepositoryChangeScope) => void,
    private readonly hasActiveGitProcess: () => boolean = () => false,
    private readonly options: RepositoryWatcherOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.logger = options.logger ?? (() => undefined);
  }

  /** How the repository is watched; `stopped` when it is not the open one. */
  status(repositoryId: string): RepositoryWatchStatus {
    return this.active?.id === repositoryId ? { state: this.watchState, watchId: this.watchId } : { state: 'stopped', watchId: null };
  }

  state(repositoryId: string): RepositoryWatchState {
    return this.status(repositoryId).state;
  }

  /**
   * The id of the watch that reports changes to this file of the open repository,
   * or null when a change to it would go unreported: another repository is watched,
   * the watch is starting or in trouble, its folder is not watched, or the
   * classifier drops changes to it.
   */
  covers(repositoryId: string, relativePath: string): string | null {
    if (this.active?.id !== repositoryId || this.watchState !== 'watching') return null;
    const normalized = relativePath.replace(/\\/g, '/');
    if (classifyRepositoryChange(normalized, false) !== 'worktree') return null;
    if (this.trees.length === 0) return this.watchers.length > 0 ? this.watchId : null;
    const folder = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    return this.trees[0]!.covers(folder) ? this.watchId : null;
  }

  start(repository: RepositoryInfo): boolean {
    // A client opening the repository already watched, or being set up, leaves the watch as it is.
    if (this.active?.id === repository.id && this.active.path === repository.path && (this.watchState === 'watching' || this.watchState === 'starting')) return true;
    this.stop();
    this.active = repository;
    this.restarts = 0;
    return this.platform === 'linux' ? this.startTrees(repository) : this.startNative(repository);
  }

  stop(): void {
    // Clients of the repository it stops watching are told, so they stop relying on its reports.
    const left = this.active;
    if (left && this.watchState !== 'stopped') {
      this.watchState = 'stopped';
      this.watchId = null;
      this.options.onState?.(left.id, 'stopped', null);
    }
    this.generation += 1;
    this.closeWatches();
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.active = null;
    this.deferrals = 0;
    this.pendingScope = null;
    this.watchState = 'stopped';
    this.watchId = null;
  }

  private closeWatches(): void {
    for (const watcher of this.watchers) watcher.close();
    for (const tree of this.trees) tree.close();
    this.watchers = [];
    this.trees = [];
  }

  private startNative(repository: RepositoryInfo): boolean {
    try {
      this.watchers.push(watch(repository.path, { recursive: true }, (_event, filename) => {
        this.report(String(filename ?? ''), false);
      }));
      if (!isInside(repository.commonDir, repository.path)) {
        this.watchers.push(watch(repository.commonDir, { recursive: true }, (_event, filename) => {
          this.report(String(filename ?? ''), true);
        }));
      }
      for (const watcher of this.watchers) watcher.on('error', (error) => this.nativeFailed(repository, error));
      this.setState(repository.id, 'watching');
      return true;
    } catch (error) {
      this.nativeFailed(repository, error);
      return false;
    }
  }

  private nativeFailed(repository: RepositoryInfo, error: unknown): void {
    if (this.active?.id !== repository.id || this.retryTimer) return;
    this.closeWatches();
    const code = errorCode(error);
    if (this.restarts >= MAX_RESTARTS) {
      this.logger('error', `Stopped watching ${repositoryLabel(repository)} for changes (${code}) after ${MAX_RESTARTS} restarts. Clients now read it on a timer.`);
      this.setState(repository.id, 'stopped');
      return;
    }
    this.restarts += 1;
    this.logger('warn', `Watching ${repositoryLabel(repository)} for changes failed (${code}); starting it again.`);
    // Until it is back, changes go unreported: clients are told, and told again with a new watch once it is.
    this.setState(repository.id, 'degraded');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.active?.id !== repository.id) return;
      this.startNative(repository);
    }, this.options.retryDelayMs ?? 1_000);
  }

  private startTrees(repository: RepositoryInfo): boolean {
    const generation = this.generation;
    const current = () => this.generation === generation && this.active?.id === repository.id;
    const failed = (failure: WatchFailure) => {
      if (!current()) return;
      if (failure.kind === 'limit') {
        this.logger('warn', `Watching ${repositoryLabel(repository)} is incomplete: the system's limit on watched folders was reached (${failure.code}). On Linux, raise fs.inotify.max_user_watches. Until then clients also read it on a timer.`);
        this.setState(repository.id, 'degraded');
        return;
      }
      if (failure.kind === 'folder') {
        this.logger('warn', `Watching a folder of ${repositoryLabel(repository)} failed (${failure.code}). Clients also read it on a timer.`);
        this.setState(repository.id, 'degraded');
        return;
      }
      this.logger('error', `Stopped watching ${repositoryLabel(repository)} for changes: its folder failed (${failure.code}). Clients now read it on a timer.`);
      this.closeWatches();
      this.setState(repository.id, 'stopped');
    };
    const worktree = new DirectoryTreeWatcher({
      root: repository.path,
      include: (relative) => this.watchesWorktreeFolder(relative),
      onChange: (relative) => {
        this.report(relative, false);
        if (WORKTREE_IGNORE_FILES.test(relative)) void this.refreshIgnored(repository, generation);
      },
      onFailure: failed,
      ...(this.options.watchDirectory ? { watch: this.options.watchDirectory } : {}),
    });
    this.trees.push(worktree);
    const separate = !isInside(repository.commonDir, repository.path);
    const common = separate ? new DirectoryTreeWatcher({
      root: repository.commonDir,
      include: (relative) => relative === '' || GIT_DIR_FOLDERS.test(relative),
      onChange: (relative) => {
        this.report(relative, true);
        if (relative === 'info/exclude') void this.refreshIgnored(repository, generation);
      },
      onFailure: failed,
      ...(this.options.watchDirectory ? { watch: this.options.watchDirectory } : {}),
    }) : null;
    if (common) this.trees.push(common);
    // Setting up is not trouble, but nothing is taken as covered until every folder is in place.
    this.watchState = 'starting';
    void (async () => {
      this.ignoredDirectories = await this.listIgnored(repository);
      if (!current()) return;
      await Promise.all([worktree.add(), common?.add()]);
      if (!current() || this.trees.length === 0 || this.watchState !== 'starting') return;
      // Clients are told, with a change in case one landed while the folders were being set up.
      this.setState(repository.id, 'watching');
    })();
    return true;
  }

  private watchesWorktreeFolder(relative: string): boolean {
    if (relative === '') return true;
    if (relative.split('/').includes('node_modules')) return false;
    if (relative === '.git' || relative.startsWith('.git/')) return relative === '.git' || GIT_DIR_FOLDERS.test(relative.slice(5));
    return !this.ignoredDirectories.has(relative);
  }

  private async listIgnored(repository: RepositoryInfo): Promise<ReadonlySet<string>> {
    if (!this.options.listIgnoredDirectories) return new Set();
    try {
      return new Set((await this.options.listIgnoredDirectories(repository)).map((entry) => entry.replace(/\/+$/, '')));
    } catch (error) {
      // Watching more folders than needed is safe; missing one is not.
      this.logger('warn', `Could not list the ignored folders of ${repositoryLabel(repository)} (${errorCode(error)}); watching all of them.`);
      return new Set();
    }
  }

  /** A changed ignore rule may bring folders into view: they are watched from now on. */
  private async refreshIgnored(repository: RepositoryInfo, generation: number): Promise<void> {
    const ignored = await this.listIgnored(repository);
    if (this.generation !== generation) return;
    this.ignoredDirectories = ignored;
    await this.trees[0]?.add();
  }

  private report(filename: string, insideGitDir: boolean): void {
    const scope = classifyRepositoryChange(filename.replace(/\\/g, '/'), insideGitDir);
    if (scope) this.schedule(scope);
  }

  private setState(repositoryId: string, state: RepositoryWatchState): void {
    if (this.watchState === state) return;
    this.watchState = state;
    // Each watch is a new one: whatever happened while there was none went unreported.
    this.watchId = state === 'watching' ? randomUUID() : null;
    if (state !== 'starting') this.options.onState?.(repositoryId, state, this.watchId);
  }

  private schedule(scope: RepositoryChangeScope): void {
    this.pendingScope = this.pendingScope
      ? mergeRepositoryChangeScopes(this.pendingScope, scope)
      : scope;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), 250);
  }

  private fire(): void {
    if (!this.active) return;
    // OpenTig's own git writes trigger watcher events; wait for the process to
    // finish (bounded) so one operation does not fan out into several refreshes.
    if (this.hasActiveGitProcess() && this.deferrals < MAX_DEFERRALS) {
      this.deferrals += 1;
      this.timer = setTimeout(() => this.fire(), 250);
      return;
    }
    this.deferrals = 0;
    const scope = this.pendingScope ?? 'unknown';
    this.pendingScope = null;
    this.timer = null;
    this.onChange(this.active.id, scope);
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

/** The repository's folder name: enough to tell which one in the log, without its full path. */
function repositoryLabel(repository: RepositoryInfo): string {
  return JSON.stringify(path.basename(repository.path));
}
