import type { ThemePreference } from '@shared/contracts';

export const THEME_STORAGE_KEY = 'opentig.theme';

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null | undefined): ThemePreference | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : null;
  } catch {
    return null;
  }
}

export function persistTheme(theme: ThemePreference, storage: Pick<Storage, 'setItem'> | null | undefined = globalThis.localStorage): void {
  try { storage?.setItem(THEME_STORAGE_KEY, theme); } catch { /* private mode or quota */ }
}

export function resolveBootDark(theme: ThemePreference | null, prefersDark: boolean): boolean {
  if (theme === 'light') return false;
  if (theme === 'dark') return true;
  return prefersDark;
}

export function applyBootTheme(options: {
  root?: HTMLElement | null;
  storage?: Pick<Storage, 'getItem'> | null;
  prefersDark?: boolean;
} = {}): boolean {
  const root = options.root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!root) return false;
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  const prefersDark = options.prefersDark ?? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = resolveBootDark(readStoredTheme(storage), prefersDark);
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  return dark;
}

applyBootTheme();
