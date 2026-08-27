import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../../shared/git-types';
import { buildChangeTree, collectChangePaths, flattenChangeTree } from './change-tree';

function change(path: string, kind: FileChange['kind'] = 'modified'): FileChange {
  return {
    path, kind, staged: false, unstaged: true, conflict: false,
    indexStatus: '.', worktreeStatus: 'M', submodule: '',
  };
}

describe('buildChangeTree', () => {
  it('returns an empty tree for no changes', () => {
    expect(buildChangeTree([])).toEqual([]);
  });

  it('keeps root files at the top level', () => {
    const tree = buildChangeTree([change('README.md')]);
    expect(tree).toEqual([
      { name: 'README.md', path: 'README.md', type: 'file', change: change('README.md'), children: [] },
    ]);
  });

  it('nests files under directories and sorts folders first', () => {
    const tree = buildChangeTree([
      change('src/app.ts'),
      change('src/lib/util.ts'),
      change('README.md'),
    ]);
    expect(tree.map((node) => node.name)).toEqual(['src', 'README.md']);
    expect(tree[0]?.children.map((node) => node.name)).toEqual(['lib', 'app.ts']);
    expect(tree[0]?.children[0]?.children.map((node) => node.name)).toEqual(['util.ts']);
  });
});

describe('flattenChangeTree', () => {
  it('emits folders and files in walk order', () => {
    const tree = buildChangeTree([change('src/app.ts'), change('README.md')]);
    const rows = flattenChangeTree(tree, new Set());
    expect(rows.map((row) => row.kind === 'directory' ? row.node.path : row.change.path)).toEqual([
      'src', 'src/app.ts', 'README.md',
    ]);
  });

  it('skips children of collapsed folders', () => {
    const tree = buildChangeTree([change('src/app.ts'), change('src/lib/util.ts')]);
    const rows = flattenChangeTree(tree, new Set(['src']));
    expect(rows).toEqual([{ kind: 'directory', node: tree[0]!, depth: 0 }]);
  });
});

describe('collectChangePaths', () => {
  it('collects every file path under a folder', () => {
    const tree = buildChangeTree([change('src/app.ts'), change('src/lib/util.ts')]);
    expect(collectChangePaths(tree[0]!)).toEqual(['src/lib/util.ts', 'src/app.ts']);
  });
});
