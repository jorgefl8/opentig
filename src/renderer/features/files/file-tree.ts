import type { FileTreeEntry } from '@shared/git-types';
import { compareTreePaths, MAX_FILES_TREE_LAZY_PATHS, MAX_FILES_TREE_PATH_CHARACTERS, MAX_FILES_TREE_PATHS } from '../../../shared/files-tree-state';

export interface ExpandedPathsReconciliation {
  retained: string[];
  present: string[];
  deferred: string[];
  missing: string[];
}

export type SnapshotPathPresence = 'present' | 'deferred' | 'missing';

/** DOM host used to bridge Files' DndContext into the toolbar tab strip. */
export const OPEN_FILES_DROP_HOST_ID = 'justgit-open-files-drop-host';

/** The row that initiated a drag can open beside, without opening its selected peers. */
export function canOpenPinnedDrop(entry: FileTreeEntry, sourcePaths: readonly string[]): boolean {
  return entry.type === 'file' && sourcePaths.includes(entry.path);
}

export function findEntry(entries: FileTreeEntry[], path: string): FileTreeEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.type === 'directory') {
      const nested = findEntry(entry.children, path);
      if (nested) return nested;
    }
  }
  return null;
}

export function containsPath(entries: FileTreeEntry[], path: string): boolean {
  return findEntry(entries, path) !== null;
}

// A root snapshot deliberately leaves ignored folders collapsed. Descendants of
// one of those folders are unknown, not missing: FilesView may already have
// loaded them lazily even though they are absent from this snapshot.
export function snapshotPathPresence(entries: FileTreeEntry[], targetPath: string): SnapshotPathPresence {
  for (const entry of entries) {
    if (entry.path === targetPath) return 'present';
    if (entry.type !== 'directory' || !pathContains(entry.path, targetPath)) continue;
    if (entry.ignored === true && entry.children.length === 0) return 'deferred';
    return snapshotPathPresence(entry.children, targetPath);
  }
  return 'missing';
}

export function fileSnapshotFingerprint(entries: FileTreeEntry[]): string {
  const parts: string[] = [];
  const visit = (items: FileTreeEntry[]) => {
    for (const entry of items) {
      if (entry.type === 'directory') {
        parts.push(`d:${entry.path}:${entry.ignored === true ? 1 : 0}`);
        visit(entry.children);
      } else {
        parts.push(`f:${entry.path}:${entry.size}:${entry.mtimeMs}:${entry.ignored === true ? 1 : 0}`);
      }
    }
  };
  visit(entries);
  return parts.join('\n');
}

export function selectedFileChanged(previous: FileTreeEntry[], next: FileTreeEntry[], path: string): boolean {
  const before = findEntry(previous, path);
  const after = findEntry(next, path);
  if (!before || !after || before.type !== 'file' || after.type !== 'file') return before !== after;
  return before.size !== after.size || before.mtimeMs !== after.mtimeMs;
}

// Removes every git-ignored entry (files and whole directories) while keeping
// non-ignored physical directories, even when they have no visible children.
// Used when the "Show files ignored by Git" preference is off.
export function filterIgnoredEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  const filtered: FileTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      if (!entry.ignored) filtered.push(entry);
      continue;
    }
    if (entry.ignored) continue;
    const children = filterIgnoredEntries(entry.children);
    filtered.push({ ...entry, children });
  }
  return filtered;
}

// Grafts lazily loaded children onto the folders the file tree leaves collapsed
// (ignored trees such as node_modules/ are not walked up front). Loaded entries
// only fill folders that arrived empty, so a live snapshot always wins.
export function mergeLoadedDirectories(
  entries: FileTreeEntry[],
  loaded: ReadonlyMap<string, FileTreeEntry[]>,
): FileTreeEntry[] {
  if (loaded.size === 0) return entries;
  return entries.map((entry) => {
    if (entry.type !== 'directory') return entry;
    const children = entry.children.length > 0 ? entry.children : loaded.get(entry.path) ?? entry.children;
    return { ...entry, children: mergeLoadedDirectories(children, loaded) };
  });
}

