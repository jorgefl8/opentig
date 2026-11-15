import { describe, expect, it } from 'vitest';
import { contentHash, fileHighlightKey } from './highlight-cache-key';

describe('highlight cache keys', () => {
  it('gives the same text the same key and any other text another one', () => {
    const text = 'export const answer = 42;\n'.repeat(400);
    expect(contentHash(text)).toBe(contentHash(`${text}`));
    // Same length, one character apart, at either end and in the middle.
    for (const index of [0, text.length >> 1, text.length - 1]) {
      const changed = `${text.slice(0, index)}#${text.slice(index + 1)}`;
      expect(contentHash(changed)).not.toBe(contentHash(text));
    }
    expect(contentHash('ab')).not.toBe(contentHash('ba'));
    expect(contentHash('')).not.toBe(contentHash('\n'));
  });

  it('keeps two files with the same text apart, since each is read with its own grammar', () => {
    expect(fileHighlightKey('src/a.ts', 'x')).toBe(fileHighlightKey('src/a.ts', 'x'));
    expect(fileHighlightKey('src/a.ts', 'x')).not.toBe(fileHighlightKey('src/a.py', 'x'));
    expect(fileHighlightKey('src/a.ts', 'x')).not.toBe(fileHighlightKey('src/a.ts', 'y'));
  });
});
