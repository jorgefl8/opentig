import { describe, expect, it } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';
import {
  canOpenPinnedDrop,
  containsPath,
  canMovePathsToDirectory,
  fileSnapshotFingerprint,
  filterIgnoredEntries,
  fileHistoryShortcut,
  findEntry,
  isHtmlPath,
  isMarkdownPath,
  mergeLoadedDirectories,
  parentDirectory,
  pathContains,
  persistableExpandedPaths,
  reconcileExpandedPaths,
  replaceLoadedDirectoryLevels,
  selectedFileChanged,
  snapshotPathPresence,
} from './file-tree';

const tree: FileTreeEntry[] = [
  {
    path: 'docs',
    name: 'docs',
    type: 'directory',
    children: [
      { path: 'docs/README.MD', name: 'README.MD', type: 'file', size: 10, mtimeMs: 1 },
      { path: 'docs/.env.test', name: '.env.test', type: 'file', size: 5, mtimeMs: 1, ignored: true },
    ],
  },
  { path: '.venv', name: '.venv', type: 'directory', ignored: true, children: [] },
  { path: 'empty', name: 'empty', type: 'directory', children: [] },
  { path: 'main.ts', name: 'main.ts', type: 'file', size: 20, mtimeMs: 1 },
];

describe('file tree helpers', () => {
  it('opens only a single dragged file beside the current tab', () => {
    const file = tree.find((entry) => entry.path === 'main.ts')!;
    const directory = tree.find((entry) => entry.path === 'docs')!;

    expect(canOpenPinnedDrop(file, ['main.ts'])).toBe(true);
    expect(canOpenPinnedDrop(file, ['main.ts', 'docs/README.MD'])).toBe(false);
    expect(canOpenPinnedDrop(file, ['docs/README.MD'])).toBe(false);
    expect(canOpenPinnedDrop(directory, ['docs'])).toBe(false);
  });

  it('allows reparenting one item, a multi-selection, and movement to root', () => {
    expect(canMovePathsToDirectory(['src/app.ts'], 'docs')).toBe(true);
    expect(canMovePathsToDirectory(['src/app.ts', 'src/lib.ts'], 'docs')).toBe(true);
    expect(canMovePathsToDirectory(['docs/guide.md'], '')).toBe(true);
  });

  it('rejects same-parent, self, and descendant targets', () => {
    expect(canMovePathsToDirectory(['src/app.ts'], 'src')).toBe(false);
    expect(canMovePathsToDirectory(['src'], 'src')).toBe(false);
    expect(canMovePathsToDirectory(['src'], 'src/nested')).toBe(false);
  });

  it('allows a mixed selection when at least one item changes parent', () => {
    expect(canMovePathsToDirectory(['docs/guide.md', 'src/app.ts'], 'docs')).toBe(true);
    expect(canMovePathsToDirectory([], 'docs')).toBe(false);
  });

  it('finds nested entries and missing paths', () => {
    expect(findEntry(tree, 'docs/README.MD')).toMatchObject({ type: 'file' });
    expect(containsPath(tree, 'missing.md')).toBe(false);
  });

  it('does not treat descendants of collapsed ignored folders as deleted', () => {
    expect(snapshotPathPresence(tree, 'docs/README.MD')).toBe('present');
    expect(snapshotPathPresence(tree, '.venv')).toBe('present');
    expect(snapshotPathPresence(tree, '.venv/lib/pkg.py')).toBe('deferred');
    expect(snapshotPathPresence(tree, 'docs/missing.md')).toBe('missing');
    expect(snapshotPathPresence(tree, 'missing/file.md')).toBe('missing');
  });

  it('maps contextual Files undo and redo shortcuts', () => {
    const event = (value: Partial<KeyboardEvent>) => ({ key: 'z', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...value } as KeyboardEvent);
    expect(fileHistoryShortcut(event({ ctrlKey: true }))).toBe('undo');
    expect(fileHistoryShortcut(event({ ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(fileHistoryShortcut(event({ metaKey: true }))).toBe('undo');
    expect(fileHistoryShortcut(event({ metaKey: true, shiftKey: true }))).toBe('redo');
    expect(fileHistoryShortcut(event({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(fileHistoryShortcut(event({ ctrlKey: true, key: 'y' }))).toBeNull();
  });

  it('detects metadata changes even when size is unchanged', () => {
    const changed: FileTreeEntry[] = [{
      ...tree[0]!,
      type: 'directory',
      children: [
        { path: 'docs/README.MD', name: 'README.MD', type: 'file', size: 10, mtimeMs: 2 },
      ],
    }];
    expect(selectedFileChanged(tree, changed, 'docs/README.MD')).toBe(true);
    expect(fileSnapshotFingerprint(tree)).not.toBe(fileSnapshotFingerprint(changed));
  });

  it('filters ignored files and directories without mutating the source tree', () => {
    const filtered = filterIgnoredEntries(tree);
    expect(findEntry(filtered, 'docs/.env.test')).toBeNull();
    expect(findEntry(filtered, '.venv')).toBeNull();
    expect(findEntry(filtered, 'empty')).toMatchObject({ type: 'directory', children: [] });
    expect(findEntry(filtered, 'docs/README.MD')).not.toBeNull();
    expect(findEntry(tree, 'docs/.env.test')).not.toBeNull();
    expect(findEntry(tree, '.venv')).not.toBeNull();
  });

  it('grafts lazily loaded levels onto collapsed folders without touching the rest', () => {
    const loaded = new Map<string, FileTreeEntry[]>([
      ['.venv', [{ path: '.venv/lib', name: 'lib', type: 'directory', ignored: true, children: [] }]],
      ['.venv/lib', [{ path: '.venv/lib/pkg.py', name: 'pkg.py', type: 'file', size: 2, mtimeMs: 1, ignored: true }]],
      // A folder the snapshot already filled keeps its live children.
      ['docs', []],
    ]);

    const merged = mergeLoadedDirectories(tree, loaded);

    expect(findEntry(merged, '.venv/lib/pkg.py')).toMatchObject({ type: 'file', ignored: true });
    expect(findEntry(merged, 'docs/README.MD')).not.toBeNull();
    expect(mergeLoadedDirectories(tree, new Map())).toBe(tree);
  });

  it('replaces refreshed ignored levels atomically and preserves unchanged cache identity', () => {
    const lib: FileTreeEntry = { path: '.venv/lib', name: 'lib', type: 'directory', ignored: true, children: [] };
    const pkg: FileTreeEntry = { path: '.venv/lib/pkg.py', name: 'pkg.py', type: 'file', size: 2, mtimeMs: 1, ignored: true };
    const current = new Map<string, FileTreeEntry[]>([['.venv', [lib]], ['.venv/lib', [pkg]]]);

    const unchanged = replaceLoadedDirectoryLevels(current, new Map([['.venv/lib', [pkg]]]));
    expect(unchanged).toBe(current);

    const refreshed = replaceLoadedDirectoryLevels(current, new Map([['.venv', []], ['.venv/lib', []]]));
    expect(refreshed).not.toBe(current);
    expect(current.get('.venv')).toEqual([lib]);
    expect(refreshed.get('.venv')).toEqual([]);
    expect(findEntry(mergeLoadedDirectories(tree, refreshed), '.venv/lib')).toBeNull();

    const collapsed = new Map<string, FileTreeEntry[]>();
    expect(replaceLoadedDirectoryLevels(collapsed, new Map([['.venv', [lib]]]))).toBe(collapsed);
  });

  it('fingerprints changes to a directory ignored state', () => {
    const visible: FileTreeEntry[] = [{ path: 'cache', name: 'cache', type: 'directory', children: [] }];
    const ignored: FileTreeEntry[] = [{ path: 'cache', name: 'cache', type: 'directory', ignored: true, children: [] }];

    expect(fileSnapshotFingerprint(visible)).not.toBe(fileSnapshotFingerprint(ignored));
  });

  it('recognizes markdown paths and parent relationships', () => {
    expect(isMarkdownPath('README.md')).toBe(true);
    expect(isMarkdownPath('guide.MARKDOWN')).toBe(true);
    expect(isMarkdownPath('component.mdx')).toBe(true);
    expect(isMarkdownPath('main.ts')).toBe(false);
    expect(pathContains('docs', 'docs/README.md')).toBe(true);
    expect(pathContains('doc', 'docs/README.md')).toBe(false);
    expect(parentDirectory('docs/guides/start.md')).toBe('docs/guides');
    expect(parentDirectory('README.md')).toBe('');
    expect(parentDirectory(String.raw`docs\README.md`)).toBe('docs');
  });

  it('recognizes HTML documents', () => {
    expect(isHtmlPath('index.html')).toBe(true);
    expect(isHtmlPath('legacy.HTM')).toBe(true);
    expect(isHtmlPath('document.xhtml')).toBe(true);
    expect(isHtmlPath('component.tsx')).toBe(false);
  });

  it('defers descendants until an ignored level is materialized, then prunes missing paths', () => {
    const pending = reconcileExpandedPaths(tree, ['docs', '.venv', '.venv/lib'], new Set());
    expect(pending.present).toEqual(['docs', '.venv']);
    expect(pending.deferred).toEqual(['.venv/lib']);
    expect(pending.missing).toEqual([]);

    const loadedEmpty = reconcileExpandedPaths(tree, ['.venv/lib'], new Set(['.venv']));
    expect(loadedEmpty.retained).toEqual([]);
    expect(loadedEmpty.missing).toEqual(['.venv/lib']);
  });

  it('drops deleted parents and descendants without mutating expansion input', () => {
    const expanded = new Set(['docs', 'docs/guides', 'missing']);
    const result = reconcileExpandedPaths(tree, expanded, new Set());
    expect(result.retained).toEqual(['docs']);
    expect(result.missing).toEqual(['docs/guides', 'missing']);
    expect([...expanded]).toEqual(['docs', 'docs/guides', 'missing']);
  });

  it('serializes shallow expansions deterministically and limits lazy paths', () => {
    const ignored: FileTreeEntry[] = Array.from({ length: 25 }, (_, index) => ({
      path: `cache-${index}`,
      name: `cache-${index}`,
      type: 'directory' as const,
      ignored: true,
      children: [],
    }));
    const entries = [...tree, ...ignored];
    const persisted = persistableExpandedPaths(entries, ['docs', ...ignored.map((entry) => entry.path)], new Set());
    expect(persisted).toContain('docs');
    expect(persisted.filter((path) => path.startsWith('cache-'))).toHaveLength(20);
    expect(persisted).toEqual([...persisted].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right)));
  });
});
