import { describe, expect, it } from 'vitest';
import { normalizeExternalOrigin } from './external-origin';

describe('external HTTPS origin', () => {
  it('normalizes an exact HTTPS origin', () => {
    expect(normalizeExternalOrigin(' HTTPS://OpenTig.Example.COM ')).toBe('https://opentig.example.com');
  });

  it.each([
    'http://opentig.example.com',
    'https://user@opentig.example.com',
    'https://opentig.example.com/path',
    'https://opentig.example.com/?query=1',
    'not a URL',
  ])('rejects unsafe or non-origin value %s', (value) => {
    expect(() => normalizeExternalOrigin(value)).toThrow();
  });
});
