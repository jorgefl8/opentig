import { describe, expect, it } from 'vitest';
import { buildDiffFileEntries, diffChangeKind, patchLineStats, splitCommitPatch, splitPatchFiles } from './patch-utils';

const PATCH = `diff --git a/src/old.ts b/src/new.ts
similarity index 80%
rename from src/old.ts
rename to src/new.ts
index 7898192..6178079 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,2 +1,3 @@
-const oldName = true;
+const newName = true;
+const extra = true;
 export {};
diff --git a/README.md b/README.md
index ce01362..94954ab 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-hello
+hello world
`;

describe('patch utilities', () => {
  it('splits a multi-file patch without losing file headers', () => {
    const files = splitPatchFiles(PATCH);
    expect(files).toHaveLength(2);
    expect(files[0]).toContain('diff --git a/src/old.ts b/src/new.ts');
    expect(files[1]).toContain('diff --git a/README.md b/README.md');
  });

  it('builds paths, rename metadata, and per-file statistics', () => {
    const files = buildDiffFileEntries(PATCH);
    expect(files).toMatchObject([
      { path: 'src/new.ts', previousPath: 'src/old.ts', additions: 2, deletions: 1, changeType: 'rename-changed' },
      { path: 'README.md', additions: 1, deletions: 1, changeType: 'change' },
    ]);
  });
});

describe('diff highlight keys', () => {
  const keys = (patch: string) => buildDiffFileEntries(patch).map((file) => file.fileDiff.cacheKey);

  it('gives a file the same key each time its patch is parsed, so its highlighting is found again', () => {
    expect(keys(PATCH)).toEqual(keys(PATCH));
    expect(new Set(keys(PATCH)).size).toBe(2);
  });

  it('changes only the key of the file a refresh changed', () => {
    const [source, readme] = keys(PATCH);
    const [refreshedSource, refreshedReadme] = keys(PATCH.replace('+hello world', '+hello there'));
    expect(refreshedSource).toBe(source);
    expect(refreshedReadme).not.toBe(readme);
  });

  it('keeps the same lines apart when another grammar reads them', () => {
    const [typescript] = keys(PATCH);
    const [python] = keys(PATCH.replaceAll('.ts', '.py'));
    const [renamedTypescript] = keys(PATCH.replaceAll('new.ts', 'next.ts'));
    expect(python).not.toBe(typescript);
    expect(python).toContain('python');
    expect(renamedTypescript).not.toBe(typescript);
  });
});

describe('patchLineStats', () => {
  it('counts added and removed lines, not the file headers', () => {
    expect(patchLineStats('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n-one\n+uno\n same\n+more\n')).toEqual({ additions: 2, deletions: 1 });
  });

  it('counts lines that look like headers inside a hunk, across files', () => {
    expect(patchLineStats('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n--- removed\n+++ added\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-x\n+y')).toEqual({ additions: 2, deletions: 2 });
  });

  it('finds nothing in an empty patch', () => {
    expect(patchLineStats('')).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('file status in a patch', () => {
  const ADDED = 'diff --git a/src/fresh.ts b/src/fresh.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/src/fresh.ts\n@@ -0,0 +1 @@\n+fresh\n';
  const DELETED = 'diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n';
  const MOVED = 'diff --git a/old.txt b/moved.txt\nsimilarity index 100%\nrename from old.txt\nrename to moved.txt\n';
  const BINARY = 'diff --git a/logo.png b/logo.png\nnew file mode 100644\nindex 0000000..2222222\nBinary files /dev/null and b/logo.png differ\n';
  // A text file may quote Git's own wording; only the patch's metadata line means binary.
  const QUOTES_GIT = 'diff --git a/notes.md b/notes.md\nindex 1111111..2222222 100644\n--- a/notes.md\n+++ b/notes.md\n@@ -1 +1,2 @@\n Git prints:\n+Binary files a/x and b/x differ\n';

  it('names each file\'s status the way the Changes list does', () => {
    const kinds = buildDiffFileEntries(ADDED + DELETED + MOVED + PATCH).map((file) => [file.path, diffChangeKind(file.changeType)]);
    expect(kinds).toEqual([['src/fresh.ts', 'added'], ['src/gone.ts', 'deleted'], ['moved.txt', 'renamed'], ['src/new.ts', 'renamed'], ['README.md', 'modified']]);
  });

  it('marks a binary file, whose zero counts would otherwise read as an empty change', () => {
    const files = buildDiffFileEntries(BINARY + QUOTES_GIT + MOVED);
    expect(files.map((file) => [file.path, file.binary, file.additions, file.deletions])).toEqual([['logo.png', true, 0, 0], ['notes.md', false, 1, 0], ['moved.txt', false, 0, 0]]);
  });
});

describe('splitCommitPatch', () => {
  const section = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
  const listed = (path: string) => ({ path, oldPath: null, kind: 'modified' as const, additions: 1, deletions: 1, binary: false });
  const whole = (patch: string) => ({ path: 'commit', patch, binary: false, truncated: false, lineCount: 0 });

  it('gives each listed file its own part of the whole patch, and none it cannot match', () => {
    const parts = splitCommitPatch(whole(section('a.txt') + section('b.txt')), [listed('a.txt'), listed('b.txt')]);
    expect(parts.map((part) => part?.patch)).toEqual([section('a.txt'), section('b.txt')]);
    // A part that names another file is not shown under this one: that file is read on its own.
    expect(splitCommitPatch(whole(section('a.txt') + section('c.txt')), [listed('a.txt'), listed('b.txt')]).map((part) => part?.path ?? null)).toEqual(['a.txt', null]);
    expect(splitCommitPatch(whole(section('a.txt')), [listed('a.txt'), listed('b.txt')])).toEqual([null, null]);
  });
});
