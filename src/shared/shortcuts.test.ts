import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUT_MAP, findShortcutConflict, formatCombo, isValidCombo, matchesCombo, normalizeCombo,
  resolveShortcuts, sanitizeShortcutOverrides,
} from './shortcuts';

const event = (value: Partial<KeyboardEvent>) => ({ key: 'p', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...value } as KeyboardEvent);

describe('normalizeCombo / matchesCombo', () => {
  it('recognizes only an unmodified Ctrl+P, case-insensitively', () => {
    expect(matchesCombo(event({ ctrlKey: true }), 'Ctrl+P')).toBe(true);
    expect(matchesCombo(event({ ctrlKey: true, key: 'P' }), 'Ctrl+P')).toBe(true);
    expect(matchesCombo(event({ ctrlKey: true, altKey: true }), 'Ctrl+P')).toBe(false);
    expect(matchesCombo(event({ ctrlKey: true, shiftKey: true }), 'Ctrl+P')).toBe(false);
    expect(matchesCombo(event({ key: 'p' }), 'Ctrl+P')).toBe(false);
    expect(matchesCombo(event({ ctrlKey: true, key: 'o' }), 'Ctrl+P')).toBe(false);
  });

  it('treats metaKey as an alias for Ctrl', () => {
    expect(matchesCombo(event({ metaKey: true, key: 's' }), 'Ctrl+S')).toBe(true);
  });

  it('orders modifiers canonically and supports named keys', () => {
    expect(normalizeCombo({ key: 'Tab', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe('Ctrl+Shift+Tab');
    expect(normalizeCombo({ key: 'PageDown', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe('Ctrl+Shift+PageDown');
  });

  it('returns null for a bare modifier keydown', () => {
    expect(normalizeCombo({ key: 'Control', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBeNull();
  });
});

describe('isValidCombo', () => {
  it('requires a modifier unless the shortcut allows a bare key', () => {
    expect(isValidCombo('P', false)).toBe(false);
    expect(isValidCombo('Ctrl+P', false)).toBe(true);
    expect(isValidCombo('Q', true)).toBe(true);
    expect(isValidCombo('Ctrl+Q', true)).toBe(false);
  });

  it('rejects out-of-order or duplicated modifiers', () => {
    expect(isValidCombo('Shift+Ctrl+Z', false)).toBe(false);
    expect(isValidCombo('Ctrl+Ctrl+Z', false)).toBe(false);
    expect(isValidCombo('Ctrl+Shift+Z', false)).toBe(true);
  });

  it('rejects unsupported final keys', () => {
    expect(isValidCombo('Ctrl+Escape', false)).toBe(false);
    expect(isValidCombo('Ctrl+/', false)).toBe(false);
  });
});

describe('formatCombo', () => {
  it('joins parts with spaces', () => {
    expect(formatCombo('Ctrl+Shift+Tab')).toBe('Ctrl + Shift + Tab');
  });
});

describe('resolveShortcuts', () => {
  it('falls back to defaults for missing or invalid overrides', () => {
    const resolved = resolveShortcuts({ quickOpen: 'Ctrl+K', saveFile: 'not-a-combo' });
    expect(resolved.quickOpen).toBe('Ctrl+K');
    expect(resolved.saveFile).toBe(DEFAULT_SHORTCUT_MAP.saveFile);
    expect(resolved.refresh).toBe(DEFAULT_SHORTCUT_MAP.refresh);
  });

  it('resolves every shortcut to a default when no overrides are given', () => {
    expect(resolveShortcuts(undefined)).toEqual(DEFAULT_SHORTCUT_MAP);
  });
});

describe('findShortcutConflict', () => {
  it('flags a combo already used by another shortcut', () => {
    const resolved = { ...DEFAULT_SHORTCUT_MAP, refresh: 'Ctrl+O' };
    expect(findShortcutConflict('openRepository', 'Ctrl+O', resolved)).toBe('refresh');
  });

  it('ignores the shortcut colliding with its own current combo', () => {
    expect(findShortcutConflict('openRepository', DEFAULT_SHORTCUT_MAP.openRepository, DEFAULT_SHORTCUT_MAP)).toBeNull();
  });

  it('flags a combo reserved for a fixed shortcut', () => {
    expect(findShortcutConflict('openRepository', 'Ctrl+1', DEFAULT_SHORTCUT_MAP)).toBe('reserved');
  });

  it('allows a free combo', () => {
    expect(findShortcutConflict('openRepository', 'Ctrl+K', DEFAULT_SHORTCUT_MAP)).toBeNull();
  });
});

describe('sanitizeShortcutOverrides', () => {
  it('drops invalid, reserved, no-op, and mutually-colliding entries independently', () => {
    const sanitized = sanitizeShortcutOverrides({
      openRepository: 'Ctrl+K',
      refresh: 'Ctrl+1',
      quickOpen: 'not-a-combo',
      saveFile: DEFAULT_SHORTCUT_MAP.saveFile,
      closeTab: 'Ctrl+K',
      repoSwitcher: 'Ctrl+Q',
    });
    expect(sanitized).toEqual({ openRepository: 'Ctrl+K' });
  });

  it('ignores non-object input', () => {
    expect(sanitizeShortcutOverrides(null)).toEqual({});
    expect(sanitizeShortcutOverrides('nonsense')).toEqual({});
  });
});
