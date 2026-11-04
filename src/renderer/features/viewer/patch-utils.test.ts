import { describe, expect, it } from 'vitest';
import { buildDiffFileEntries, patchLineStats, splitPatchFiles } from './patch-utils';

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
