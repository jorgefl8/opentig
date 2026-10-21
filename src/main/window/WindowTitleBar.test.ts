import { describe, expect, it } from 'vitest';
import {
  parseSettingsTheme, shouldUseDarkTitleBar, startupBackground, STARTUP_BACKGROUND_DARK, STARTUP_BACKGROUND_LIGHT,
} from './WindowTitleBar';

describe('WindowTitleBar', () => {
  it('resolves explicit and system themes', () => {
    expect(shouldUseDarkTitleBar('dark', false)).toBe(true);
    expect(shouldUseDarkTitleBar('light', true)).toBe(false);
    expect(shouldUseDarkTitleBar('system', true)).toBe(true);
  });

  it('reads the last theme from settings and maps it to a window background', () => {
    expect(parseSettingsTheme({ preferences: { theme: 'light' } })).toBe('light');
    expect(parseSettingsTheme({ preferences: { theme: 'nope' } })).toBe('system');
    expect(parseSettingsTheme(null)).toBe('system');
    expect(startupBackground(true)).toBe(STARTUP_BACKGROUND_DARK);
    expect(startupBackground(false)).toBe(STARTUP_BACKGROUND_LIGHT);
  });
});
