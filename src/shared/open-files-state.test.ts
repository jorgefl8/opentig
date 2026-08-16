import { describe, expect, it } from 'vitest';
import {
  MAX_OPEN_FILE_TABS,
  MAX_OPEN_FILES_REPOSITORIES,
  normalizeOpenFilePath,
  normalizeOpenFilesState,
  normalizeOpenFilesStates,
  normalizeOpenFileTabs,
  upsertOpenFilesState,
} from './open-files-state';

const ID = '0123456789abcdef';
const OTHER_ID = 'fedcba9876543210';
const AT = '2026-02-01T00:00:00.000Z';

const tab = (path: string, pinned = false) => ({ path, pinned });

describe('open files persistence model', () => {
  it('normalizes safe relative paths and rejects unsafe paths', () => {
    expect(normalizeOpenFilePath('src\\renderer\\')).toBe('src/renderer');
    for (const value of ['', '/root', 'C:/root', '../root', 'src/../root', 'src//root', 'bad\npath', 'nul\0path']) {
      expect(normalizeOpenFilePath(value)).toBeNull();
    }
    expect(normalizeOpenFilePath('x'.repeat(2_049))).toBeNull();
  });

  it('keeps hand-chosen tab order instead of sorting it', () => {
    const tabs = normalizeOpenFileTabs([tab('src/deep/nested.ts'), tab('a.ts'), tab('src/b.ts')]);
    expect(tabs.map((item) => item.path)).toEqual(['src/deep/nested.ts', 'a.ts', 'src/b.ts']);
  });

  it('drops duplicates, invalid entries, and excess tabs deterministically', () => {
    const tabs = normalizeOpenFileTabs([tab('a.ts'), null, tab('../bad.ts'), tab('a.ts', true), tab('b.ts')]);
    expect(tabs).toEqual([tab('a.ts'), tab('b.ts')]);

    const many = Array.from({ length: MAX_OPEN_FILE_TABS + 5 }, (_, index) => tab(`file-${index}.ts`));
    const capped = normalizeOpenFileTabs(many);
    expect(capped).toHaveLength(MAX_OPEN_FILE_TABS);
    expect(capped[0]?.path).toBe('file-0.ts');
  });

  it('bounds the total path character budget', () => {
    const tabs = Array.from({ length: 40 }, (_, index) => tab(`${index.toString().padStart(3, '0')}-${'x'.repeat(2_000)}.ts`));
    const result = normalizeOpenFileTabs(tabs);
    expect(result.reduce((total, item) => total + item.path.length, 0)).toBeLessThanOrEqual(64 * 1024);
    expect(result.length).toBeLessThan(tabs.length);
  });

  it('migrates absent or corrupt state without inventing records', () => {
    expect(normalizeOpenFilesStates(undefined)).toEqual([]);
    expect(normalizeOpenFilesStates({ nope: true })).toEqual([]);
    expect(normalizeOpenFilesStates([null, { repositoryId: 'bad', tabs: [tab('a.ts')], updatedAt: AT }])).toEqual([]);
    expect(normalizeOpenFilesState({ repositoryId: ID, tabs: [tab('a.ts')], updatedAt: 'today' })).toBeNull();
    expect(normalizeOpenFilesState({ repositoryId: ID, tabs: [], updatedAt: AT })).toBeNull();
  });

  it('resolves the active path and falls back to the last retained tab', () => {
    const state = normalizeOpenFilesState({ repositoryId: ID, tabs: [tab('a.ts'), tab('b.ts')], activePath: 'b.ts', previewPath: null, updatedAt: AT });
    expect(state?.activePath).toBe('b.ts');

    const orphaned = normalizeOpenFilesState({ repositoryId: ID, tabs: [tab('a.ts'), tab('b.ts')], activePath: 'gone.ts', previewPath: null, updatedAt: AT });
    expect(orphaned?.activePath).toBe('b.ts');
  });

  it('drops a preview that is missing, pinned, or contradictory', () => {
    const missing = normalizeOpenFilesState({ repositoryId: ID, tabs: [tab('a.ts')], activePath: 'a.ts', previewPath: 'gone.ts', updatedAt: AT });
    expect(missing?.previewPath).toBeNull();

    const pinned = normalizeOpenFilesState({ repositoryId: ID, tabs: [tab('a.ts', true)], activePath: 'a.ts', previewPath: 'a.ts', updatedAt: AT });
    expect(pinned?.previewPath).toBeNull();
    expect(pinned?.tabs).toEqual([tab('a.ts', true)]);

    const valid = normalizeOpenFilesState({ repositoryId: ID, tabs: [tab('a.ts', true), tab('b.ts')], activePath: 'b.ts', previewPath: 'b.ts', updatedAt: AT });
    expect(valid?.previewPath).toBe('b.ts');
  });

  it('keeps the newest record per worktree and never merges worktrees', () => {
    const result = normalizeOpenFilesStates([
      { repositoryId: ID, tabs: [tab('old.ts')], activePath: 'old.ts', previewPath: null, updatedAt: '2026-01-01T00:00:00.000Z' },
      { repositoryId: ID, tabs: [tab('new.ts')], activePath: 'new.ts', previewPath: null, updatedAt: AT },
      { repositoryId: OTHER_ID, tabs: [tab('other.ts')], activePath: 'other.ts', previewPath: null, updatedAt: AT },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((state) => state.repositoryId === ID)?.tabs).toEqual([tab('new.ts')]);
    expect(result.find((state) => state.repositoryId === OTHER_ID)?.tabs).toEqual([tab('other.ts')]);
  });

  it('upserts immutably, removes empty records, and prunes least-recent worktrees', () => {
    const original = normalizeOpenFilesStates([
      { repositoryId: ID, tabs: [tab('old.ts')], activePath: 'old.ts', previewPath: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const updated = upsertOpenFilesState(original, ID, [tab('src/a.ts'), tab('src/b.ts', true)], 'src/b.ts', 'src/a.ts', '2026-03-01T00:00:00.000Z');
    expect(updated[0]?.tabs.map((item) => item.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(updated[0]?.activePath).toBe('src/b.ts');
    expect(original[0]?.tabs).toEqual([tab('old.ts')]);

    expect(upsertOpenFilesState(updated, ID, [], null, null, '2026-04-01T00:00:00.000Z')).toEqual([]);

    const many = Array.from({ length: MAX_OPEN_FILES_REPOSITORIES + 2 }, (_, index) => ({
      repositoryId: index.toString(16).padStart(16, '0'),
      tabs: [tab('a.ts')],
      activePath: 'a.ts',
      previewPath: null,
      updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));
    const pruned = normalizeOpenFilesStates(many);
    expect(pruned).toHaveLength(MAX_OPEN_FILES_REPOSITORIES);
    expect(pruned.some((state) => state.repositoryId === '0000000000000000')).toBe(false);
  });
});
