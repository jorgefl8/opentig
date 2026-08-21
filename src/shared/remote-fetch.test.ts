import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS,
  formatRemoteFetchInterval,
  MAX_REMOTE_FETCH_INTERVAL_SECONDS,
  MIN_REMOTE_FETCH_INTERVAL_SECONDS,
  normalizeRemoteFetchIntervalSeconds,
} from './remote-fetch';

describe('remote fetch interval', () => {
  it('defaults, disables at zero, and clamps to the settings range', () => {
    expect(normalizeRemoteFetchIntervalSeconds(undefined)).toBe(DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS);
    expect(normalizeRemoteFetchIntervalSeconds('nope')).toBe(DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS);
    expect(normalizeRemoteFetchIntervalSeconds(0)).toBe(0);
    expect(normalizeRemoteFetchIntervalSeconds('0')).toBe(0);
    expect(normalizeRemoteFetchIntervalSeconds(7)).toBe(MIN_REMOTE_FETCH_INTERVAL_SECONDS);
    expect(normalizeRemoteFetchIntervalSeconds(32)).toBe(30);
    expect(normalizeRemoteFetchIntervalSeconds(999)).toBe(MAX_REMOTE_FETCH_INTERVAL_SECONDS);
  });

  it('labels the settings control', () => {
    expect(formatRemoteFetchInterval(0)).toBe('Off');
    expect(formatRemoteFetchInterval(30)).toBe('30s');
  });
});
