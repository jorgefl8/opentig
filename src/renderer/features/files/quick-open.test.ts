import { describe, expect, it } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';
import { collectQuickOpenFiles, createQuickOpenIndex, rankQuickOpenFiles, rankQuickOpenIndex } from './quick-open';

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

const file = (path: string, ignored = false): FileTreeEntry => ({ path, name: path.split(/[\\/]/).at(-1)!, type: 'file', ignored, size: 1, mtimeMs: 0 });

describe('Quick Open snapshot index', () => {
  it('keeps ignored ancestry and active-file visibility when toggling options on one index', () => {
    const index = createQuickOpenIndex([
      file('visible.txt'),
      { path: 'ignored', name: 'ignored', type: 'directory', ignored: true, children: [file('ignored/child.txt')] },
      file('hidden.txt', true),
    ]);
    expect(rankQuickOpenIndex(index, '', { includeIgnored: false, activePath: 'ignored/child.txt' }).map((item) => item.path)).toEqual(['visible.txt']);
    expect(rankQuickOpenIndex(index, '', { includeIgnored: true, activePath: 'ignored/child.txt', limit: 2 }).map((item) => item.path)).toEqual(['ignored/child.txt', 'hidden.txt']);
    expect(rankQuickOpenIndex(index, 'child', { includeIgnored: false })).toEqual([]);
    expect(rankQuickOpenIndex(index, 'child', { includeIgnored: true })[0]?.path).toBe('ignored/child.txt');
  });

  it('replaces paths and ignored metadata with the next immutable snapshot', () => {
    const before = createQuickOpenIndex([file('old.txt'), file('secret.txt', true)]);
    const after = createQuickOpenIndex([file('renamed.txt'), file('secret.txt')]);
    expect(rankQuickOpenIndex(before, '', { includeIgnored: false }).map((item) => item.path)).toEqual(['old.txt']);
    expect(rankQuickOpenIndex(after, '', { includeIgnored: false }).map((item) => item.path)).toEqual(['renamed.txt', 'secret.txt']);
    expect(rankQuickOpenIndex(after, 'old', { includeIgnored: true })).toEqual([]);
  });

  it('keeps depth, locale, case and stable ties, and never boosts an active path for a nonempty query', () => {
    const index = createQuickOpenIndex([
      file('z/App.tsx'), file('a/deeper/App.tsx'), file('a/App.tsx'), file('a/app.tsx'),
      file('a/Ápp.tsx'), file('windows\\App.tsx'), file('a/App.tsx'),
    ]);
    const paths = rankQuickOpenIndex(index, 'app.tsx', { includeIgnored: true, activePath: 'z/App.tsx' }).map((item) => item.path);
    // The original depth rule counts '/' before normalized Windows separators.
    expect(paths).toEqual(['windows\\App.tsx', 'a/app.tsx', 'a/App.tsx', 'a/App.tsx', 'z/App.tsx', 'a/deeper/App.tsx', 'a/Ápp.tsx']);
    expect(rankQuickOpenIndex(index, 'ÁPP', { includeIgnored: true }).map((item) => item.path)).toEqual(['a/Ápp.tsx']);
    expect(rankQuickOpenIndex(index, 'windows/app', { includeIgnored: true })[0]?.path).toBe('windows\\App.tsx');
  });

  it('returns exactly the sorted prefix for limits spanning heap replacements and ties', () => {
    const entries = Array.from({ length: 600 }, (_, i) => file(`${i % 3 ? 'src/deep' : 'test'}/${i % 2 ? 'App' : 'Apple'}${599 - i}.tsx`, i % 17 === 0));
    const index = createQuickOpenIndex(entries);
    for (const includeIgnored of [true, false]) {
      for (const query of ['', 'app', 'p', 's d a 2', 'not-present']) {
        const all = rankQuickOpenIndex(index, query, { includeIgnored, activePath: entries[100]!.path, limit: Infinity });
        for (const limit of [0, -1, 1, 2, 9, 100, 100.9, 1000]) {
          expect(rankQuickOpenIndex(index, query, { includeIgnored, activePath: entries[100]!.path, limit })).toEqual(all.slice(0, Math.max(0, Math.floor(limit))));
        }
      }
    }
  });
});
