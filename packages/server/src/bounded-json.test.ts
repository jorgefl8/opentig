import { describe, expect, it, vi } from 'vitest';
import { JsonByteLimitError, stringifyBounded } from './bounded-json';

describe('bounded wire JSON', () => {
  it.each([
    { patch: 'a\n\t\b\r\f\\"\u0000é€😀\ud800\udc00\ud800', 'é\n': 'end' },
    { list: [undefined, NaN, Infinity, null, true, false, 1e30], omitted: undefined },
    { date: new Date('2026-01-01'), repeated: [{ id: 1 }, { id: 1 }] },
    ['a', [], {}, [1, 2]],
  ])('counts the exact native JSON UTF-8 bytes for %j', (value) => {
    const text = JSON.stringify(value);
    const bytes = Buffer.byteLength(text);
    expect(stringifyBounded(value, bytes)).toEqual({ text, bytes });
    expect(() => stringifyBounded(value, bytes - 1)).toThrow(JsonByteLimitError);
  });

  it('counts repeated object references independently', () => {
    const shared = { one: '1', two: '2' };
    const value = [shared, shared];
    const text = JSON.stringify(value);
    expect(stringifyBounded(value, Buffer.byteLength(text))).toEqual({ text, bytes: Buffer.byteLength(text) });
  });

  it('preserves exact budgets for long text with paired and lone surrogates', () => {
    for (const offset of [16_382, 16_383, 16_384, 32_767]) {
      const value = { patch: 'a'.repeat(offset) + '😀\ud800x\udc00\n' + '\u0000'.repeat(30_000) };
      const text = JSON.stringify(value);
      const bytes = Buffer.byteLength(text);
      expect(stringifyBounded(value, bytes)).toEqual({ text, bytes });
      expect(() => stringifyBounded(value, bytes - 1)).toThrow(JsonByteLimitError);
    }
  });

  it('stops before visiting the rest of an oversized response', () => {
    const later = vi.fn(() => 'must not serialize');
    const value = { patch: '\u0000'.repeat(1024), get later() { return later(); } };
    expect(() => stringifyBounded(value, 1024)).toThrow(JsonByteLimitError);
    expect(later).not.toHaveBeenCalled();
  });
});
