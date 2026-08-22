import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import path from 'node:path';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { mergeRepositoryChangeScopes } from '../../shared/repository-change';

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
  if (normalized.endsWith('.lock')) return null;
  const gitRelative = insideGitDir
    ? normalized
    : normalized === '.git' ? '' : normalized.startsWith('.git/') ? normalized.slice(5) : null;
  if (gitRelative === null) return 'worktree';
  if (gitRelative === '') return null;
  if (gitRelative === 'index') return 'index';
  if (gitRelative === 'config') return 'unknown';
  if (gitRelative === 'HEAD' || gitRelative === 'ORIG_HEAD'
    || gitRelative === 'MERGE_HEAD' || gitRelative === 'CHERRY_PICK_HEAD'
    || gitRelative === 'REVERT_HEAD' || gitRelative === 'BISECT_LOG'
    || gitRelative === 'packed-refs' || gitRelative.startsWith('refs/')
    || gitRelative.startsWith('rebase-merge/') || gitRelative.startsWith('rebase-apply/')) {
    return 'refs';
  }
  if (gitRelative.startsWith('worktrees/')) return 'worktrees';
  if (GIT_DIR_FILES.has(gitRelative) || GIT_DIR_PREFIXES.some((prefix) => gitRelative.startsWith(prefix))) {
    return 'unknown';
  }
  return null;
}

export class RepositoryWatcher {
  private watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  private active: RepositoryInfo | null = null;
  private deferrals = 0;
  private pendingScope: RepositoryChangeScope | null = null;

  constructor(
    private readonly onChange: (repositoryId: string, scope: RepositoryChangeScope) => void,
    private readonly hasActiveGitProcess: () => boolean = () => false,
  ) {}

  start(repository: RepositoryInfo): boolean {
    this.stop();
    this.active = repository;
    try {
      this.watchers.push(watch(repository.path, { recursive: true }, (_event, filename) => {
        const normalized = String(filename ?? '').replace(/\\/g, '/');
        const scope = classifyRepositoryChange(normalized, false);
        if (!scope) return;
        this.schedule(scope);
      }));
      if (!path.resolve(repository.commonDir).startsWith(path.resolve(repository.path))) {
        this.watchers.push(watch(repository.commonDir, { recursive: true }, (_event, filename) => {
          const normalized = String(filename ?? '').replace(/\\/g, '/');
          const scope = classifyRepositoryChange(normalized, true);
          if (!scope) return;
          this.schedule(scope);
        }));
      }
      for (const watcher of this.watchers) watcher.on('error', () => this.stop());
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    this.deferrals = 0;
    this.pendingScope = null;
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