// Applies freshly-read lazy levels as one immutable state transition. Levels
// removed while the reads were in flight stay removed, and unchanged results
// preserve the current map identity to avoid needless tree rerenders.
export function replaceLoadedDirectoryLevels(
  current: Map<string, FileTreeEntry[]>,
  refreshed: ReadonlyMap<string, FileTreeEntry[]>,
): Map<string, FileTreeEntry[]> {
  let next: Map<string, FileTreeEntry[]> | null = null;
  for (const [path, children] of refreshed) {
    const previous = current.get(path);
    if (previous === undefined) continue;
    if (fileSnapshotFingerprint(previous) === fileSnapshotFingerprint(children)) continue;
    next ??= new Map(current);
    next.set(path, children);
  }
  return next ?? current;
}

export function reconcileExpandedPaths(
  entries: FileTreeEntry[],
  expandedPaths: Iterable<string>,
  loadedDirectories: ReadonlySet<string>,
): ExpandedPathsReconciliation {
  const present: string[] = [];
  const deferred: string[] = [];
  const missing: string[] = [];
  for (const path of expandedPaths) {
    const state = classifyDirectoryPath(entries, path, loadedDirectories);
    if (state.status === 'present') present.push(path);
    else if (state.status === 'deferred') deferred.push(path);
    else missing.push(path);
  }
  return { retained: [...present, ...deferred], present, deferred, missing };
}

export function persistableExpandedPaths(
  entries: FileTreeEntry[],
  expandedPaths: Iterable<string>,
  loadedDirectories: ReadonlySet<string>,
): string[] {
  const candidates = [...new Set(expandedPaths)]
    .map((path) => ({ path, ...classifyDirectoryPath(entries, path, loadedDirectories) }))
    .filter((item) => item.status !== 'missing')
    .sort((left, right) => compareTreePaths(left.path, right.path));
  const result: string[] = [];
  let lazyCount = 0;
  let characters = 0;
  for (const candidate of candidates) {
    if (result.length >= MAX_FILES_TREE_PATHS) break;
    if (candidate.lazy && lazyCount >= MAX_FILES_TREE_LAZY_PATHS) continue;
    if (characters + candidate.path.length > MAX_FILES_TREE_PATH_CHARACTERS) continue;
    result.push(candidate.path);
    characters += candidate.path.length;
    if (candidate.lazy) lazyCount += 1;
  }
  return result;
}

function classifyDirectoryPath(
  entries: FileTreeEntry[],
  targetPath: string,
  loadedDirectories: ReadonlySet<string>,
): { status: 'present' | 'deferred' | 'missing'; lazy: boolean } {
  const parts = targetPath.split('/');
  let level = entries;
  let accumulated = '';
  let lazy = false;
  for (let index = 0; index < parts.length; index += 1) {
    accumulated = accumulated ? `${accumulated}/${parts[index]}` : parts[index]!;
    const entry = level.find((candidate) => candidate.path === accumulated);
    if (!entry || entry.type !== 'directory') return { status: 'missing', lazy };
    lazy ||= entry.ignored === true;
    if (index === parts.length - 1) return { status: 'present', lazy };
    if (entry.ignored === true && entry.children.length === 0 && !loadedDirectories.has(entry.path)) {
      return { status: 'deferred', lazy: true };
    }
    level = entry.children;
  }
  return { status: 'missing', lazy };
}

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdx)$/i.test(path);
}

export function isHtmlPath(path: string): boolean {
  return /\.(?:html?|xhtml)$/i.test(path);
}

export function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent.replace(/\/+$/, '')}/`);
}

export function parentDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

/** Reparenting policy for internal file-tree drops; this never implies sibling ordering. */
export function canMovePathsToDirectory(sourcePaths: readonly string[], targetDirectory: string): boolean {
  return sourcePaths.length > 0
    && !sourcePaths.some((sourcePath) => pathContains(sourcePath, targetDirectory))
    && sourcePaths.some((sourcePath) => parentDirectory(sourcePath) !== targetDirectory);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]')
    || target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

export function fileHistoryShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return null;
  return event.shiftKey ? 'redo' : 'undo';
}
