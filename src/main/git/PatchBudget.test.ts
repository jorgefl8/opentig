import { describe, expect, it } from 'vitest';
import { allocatePatchBudget } from './PatchBudget';

function section(path: string, lines: number): string {
  const body = Array.from({ length: lines }, (_, index) => `+line ${index} of ${path}`).join('\n');
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n${body}\n`;
}

describe('allocatePatchBudget', () => {
  it('returns the patch untouched when it already fits', () => {
    const patch = section('a.ts', 3) + section('b.ts', 3);
    expect(allocatePatchBudget(patch, patch.length)).toEqual({ value: patch, truncated: false });
  });

  it('keeps every file present instead of spending the budget on the first ones', () => {
    const patch = section('a.ts', 400) + section('b.ts', 400) + section('z.ts', 400);
    const result = allocatePatchBudget(patch, 1_200);

    expect(result.truncated).toBe(true);
    // The naive prefix cut would have dropped z.ts entirely.
    for (const path of ['a.ts', 'b.ts', 'z.ts']) {
      expect(result.value).toContain(`diff --git a/${path} b/${path}`);
      expect(result.value).toContain(`+line 0 of ${path}`);
    }
    expect(result.value.length).toBeLessThanOrEqual(1_200);
  });

  it('gives a small file all it needs and spends the remainder on the large one', () => {
    const small = section('small.ts', 2);
    const patch = small + section('large.ts', 500);
    const result = allocatePatchBudget(patch, small.length + 600);

    expect(result.value).toContain(small);
    expect(result.value).toContain('[diff trimmed by JustGit]');
    expect(result.value).toContain('+line 0 of large.ts');
  });

  it('cuts on a line boundary and always keeps the file header', () => {
    const result = allocatePatchBudget(section('a.ts', 200) + section('b.ts', 200), 300);
    for (const line of result.value.split('\n')) {
      expect(line === '' || line === '[diff trimmed by JustGit]' || /^[-+@d]/.test(line)).toBe(true);
    }
    expect(result.value).toContain('diff --git a/a.ts b/a.ts');
    expect(result.value).toContain('diff --git a/b.ts b/b.ts');
  });

  it('trims a single-file patch without inventing sections', () => {
    const result = allocatePatchBudget(section('only.ts', 500), 200);
    expect(result.truncated).toBe(true);
    expect(result.value).toContain('diff --git a/only.ts b/only.ts');
    expect(result.value.endsWith('[diff trimmed by JustGit]\n')).toBe(true);
  });

  it('survives a budget too small to hold even the headers', () => {
    const result = allocatePatchBudget(section('a.ts', 50) + section('b.ts', 50), 10);
    expect(result.value).toContain('diff --git a/a.ts b/a.ts');
    expect(result.value).toContain('diff --git a/b.ts b/b.ts');
    expect(result.truncated).toBe(true);
  });
});
