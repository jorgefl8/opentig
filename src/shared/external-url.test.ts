import { describe, expect, it } from 'vitest';
import { normalizeExternalUrl } from './external-url';

describe('normalizeExternalUrl', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com/'],
    ['mailto:test@example.com', 'mailto:test@example.com'],
    ['//example.com/path', 'https://example.com/path'],
  ])('allows %s', (value, expected) => {
    expect(normalizeExternalUrl(value)).toBe(expected);
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,test', '/relative', 'invalid'])('rejects %s', (value) => {
    expect(normalizeExternalUrl(value)).toBeNull();
  });
});
