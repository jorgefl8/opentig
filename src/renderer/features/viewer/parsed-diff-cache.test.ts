import { expect, it } from 'vitest';
import { ParsedDiffCache, estimateParsedDiffBytes, PARSED_DIFF_CACHE_MAX_BYTES } from './parsed-diff-cache';
import { buildDiffFileEntries } from './patch-utils';
import { largePatch } from './diff-parser.fixtures';

it('budgets source, parsed lines and metadata rather than counting patches alone', () => {
  const patch = largePatch(10_001);
  const files = buildDiffFileEntries(patch);
  const cache = new ParsedDiffCache();
  expect(estimateParsedDiffBytes(patch, files)).toBeGreaterThan(patch.length * 4);
  expect(cache.set(patch, files)).toBe(true);
  expect(cache.bytes).toBe(estimateParsedDiffBytes(patch, files));
  const tooLarge = largePatch(20_000);
  expect(cache.set(tooLarge, buildDiffFileEntries(tooLarge))).toBe(false);
  expect(cache.get(tooLarge)).toBeUndefined();
  expect(cache.size).toBe(1);
});

it('promotes reads and evicts old models within entry and byte budgets', () => {
  const cache = new ParsedDiffCache();
  const patches = Array.from({ length: 5 }, (_, i) => largePatch(8_000, 24, `file-${i}.ts`));
  for (const patch of patches.slice(0, 4)) expect(cache.set(patch, buildDiffFileEntries(patch))).toBe(true);
  expect(cache.get(patches[0]!)).toBeDefined();
  expect(cache.set(patches[4]!, buildDiffFileEntries(patches[4]!))).toBe(true);
  expect(cache.get(patches[1]!)).toBeUndefined();
  expect(cache.get(patches[0]!)).toBeDefined();
  expect(cache.size).toBe(4);
  expect(cache.bytes).toBeLessThanOrEqual(PARSED_DIFF_CACHE_MAX_BYTES);
  cache.clear();
  expect(cache.bytes).toBe(0);
  expect(cache.size).toBe(0);
});

it('isolates mutable Pierre metadata on both insertion and retrieval', () => {
  const patch = largePatch(2);
  const files = buildDiffFileEntries(patch);
  const cache = new ParsedDiffCache();
  cache.set(patch, files);
  files[0]!.fileDiff.additionLines[0] = 'mutated input';
  files[0]!.fileDiff.hunks[0]!.additionLines = 99;
  const read = cache.get(patch)!;
  expect(read).toEqual(buildDiffFileEntries(patch));
  read[0]!.fileDiff.hunks[0]!.hunkContent.length = 0;
  read[0]!.fileDiff.additionLines.length = 0;
  expect(cache.get(patch)).toEqual(buildDiffFileEntries(patch));
});

it('evicts by estimated bytes before reaching the entry count limit', () => {
  const cache = new ParsedDiffCache();
  const patches = Array.from({ length: 3 }, (_, i) => largePatch(15_000, 24, `large-${i}.ts`));
  for (const patch of patches) expect(cache.set(patch, buildDiffFileEntries(patch))).toBe(true);
  expect(cache.size).toBe(2);
  expect(cache.get(patches[0]!)).toBeUndefined();
  expect(cache.bytes).toBeLessThanOrEqual(PARSED_DIFF_CACHE_MAX_BYTES);
});
