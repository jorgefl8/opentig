import { describe, expect, it } from 'vitest';
import { ByteBudgetLru } from './ByteBudgetLru';

describe('ByteBudgetLru', () => {
  it('promotes reads and evicts the least recently used entry', () => {
    const cache = createCache(2, 100);
    cache.set('a', 'one');
    cache.set('b', 'two');

    expect(cache.get('a')).toBe('one');
    cache.set('c', 'three');

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('one');
    expect(cache.get('c')).toBe('three');
  });

  it('evicts by aggregate byte budget independently of entry count', () => {
    const cache = createCache(10, 6);
    cache.set('a', '123');
    cache.set('b', '45');
    cache.set('c', '678');

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('45');
    expect(cache.get('c')).toBe('678');
    expect(cache.bytes).toBe(5);
  });

  it('replaces an existing key without retaining its previous weight', () => {
    const cache = createCache(3, 10);
    cache.set('a', '123456');
    cache.set('b', '12');

    expect(cache.set('a', '1')).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(3);
    expect(cache.get('a')).toBe('1');
  });

  it('does not cache an entry larger than the whole budget', () => {
    const cache = createCache(3, 4);
    cache.set('existing', '12');

    expect(cache.set('oversize', '12345')).toBe(false);
    expect(cache.get('oversize')).toBeUndefined();
    expect(cache.get('existing')).toBe('12');
  });

  it('clears entries and byte accounting together', () => {
    const cache = createCache(3, 10);
    cache.set('a', '123');
    cache.set('b', '45');

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('rejects invalid budgets and weights', () => {
    expect(() => createCache(0, 1)).toThrow(RangeError);
    expect(() => createCache(1, 0)).toThrow(RangeError);
    const cache = new ByteBudgetLru<string, string>({ maxEntries: 1, maxBytes: 1, sizeOf: () => Number.NaN });
    expect(() => cache.set('a', 'value')).toThrow(RangeError);
  });
});

function createCache(maxEntries: number, maxBytes: number): ByteBudgetLru<string, string> {
  return new ByteBudgetLru({ maxEntries, maxBytes, sizeOf: (value) => value.length });
}
