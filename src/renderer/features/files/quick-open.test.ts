import { describe, expect, it } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';
import { collectQuickOpenFiles, rankQuickOpenFiles } from './quick-open';

const tree: FileTreeEntry[] = [
  {
    path: 'src', name: 'src', type: 'directory', children: [
      { path: 'src/App.tsx', name: 'App.tsx', type: 'file', size: 10, mtimeMs: 1 },
      {
        path: 'src/components', name: 'components', type: 'directory', children: [
          { path: 'src/components/Button.tsx', name: 'Button.tsx', type: 'file', size: 10, mtimeMs: 1 },
          { path: 'src/components/AppButton.tsx', name: 'AppButton.tsx', type: 'file', size: 10, mtimeMs: 1 },
        ],
      },
    ],
  },
  {
    path: 'test', name: 'test', type: 'directory', children: [
      { path: 'test/App.tsx', name: 'App.tsx', type: 'file', size: 10, mtimeMs: 1 },
    ],
  },
  { path: '.env', name: '.env', type: 'file', size: 5, mtimeMs: 1, ignored: true },
  { path: 'README.md', name: 'README.md', type: 'file', size: 20, mtimeMs: 1 },
  { path: 'empty', name: 'empty', type: 'directory', children: [] },
];

describe('Quick Open model', () => {
  it('collects only represented files and applies ignored visibility', () => {
    expect(collectQuickOpenFiles(tree, false).map((item) => item.path)).toEqual([
      'src/App.tsx', 'src/components/Button.tsx', 'src/components/AppButton.tsx', 'test/App.tsx', 'README.md',
    ]);
    expect(collectQuickOpenFiles(tree, true).map((item) => item.path)).toContain('.env');
    expect(collectQuickOpenFiles(tree, true)).not.toContainEqual(expect.objectContaining({ path: 'empty' }));
  });

  it('ranks exact basename, prefix, basename substring, then path substring', () => {
    const exact = rankQuickOpenFiles(tree, 'app.tsx', { includeIgnored: false });
    expect(exact.slice(0, 2).map((item) => item.path)).toEqual(['src/App.tsx', 'test/App.tsx']);

    const prefix = rankQuickOpenFiles(tree, 'app', { includeIgnored: false });
    expect(prefix.map((item) => item.path)).toEqual(['src/App.tsx', 'test/App.tsx', 'src/components/AppButton.tsx']);

    const substring = rankQuickOpenFiles(tree, 'button', { includeIgnored: false });
    expect(substring.map((item) => item.path)).toEqual(['src/components/Button.tsx', 'src/components/AppButton.tsx']);

    expect(rankQuickOpenFiles(tree, 'components/', { includeIgnored: false }).map((item) => item.path)).toEqual([
      'src/components/Button.tsx', 'src/components/AppButton.tsx',
    ]);
  });

  it('supports case-insensitive filename and path subsequences and rejects non-matches', () => {
    expect(rankQuickOpenFiles(tree, 'BTTSX', { includeIgnored: false })[0]?.path).toBe('src/components/Button.tsx');
    expect(rankQuickOpenFiles(tree, 'scab', { includeIgnored: false })[0]?.path).toBe('src/components/AppButton.tsx');
    expect(rankQuickOpenFiles(tree, 'not-present', { includeIgnored: false })).toEqual([]);
  });

  it('uses deterministic path tie breaks for duplicate basenames', () => {
    expect(rankQuickOpenFiles(tree, 'App.tsx', { includeIgnored: false }).slice(0, 2).map((item) => item.path)).toEqual([
      'src/App.tsx', 'test/App.tsx',
    ]);
  });

  it('puts the active file first for an empty query and enforces the limit', () => {
    expect(rankQuickOpenFiles(tree, '', { includeIgnored: false, activePath: 'test/App.tsx', limit: 2 }).map((item) => item.path)).toEqual([
      'test/App.tsx', 'README.md',
    ]);
    expect(rankQuickOpenFiles(tree, '', { includeIgnored: true, limit: 1 })).toHaveLength(1);
    expect(rankQuickOpenFiles(tree, '', { includeIgnored: true, limit: 0 })).toEqual([]);
  });

  it('includes ignored files only when requested', () => {
    expect(rankQuickOpenFiles(tree, '.env', { includeIgnored: false })).toEqual([]);
    expect(rankQuickOpenFiles(tree, '.env', { includeIgnored: true })[0]?.path).toBe('.env');
  });
});
