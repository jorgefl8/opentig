import { describe, expect, it } from 'vitest';
import { isDevToolsShortcut } from './ApplicationMenu';

const key = (key: string, modifiers: Partial<{ control: boolean; meta: boolean; shift: boolean; alt: boolean; isAutoRepeat: boolean; type: string }> = {}) => ({
  type: 'keyDown', key, control: false, meta: false, shift: false, alt: false, isAutoRepeat: false, ...modifiers,
});

describe('ApplicationMenu', () => {
  it('never opens DevTools from the keyboard in production', () => {
    expect(isDevToolsShortcut(key('F12'), 'production')).toBe(false);
    expect(isDevToolsShortcut(key('I', { control: true, shift: true }), 'production')).toBe(false);
  });

  it('opens DevTools in Dev once per press, only for F12 and Ctrl+Shift+I', () => {
    expect(isDevToolsShortcut(key('F12'), 'dev')).toBe(true);
    expect(isDevToolsShortcut(key('I', { control: true, shift: true }), 'dev')).toBe(true);
    expect(isDevToolsShortcut(key('i', { meta: true, shift: true }), 'dev')).toBe(true);
    // A held key or its release must not toggle DevTools closed again.
    expect(isDevToolsShortcut(key('F12', { isAutoRepeat: true }), 'dev')).toBe(false);
    expect(isDevToolsShortcut(key('F12', { type: 'keyUp' }), 'dev')).toBe(false);
    // Neighbouring combos stay with the app.
    expect(isDevToolsShortcut(key('i', { control: true }), 'dev')).toBe(false);
    expect(isDevToolsShortcut(key('I', { control: true, shift: true, alt: true }), 'dev')).toBe(false);
  });
});
