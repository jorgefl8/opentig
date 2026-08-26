import { describe, expect, it } from 'vitest';
import { startupSplashDetail } from './startup-splash';

describe('startup splash copy', () => {
  it('keeps the heading still and only changes the detail', () => {
    expect(startupSplashDetail('connecting')).toBe('Connecting to the local server.');
    expect(startupSplashDetail('connected')).toBe('Restoring your workspace.');
    expect(startupSplashDetail('reconnecting')).toBe('Reconnecting to the local server.');
    expect(startupSplashDetail('offline')).toBe('Connecting to the local server.');
  });
});
