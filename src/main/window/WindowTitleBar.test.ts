import { describe, expect, it } from 'vitest';
import {
  getWindowTitleBarOptions, parseSettingsTheme, shouldUseDarkTitleBar, startupBackground,
  STARTUP_BACKGROUND_DARK, STARTUP_BACKGROUND_LIGHT, WINDOW_TITLE_BAR_HEIGHT,
} from './WindowTitleBar';

describe('WindowTitleBar', () => {
  it('integrates Windows controls into the application toolbar', () => {
    expect(getWindowTitleBarOptions(true, 'win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#01000000',
        height: WINDOW_TITLE_BAR_HEIGHT,
        symbolColor: '#f8fafc',
      },
    });
  });

  it('uses inset traffic lights on macOS', () => {
    expect(getWindowTitleBarOptions(false, 'darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    });
  });

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
