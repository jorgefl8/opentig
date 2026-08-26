import { describe, expect, it } from 'vitest';
import { applyBootTheme, persistTheme, readStoredTheme, resolveBootDark, THEME_STORAGE_KEY } from './boot-theme';

describe('boot theme', () => {
  it('reads only light, dark, or system from storage', () => {
    expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark');
    expect(readStoredTheme({ getItem: () => 'light' })).toBe('light');
    expect(readStoredTheme({ getItem: () => 'system' })).toBe('system');
    expect(readStoredTheme({ getItem: () => 'sepia' })).toBeNull();
    expect(readStoredTheme(null)).toBeNull();
  });

  it('treats an unknown stored theme as the OS preference', () => {
    expect(resolveBootDark('dark', false)).toBe(true);
    expect(resolveBootDark('light', true)).toBe(false);
    expect(resolveBootDark('system', true)).toBe(true);
    expect(resolveBootDark('system', false)).toBe(false);
    expect(resolveBootDark(null, true)).toBe(true);
    expect(resolveBootDark(null, false)).toBe(false);
  });

  it('applies dark/light classes from storage and persists the last theme', () => {
    const root = { classList: { dark: false, light: false, toggle(name: string, force?: boolean) {
      if (name === 'dark') this.dark = Boolean(force);
      if (name === 'light') this.light = Boolean(force);
    } } };
    const store: Record<string, string> = { [THEME_STORAGE_KEY]: 'light' };
    expect(applyBootTheme({
      root: root as unknown as HTMLElement,
      storage: { getItem: (key) => store[key] ?? null },
      prefersDark: true,
    })).toBe(false);
    expect(root.classList.dark).toBe(false);
    expect(root.classList.light).toBe(true);

    persistTheme('dark', { setItem: (key, value) => { store[key] = value; } });
    expect(store[THEME_STORAGE_KEY]).toBe('dark');
  });
});
