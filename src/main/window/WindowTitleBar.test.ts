import { describe, expect, it } from 'vitest';
import { getWindowTitleBarOptions, shouldUseDarkTitleBar, WINDOW_TITLE_BAR_HEIGHT } from './WindowTitleBar';

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
});
