import { describe, expect, it } from 'vitest';
import type { CommitFile } from '../../shared/git-types';
import { allocatePullRequestPatch } from './PullRequestPatch';

const file = (path: string): CommitFile => ({ path, oldPath: null, kind: 'modified', additions: 2, deletions: 1, binary: false });
const header = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
const hunk = (line: number, content: string) => `@@ -${line},1 +${line},2 @@\n-old\n+${content}\n+new\n`;

describe('pull-request patch allocation', () => {
  it('retains an unchanged patch and file metadata when it fits', () => {
    const patch = header('a.ts') + hunk(1, 'value');
    const result = allocatePullRequestPatch(patch, [file('a.ts')], patch.length);
    expect(result.value).toBe(patch);
    expect(result.files[0]).toMatchObject({ detail: 'complete', omittedHunks: 0, omittedChangedLines: 0 });
  });

  it('redistributes small files and includes separated hunks in original order', () => {
    const small = header('small.ts') + hunk(1, 'small');
    const large = header('large.ts') + hunk(1, 'first') + hunk(20, 'x'.repeat(1000)) + hunk(50, 'last');
    const result = allocatePullRequestPatch(small + large, [file('small.ts'), file('large.ts')], 350);
    expect(result.value.length).toBeLessThanOrEqual(350);
    expect(result.value).toContain(small);
    expect(result.value).toContain('+first');
    expect(result.value).toContain('+last');
    expect(result.value.indexOf('+first')).toBeLessThan(result.value.indexOf('+last'));
    expect(result.value).toContain('[hunk content omitted by OpenTig]');
    expect(result.files[1]).toMatchObject({ detail: 'partial', omittedHunks: 1 });
    expect(result.files[1]!.omittedChangedLines).toBeGreaterThan(0);
  });

  it('labels a fragment of a huge hunk and never cuts a line or surrogate pair', () => {
    const patch = header('unicode.ts') + '@@ -1,0 +1,100 @@\n' + '+🙂 value\n'.repeat(100);
    const result = allocatePullRequestPatch(patch, [file('unicode.ts')], 180);
    expect(result.value.length).toBeLessThanOrEqual(180);
    expect(result.value).toContain('+🙂 value\n');
    expect(result.files[0]).toMatchObject({ detail: 'partial', omittedHunks: 1 });
    expect(result.value).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });

  it.each([0, 1, 10, 40, 70, 120])('keeps a strict %i-character cap even when headers do not fit', budget => {
    const patch = header('a.ts') + hunk(1, 'one') + header('b.ts') + hunk(1, 'two');
    const result = allocatePullRequestPatch(patch, [file('a.ts'), file('b.ts')], budget);
    expect(result.value.length).toBeLessThanOrEqual(budget);
    expect(result.files.map(f => f.path)).toEqual(['a.ts', 'b.ts']);
    if (budget < 70) expect(result.files.every(f => f.detail === 'inventory-only')).toBe(true);
  });

  it('counts removed lines that resemble file headers', () => {
    const patch = header('a.ts') + '@@ -1 +1 @@\n--- text\n+++ text\n';
    const result = allocatePullRequestPatch(patch, [file('a.ts')], 0);
    expect(result.files[0]!.omittedChangedLines).toBe(2);
  });

  it('keeps binary metadata without pretending to send binary content', () => {
    const patch = 'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n';
    const result = allocatePullRequestPatch(patch, [{ ...file('image.png'), binary: true, additions: 0, deletions: 0 }], 1000);
    expect(result.files[0]).toMatchObject({ binary: true, detail: 'complete', omittedChangedLines: 0 });
  });

  it('rejects inconsistent inventory rather than reporting missing files as complete', () => {
    expect(() => allocatePullRequestPatch(header('a.ts'), [], 1000)).toThrow(/inventory/);
  });
});
