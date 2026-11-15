import { watch as watchDirectory, type FSWatcher } from 'node:fs';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';

/** Why a folder could not be watched, as far as the caller needs to act on it. */
export type WatchFailure =
  /** The system's limit on watches or open files was reached: further folders cannot be watched either. */
  | { kind: 'limit'; code: string; directory: string }
  /** The root itself went away or failed. */
  | { kind: 'root'; code: string; directory: string }
  /** A folder inside failed for a reason other than having gone away. */
  | { kind: 'folder'; code: string; directory: string };

export interface DirectoryTreeWatcherOptions {
  root: string;
  /** Whether a folder, relative to `root` with `/` separators ('' is the root), is watched. */
  include(relative: string): boolean;
  /** A change at `relative` (a file or folder, '' when the system did not name one). */
  onChange(relative: string): void;
  onFailure(failure: WatchFailure): void;
  /** Swapped in tests. */
  watch?: (directory: string, listener: (event: string, name: string | Buffer | null) => void) => FSWatcher;
}

/**
 * Watches a folder tree one folder at a time, without the recursive option.
 *
 * On Linux, Node implements `recursive` by walking the whole tree synchronously
 * before it returns, every folder included: on a repository with its
 * dependencies installed that held the server for 400 ms on each opening, and
 * spent a watch on every folder of `node_modules`. This walks asynchronously,
 * skips what `include` rejects, and follows folders as they appear and go.
 *
 * Events in a folder created after the walk can arrive before its own watch is
 * in place: `onChange` is told about the folder once its subtree is watched, so
 * whatever was written there meanwhile is read again.
 */
export class DirectoryTreeWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private closed = false;
  private limited = false;
  private readonly watch: NonNullable<DirectoryTreeWatcherOptions['watch']>;

  constructor(private readonly options: DirectoryTreeWatcherOptions) {
    this.watch = options.watch ?? ((directory, listener) => watchDirectory(directory, listener));
  }

  /** Folders watched now. */
  get size(): number {
    return this.watchers.size;
  }

  /** Whether changes under `relative` (a folder, or a file's folder) are being reported. */
  covers(relativeDirectory: string): boolean {
    return !this.closed && this.watchers.has(this.absolute(relativeDirectory));
  }

  /** Watches the tree under `relative` (the root by default); resolves once every folder found is watched. */
  async add(relative = ''): Promise<void> {
    const pending = [relative];
    while (pending.length > 0 && !this.closed && !this.limited) {
      const current = pending.shift()!;
      if (!this.options.include(current)) continue;
      const directory = this.absolute(current);
      if (!this.watchers.has(directory) && !this.start(current, directory)) continue;
      let entries;
      try { entries = await opendir(directory); }
      catch { continue; }
      try {
        for await (const entry of entries) {
          if (this.closed) return;
          if (entry.isDirectory()) pending.push(current ? `${current}/${entry.name}` : entry.name);
        }
      } catch { /* The folder went away while it was read: its parent reports that. */ }
    }
  }

  close(): void {
    this.closed = true;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  private start(relative: string, directory: string): boolean {
    let watcher: FSWatcher;
    try {
      watcher = this.watch(directory, (event, name) => this.changed(relative, event, name));
    } catch (error) {
      this.failed(relative, directory, error);
      return false;
    }
    watcher.on('error', (error) => {
      watcher.close();
      if (this.watchers.get(directory) === watcher) this.watchers.delete(directory);
      this.failed(relative, directory, error);
    });
    this.watchers.set(directory, watcher);
    return true;
  }

  private failed(relative: string, directory: string, error: unknown): void {
    if (this.closed) return;
    const code = errorCode(error);
    // A folder removed or made unreadable between listing it and watching it is simply not there.
    if (relative !== '' && (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM')) return;
    if (code === 'ENOSPC' || code === 'EMFILE' || code === 'ENFILE') {
      if (this.limited) return;
      this.limited = true;
      this.options.onFailure({ kind: 'limit', code, directory });
      return;
    }
    this.options.onFailure({ kind: relative === '' ? 'root' : 'folder', code, directory });
  }

  private changed(parent: string, event: string, name: string | Buffer | null): void {
    if (this.closed) return;
    const child = name === null || name === undefined ? null : String(name).replace(/\\/g, '/');
    const relative = child === null ? parent : parent ? `${parent}/${child}` : child;
    this.options.onChange(child === null ? '' : relative);
    // A folder that appears is followed; one that goes away stops being watched.
    if (event === 'rename' && child !== null) void this.follow(relative);
  }

  /** One follow at a time per path, in the order the system reported them. */
  private readonly following = new Map<string, Promise<void>>();

  private follow(relative: string): Promise<void> {
    const previous = this.following.get(relative) ?? Promise.resolve();
    const next = previous.then(() => this.refollow(relative));
    this.following.set(relative, next);
    void next.finally(() => { if (this.following.get(relative) === next) this.following.delete(relative); });
    return next;
  }

  private async refollow(relative: string): Promise<void> {
    if (this.closed) return;
    const directory = this.absolute(relative);
    let isDirectory = false;
    try { isDirectory = (await stat(directory)).isDirectory(); }
    catch { /* Gone. */ }
    if (this.closed) return;
    // A folder that went away, or was removed and made again, as a checkout does with a folder it
    // empties and refills: the watch on the old one never fires again, so it is always replaced.
    this.forget(directory);
    if (!isDirectory || !this.options.include(relative)) return;
    await this.add(relative);
    // Anything written in it before its watch was in place is read again.
    if (!this.closed) this.options.onChange(relative);
  }

  private forget(directory: string): void {
    const prefix = `${directory}${path.sep}`;
    for (const [watched, watcher] of [...this.watchers]) {
      if (watched !== directory && !watched.startsWith(prefix)) continue;
      watcher.close();
      this.watchers.delete(watched);
    }
  }

  private absolute(relative: string): string {
    return relative ? path.join(this.options.root, ...relative.split('/')) : this.options.root;
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}
