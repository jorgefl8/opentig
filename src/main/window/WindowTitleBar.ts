import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { ThemePreference } from '../../shared/contracts';

/** Matches the `.toolbar` height so the controls stay inside the toolbar row. */
export const WINDOW_TITLE_BAR_HEIGHT = 48;
const TRANSPARENT_TITLE_BAR = '#01000000';
const LIGHT_SYMBOL_COLOR = '#1f2937';
const DARK_SYMBOL_COLOR = '#f8fafc';

type WindowTitleBarOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarOverlay' | 'titleBarStyle' | 'trafficLightPosition'
>;

export function shouldUseDarkTitleBar(theme: ThemePreference, systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark);
}

export function getWindowTitleBarOptions(dark: boolean, platform: NodeJS.Platform): WindowTitleBarOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    };
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: TRANSPARENT_TITLE_BAR,
      height: WINDOW_TITLE_BAR_HEIGHT,
      symbolColor: dark ? DARK_SYMBOL_COLOR : LIGHT_SYMBOL_COLOR,
    },
  };
}

export function applyWindowTitleBarTheme(window: BrowserWindow, dark: boolean): void {
  if (process.platform === 'darwin' || window.isDestroyed()) return;
  const { titleBarOverlay } = getWindowTitleBarOptions(dark, process.platform);
  if (typeof titleBarOverlay === 'object') window.setTitleBarOverlay(titleBarOverlay);
}
