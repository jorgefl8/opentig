import { readFile } from 'node:fs/promises';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { ThemePreference } from '../../shared/contracts';

export const STARTUP_BACKGROUND_DARK = '#171717';
export const STARTUP_BACKGROUND_LIGHT = '#fbfbfb';

/** Matches the `.toolbar` height so the controls stay inside the toolbar row. */
export const WINDOW_TITLE_BAR_HEIGHT = 42;
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

export function parseSettingsTheme(value: unknown): ThemePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'system';
  const theme = (value as { preferences?: { theme?: unknown } }).preferences?.theme;
  return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
}

export function startupBackground(dark: boolean): string {
  return dark ? STARTUP_BACKGROUND_DARK : STARTUP_BACKGROUND_LIGHT;
}

export async function readStartupDark(settingsPath: string, systemDark: boolean): Promise<boolean> {
  try {
    return shouldUseDarkTitleBar(parseSettingsTheme(JSON.parse(await readFile(settingsPath, 'utf8'))), systemDark);
  } catch {
    return systemDark;
  }
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
