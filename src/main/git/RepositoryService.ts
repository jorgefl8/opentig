import { createHash } from 'node:crypto';
import { access, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RepositoryInfo, RecentRepository, RepositoryOrganization, RepositoryRelocationResult, RepositoryRelocationSearch } from '../../shared/contracts';
import type { RepositoryStatus } from '../../shared/git-types';
import { normalizeRepositoryKey } from '../../shared/repository-projects';
import { GitOperationError } from '../../shared/errors';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { GitProcess } from './GitProcess';
import { parseStatus } from './StatusParser';

export class RepositoryService {
  private readonly repositories = new Map<string, RepositoryInfo>();
  private untrackedLineCache = new Map<string, { size: number; mtimeMs: number; lines: number }>();

  constructor(private readonly git: GitProcess, private readonly settings: SettingsStore) {}

  async restore(): Promise<RepositoryInfo | null> {
    const id = this.settings.activeRepositoryId;
    if (!id) return null;
    try { return await this.openRecent(id); } catch { return null; }
  }

  async openRecent(id: string): Promise<RepositoryInfo> {
    const recent = this.settings.recentRepositories.find((item) => item.id === id);
    if (!recent) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'open-recent', message: 'The recent repository no longer exists.' });
    return this.openPath(recent.path);
  }

  async openPath(selectedPath: string): Promise<RepositoryInfo> {
    const repository = await this.preparePath(selectedPath);
    await this.settings.touchRepository(repository);
    return repository;
  }

  /** Inspect/cache only: no recent entry, active repository, or persistence. */
  async preparePath(selectedPath: string): Promise<RepositoryInfo> {
    const repository = await this.inspectPath(selectedPath);
    this.repositories.set(repository.id, repository);
    this.git.registerRepository(repository.path, repository.commonDir);
    return repository;
  }

  async completeSetup(id: string, validate: () => void = () => undefined): Promise<RepositoryInfo> {
    const prepared = this.get(id);
    const repository = await this.inspectPath(prepared.path);
    if (repository.id !== prepared.id || repository.commonDir !== prepared.commonDir) {
      throw new Error('The repository location changed. Select the folder again.');
    }
    validate();
    await this.settings.touchRepository(repository);
    return repository;
  }

  async relocateRecent(id: string, selectedPath: string, activate = true): Promise<RepositoryInfo> {
    if (!this.settings.recentRepositories.some((item) => item.id === id)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'relocate-repository', message: 'The recent repository no longer exists.' });
    }
    const previous = this.get(id);
    const repository = await this.inspectPath(selectedPath);
    if (repository.id !== id && this.settings.recentRepositories.some((item) => item.id === repository.id)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'relocate-repository', message: 'That folder is already in OpenTig. Remove the old entry instead, or choose a different location.' });
    }
    await this.settings.relocateRepository(id, repository, activate);
    this.git.unregisterRepository(previous.path);
    this.repositories.delete(id);
    this.repositories.set(repository.id, repository);
    this.git.registerRepository(repository.path, repository.commonDir);
    return repository;
  }

  /** Saved repositories whose folder is gone. Other access errors are left to the open attempt to report. */
  async unavailableIds(): Promise<string[]> {
    const recents = this.settings.recentRepositories;
    const missing = await Promise.all(recents.map((item) => folderMissing(item.path)));
    return recents.filter((_, index) => missing[index]).map((item) => item.id);
  }

  /**
   * After one repository moved, looks for the other missing ones in the same
   * place: first at the same relative path from the new parent folder, then by
   * folder name up to two levels below the new parent's parent. A match must be
   * the root of a Git worktree with the same folder and repository names.
   */
  async findRelocations(previousPath: string, newPath: string): Promise<RepositoryRelocationSearch> {
    const previousParent = path.dirname(path.resolve(previousPath));
    const newParent = path.dirname(path.resolve(newPath));
    const searchedPath = path.dirname(newParent);
    const missingIds = new Set(await this.unavailableIds());
    const missing = this.settings.recentRepositories.filter((item) => missingIds.has(item.id));
    const knownPaths = new Set(this.settings.recentRepositories.filter((item) => !missingIds.has(item.id)).map((item) => normalizeFolder(item.path)));
    let index: Promise<Map<string, string[]>> | null = null;
    const candidates: RepositoryRelocationSearch['candidates'] = [];
    const unresolved: RepositoryRelocationSearch['unresolved'] = [];
    const matching = async (recent: RecentRepository, option: string): Promise<string | null> => {
      if (knownPaths.has(normalizeFolder(option))) return null;
      const repository = await this.inspectPath(option).catch(() => null);
      if (!repository || normalizeFolder(repository.path) !== normalizeFolder(option)) return null;
      return repository.name === recent.name && repository.repositoryName === recent.repositoryName ? repository.path : null;
    };
    for (const recent of missing) {
      const relative = path.relative(previousParent, recent.path);
      const rebased = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? path.join(newParent, relative) : null;
      let found = rebased ? await matching(recent, rebased) : null;
      if (!found) {
        index ??= indexFolders(searchedPath);
        const byName = [...new Set((await index).get(path.basename(recent.path).toLocaleLowerCase()) ?? [])];
        const matches = (await Promise.all(byName.map((option) => matching(recent, option)))).filter((item): item is string => item !== null);
        // Two folders that both look like this repository are left for the user to choose.
        if (matches.length === 1) found = matches[0]!;
      }
      if (found) {
        knownPaths.add(normalizeFolder(found));
        candidates.push({ id: recent.id, name: recent.name, previousPath: recent.path, path: found });
      } else {
        unresolved.push({ id: recent.id, name: recent.name, previousPath: recent.path });
      }
    }
    return { searchedPath, candidates, unresolved };
  }

  async relocateMany(entries: { id: string; path: string }[]): Promise<RepositoryRelocationResult> {
    const result: RepositoryRelocationResult = { relocated: [], failed: [] };
    for (const entry of entries) {
      const name = this.recent(entry.id)?.name ?? path.basename(entry.path);
      try {
        result.relocated.push({ previousId: entry.id, repository: await this.relocateRecent(entry.id, entry.path, false) });
      } catch (error) {
        result.failed.push({ id: entry.id, name, message: error instanceof Error ? error.message : 'Could not relocate this repository.' });
      }
    }
    return result;
  }

  async forget(repositoryKey: string): Promise<RepositoryOrganization> {
    const key = normalizeRepositoryKey(repositoryKey);
    const organization = await this.settings.forgetRepository(key);
    for (const [id, repository] of this.repositories) {
      if (normalizeRepositoryKey(repository.commonDir) === key) {
        this.git.unregisterRepository(repository.path);
        this.repositories.delete(id);
      }
    }
    return organization;
  }

  recent(id: string): RecentRepository | null {
    return this.settings.recentRepositories.find((item) => item.id === id) ?? null;
  }

  private async inspectPath(selectedPath: string): Promise<RepositoryInfo> {
    const selected = path.resolve(selectedPath);
    const inside = (await this.git.run(selected, ['rev-parse', '--is-inside-work-tree'], { operation: 'validate-repository', readOnly: true, timeoutMs: 10_000 })).stdout.toString('utf8').trim();
    if (inside !== 'true') throw new GitOperationError({ code: 'NOT_REPOSITORY', operation: 'validate-repository', message: 'The folder is not part of a Git worktree.' });
    const root = path.resolve((await this.git.run(selected, ['rev-parse', '--show-toplevel'], { operation: 'repository-root', readOnly: true })).stdout.toString('utf8').trim());
    const commonRaw = (await this.git.run(root, ['rev-parse', '--git-common-dir'], { operation: 'git-common-dir', readOnly: true })).stdout.toString('utf8').trim();
    const commonDir = path.resolve(root, commonRaw);
    const id = createHash('sha256').update(root.toLocaleLowerCase()).digest('hex').slice(0, 16);
    return { id, name: path.basename(root), repositoryName: path.basename(path.dirname(commonDir)), path: root, commonDir };
  }

  get(id: string): RepositoryInfo {
    const existing = this.repositories.get(id);
    if (existing) return existing;
    const recent = this.settings.recentRepositories.find((item) => item.id === id);
    if (recent) {
      const hydrated = { id: recent.id, name: recent.name, repositoryName: recent.repositoryName, path: recent.path, commonDir: recent.commonDir };
      this.repositories.set(id, hydrated);
      this.git.registerRepository(hydrated.path, hydrated.commonDir);
      return hydrated;
    }
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'repository', message: 'Unknown repository.' });
  }

  recents(): RecentRepository[] { return this.settings.recentRepositories; }

  async status(id: string, includeStats = true): Promise<RepositoryStatus> {
    const repository = this.get(id);
    return structuredClone(await this.git.shareRead(repository.path, `status:${includeStats}`, () => this.readStatus(id, includeStats)));
  }

  invalidate(id: string): void { this.git.invalidate(this.get(id).path); }

  invalidateIfKnown(id: unknown): void {
    if (typeof id === 'string' && (this.repositories.has(id) || this.recent(id))) this.invalidate(id);
  }

  private async readStatus(id: string, includeStats: boolean): Promise<RepositoryStatus> {
    const repository = this.get(id);
    const output = await this.git.run(repository.path, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { operation: 'status', readOnly: true, maxOutputBytes: 32 * 1024 * 1024 });
    const status = parseStatus(output.stdout);
    const [operation, stats] = await Promise.all([
      this.operationState(repository.path),
      includeStats ? this.changeStats(id, status) : Promise.resolve({ insertions: 0, deletions: 0 }),
    ]);
    status.operation = operation;
    status.readOnly = operation !== null;
    status.insertions = stats.insertions;
    status.deletions = stats.deletions;
    return status;
  }

  /**
   * Called only after Git has actually removed a worktree: forgets its cached
   * entries and its recent-repository rows. Sibling worktrees and the
   * repository's project assignment, keyed by `commonDir`, are left intact.
   */
  async forgetWorktree(worktreePath: string): Promise<RecentRepository[]> {
    const target = normalizeWorktreePath(worktreePath);
    for (const [id, repository] of this.repositories) {
      if (normalizeWorktreePath(repository.path) === target) {
        this.git.unregisterRepository(repository.path);
        this.repositories.delete(id);
      }
    }
    return this.settings.forgetWorktreePath(worktreePath);
  }

  /**
   * The in-progress Git operation for an arbitrary worktree directory. Keeps
   * `.git` layout assumptions in one place instead of duplicating them in the
   * worktree manager.
   */
  operationAt(worktreePath: string): Promise<string | null> {
    return this.operationState(worktreePath);
  }

  resolvePath(id: string, relativePath: string): string {
    if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'path', message: 'Invalid path.' });
    }
    const repository = this.get(id);
    const target = path.resolve(repository.path, relativePath);
    const relative = path.relative(repository.path, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'path', message: 'The path is outside the worktree.' });
    }
    return target;
  }

  validatePaths(id: string, paths: string[]): string[] {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 10_000) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paths', message: 'The path selection is invalid.' });
    }
    return [...new Set(paths.map((item) => {
      if (typeof item !== 'string') throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paths', message: 'Invalid path.' });
      this.resolvePath(id, item);
      return item.replace(/\\/g, '/');
    }))];
  }

  private async operationState(root: string): Promise<string | null> {
    try {
      const gitDirRaw = (await this.git.run(root, ['rev-parse', '--absolute-git-dir'], { operation: 'operation-state', readOnly: true })).stdout.toString('utf8').trim();
      const checks: Array<[string, string]> = [
        ['MERGE_HEAD', 'merge'], ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'],
        ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['BISECT_LOG', 'bisect'],
      ];
      for (const [entry, label] of checks) {
        try { await access(path.join(gitDirRaw, entry)); return label; } catch { /* absent */ }
      }
    } catch { /* status remains usable */ }
    return null;
  }

  private async changeStats(id: string, status: RepositoryStatus): Promise<{ insertions: number; deletions: number }> {
    const repository = this.get(id);
    let stats = { insertions: 0, deletions: 0 };
    try {
      const args = status.unborn
        ? ['diff', '--cached', '--numstat', '--']
        : ['diff', 'HEAD', '--numstat', '--'];
      const output = await this.git.run(repository.path, args, {
        operation: 'change-stats',
        readOnly: true,
        maxOutputBytes: 32 * 1024 * 1024,
      });
      stats = parseNumstat(output.stdout.toString('utf8'));
    } catch {
      // The status remains useful even if Git cannot calculate its line totals.
    }

    const untracked = [...new Set(status.changes.filter((change) => change.kind === 'untracked').map((change) => change.path))];
    stats.insertions += await this.countUntrackedLines(id, untracked);
    return stats;
  }

  private async countUntrackedLines(id: string, relativePaths: string[]): Promise<number> {
    // Counting by file identity (size + mtime) keeps watcher-driven refreshes
    // cheap: unchanged untracked files are never reopened.
    const nextCache = new Map<string, { size: number; mtimeMs: number; lines: number }>();
    let total = 0;
    const queue = [...relativePaths];
    const worker = async () => {
      for (let relativePath = queue.shift(); relativePath !== undefined; relativePath = queue.shift()) {
        try {
          const absolute = this.resolvePath(id, relativePath);
          const metadata = await stat(absolute);
          const cached = this.untrackedLineCache.get(absolute);
          const lines = cached && cached.size === metadata.size && cached.mtimeMs === metadata.mtimeMs
            ? cached.lines
            : await countTextLines(absolute);
          nextCache.set(absolute, { size: metadata.size, mtimeMs: metadata.mtimeMs, lines });
          total += lines;
        } catch {
          // Ignore unreadable and transient files; the watcher will refresh later.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, Math.max(1, relativePaths.length)) }, worker));
    this.untrackedLineCache = nextCache;
    return total;
  }
}

function normalizeWorktreePath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function parseNumstat(value: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of value.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (!match) continue;
    if (match[1] !== '-') insertions += Number(match[1]);
    if (match[2] !== '-') deletions += Number(match[2]);
  }
  return { insertions, deletions };
}

async function countTextLines(filePath: string): Promise<number> {
  const handle = await open(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let lines = 0;
  let bytesRead: number;
  let lastByte = -1;
  try {
    do {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.length, null));
      for (let index = 0; index < bytesRead; index += 1) {
        const byte = buffer[index];
        if (byte === 0) return 0;
        if (byte === 10) lines += 1;
        lastByte = byte ?? lastByte;
      }
    } while (bytesRead > 0);
  } finally {
    await handle.close();
  }
  return lastByte >= 0 && lastByte !== 10 ? lines + 1 : lines;
}

