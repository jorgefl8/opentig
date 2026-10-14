/** Synthetic unified patches shared by parser regression tests. */
export function largePatch(lines = 10_001, width = 24, name = 'large.ts'): string {
  return `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines} @@\n`
    + Array.from({ length: lines }, (_, index) => `+${String(index).padEnd(width, 'x')}\n`).join('');
}

export const MIXED_PATCH = `diff --git a/old.ts b/new.ts
similarity index 80%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1 +1,2 @@
-old
+new
+<<<<<<< HEAD
diff --git a/old.txt b/moved.txt
similarity index 100%
rename from old.txt
rename to moved.txt
diff --git a/image.png b/image.png
index 1234567..7654321 100644
Binary files a/image.png and b/image.png differ
diff --git a/removed.txt b/removed.txt
deleted file mode 100644
--- a/removed.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
`;
