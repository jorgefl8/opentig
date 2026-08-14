import { describe, expect, it } from 'vitest';
import {
  MAX_FILES_TREE_PATHS,
  MAX_FILES_TREE_REPOSITORIES,
  normalizeExpandedPaths,
  normalizeFilesTreePath,
  normalizeFilesTreeStates,
  upsertFilesTreeState,
} from './files-tree-state';

const ID = '0123456789abcdef';

describe('files tree persistence model', () => {
  it('normalizes safe relative paths and rejects unsafe paths', () => {
    expect(normalizeFilesTreePath('src\\renderer\\')).toBe('src/renderer');
    for (const value of ['', '/root', 'C:/root', '../root', 'src/../root', 'src//root', 'bad\npath']) {
      expect(normalizeFilesTreePath(value)).toBeNull();
    }
  });

  it('deduplicates, orders shallow paths first, and caps the list', () => {
    const ordered = normalizeExpandedPaths(['src/deep', 'src', 'src']);
    expect(ordered).toEqual(['src', 'src/deep']);
    const many = Array.from({ length: MAX_FILES_TREE_PATHS + 5 }, (_, index) => `folder-${index}`);
    const result = normalizeExpandedPaths(many);
    expect(result).toHaveLength(MAX_FILES_TREE_PATHS);
  });

  it('bounds the total path character budget', () => {
    const paths = Array.from({ length: 100 }, (_, index) => `${index.toString().padStart(3, '0')}-${'x'.repeat(1_000)}`);
    const result = normalizeExpandedPaths(paths);
    expect(result.reduce((total, item) => total + item.length, 0)).toBeLessThanOrEqual(64 * 1024);
    expect(result.length).toBeLessThan(paths.length);
  });

  it('migrates absent or corrupt state without inventing records', () => {
    expect(normalizeFilesTreeStates(undefined)).toEqual([]);
    expect(normalizeFilesTreeStates({ nope: true })).toEqual([]);
    expect(normalizeFilesTreeStates([null, { repositoryId: 'bad', expandedPaths: ['src'], updatedAt: 'today' }])).toEqual([]);
  });

  it('keeps the newest duplicate and valid paths from mixed input', () => {
    const result = normalizeFilesTreeStates([
      { repositoryId: ID, expandedPaths: ['old'], updatedAt: '2026-01-01T00:00:00.000Z' },
      { repositoryId: ID, expandedPaths: ['src', '../bad'], updatedAt: '2026-02-01T00:00:00.000Z' },
    ]);
    expect(result).toEqual([{ repositoryId: ID, expandedPaths: ['src'], updatedAt: '2026-02-01T00:00:00.000Z' }]);
  });

  it('upserts immutably, removes empty records, and prunes least-recent records', () => {
    const original = [{ repositoryId: ID, expandedPaths: ['old'], updatedAt: '2026-01-01T00:00:00.000Z' }];
    const updated = upsertFilesTreeState(original, ID, ['src'], '2026-03-01T00:00:00.000Z');
    expect(updated[0]?.expandedPaths).toEqual(['src']);
    expect(original[0]?.expandedPaths).toEqual(['old']);
    expect(upsertFilesTreeState(updated, ID, [], '2026-04-01T00:00:00.000Z')).toEqual([]);

    const many = Array.from({ length: MAX_FILES_TREE_REPOSITORIES + 2 }, (_, index) => ({
      repositoryId: index.toString(16).padStart(16, '0'),
      expandedPaths: ['src'],
      updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));
    const pruned = normalizeFilesTreeStates(many);
    expect(pruned).toHaveLength(MAX_FILES_TREE_REPOSITORIES);
    expect(pruned.some((state) => state.repositoryId === '0000000000000000')).toBe(false);
  });
});