async function folderMissing(folder: string): Promise<boolean> {
  return stat(folder).then((value) => !value.isDirectory(), (error: NodeJS.ErrnoException) => error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function normalizeFolder(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLocaleLowerCase() : resolved;
}

const RELOCATION_SEARCH_DEPTH = 2;
const RELOCATION_SEARCH_LIMIT = 5_000;
const RELOCATION_SKIPPED_FOLDERS = new Set(['node_modules', '$recycle.bin', 'system volume information']);

/** Folder names (lower case) to paths, two levels deep, skipping hidden and dependency folders. */
async function indexFolders(root: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  let visited = 0;
  let level = [root];
  for (let depth = 0; depth < RELOCATION_SEARCH_DEPTH && level.length > 0 && visited < RELOCATION_SEARCH_LIMIT; depth += 1) {
    const next: string[] = [];
    for (const folder of level) {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || RELOCATION_SKIPPED_FOLDERS.has(entry.name.toLocaleLowerCase())) continue;
        if (++visited > RELOCATION_SEARCH_LIMIT) break;
        const child = path.join(folder, entry.name);
        const key = entry.name.toLocaleLowerCase();
        index.set(key, [...(index.get(key) ?? []), child]);
        next.push(child);
      }
      if (visited > RELOCATION_SEARCH_LIMIT) break;
    }
    level = next;
  }
  return index;
}
