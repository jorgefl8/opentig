import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime, formatTimeAgo } from './date-format';

afterEach(() => { vi.unstubAllEnvs(); });

describe('display dates', () => {
  it('pads the day and month and retains a four-digit year', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(formatDate('2026-01-02T15:04:05Z')).toBe('02/01/2026');
    expect(formatDate('0099-12-31T00:00:00Z')).toBe('31/12/0099');
    expect(formatDate('2024-02-29T00:00:00Z')).toBe('29/02/2024');
  });

  it('uses 24-hour local time with optional seconds', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(formatDateTime('2026-01-02T15:04:05Z')).toBe('02/01/2026 15:04');
    expect(formatDateTime('2026-01-02T00:04:05Z', { seconds: true })).toBe('02/01/2026 00:04:05');
  });

  it('uses the local calendar day across timezone and daylight saving boundaries', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(formatDateTime('2026-01-01T01:04:05Z')).toBe('31/12/2025 17:04');
    expect(formatDateTime('2026-07-01T01:04:05Z')).toBe('30/06/2026 18:04');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
  });

  it.each(['', 'invalid-date'])('handles invalid dates (%s) without throwing', (value) => {
    expect(formatDate(value)).toBe('—');
    expect(formatDateTime(value)).toBe('—');
  });
});

describe('formatTimeAgo', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  const ago = (seconds: number) => formatTimeAgo(new Date(now - seconds * 1000).toISOString(), now);

  it.each([
    [0, 'just now'],
    [59, 'just now'],
    [60, '1m ago'],
    [3_599, '59m ago'],
    [3_600, '1h ago'],
    [86_399, '23h ago'],
    [86_400, '1d ago'],
    [2_591_999, '29d ago'],
    [2_592_000, '1mo ago'],
    [31_535_999, '12mo ago'],
    [31_536_000, '1y ago'],
    [-120, 'just now'],
  ])('reads %i seconds as %s', (seconds, text) => {
    expect(ago(seconds)).toBe(text);
  });

  it('says nothing about a date it cannot read', () => {
    expect(formatTimeAgo('not a date', now)).toBe('—');
  });
});
