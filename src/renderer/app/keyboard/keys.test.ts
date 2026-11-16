// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CHORD_TIMEOUT_MS, isOverlayOpen, isTypingTarget, readKey, type ChordState, type KeyContext } from './keys';

type Press = Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode' | 'defaultPrevented' | 'timeStamp'>>;
const press = (key: string, extra: Press = {}) => ({
  key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, keyCode: 0, defaultPrevented: false, timeStamp: 0, ...extra,
});
const list: KeyContext = { area: 'list', typing: false, overlay: false };
const viewer: KeyContext = { area: 'viewer', typing: false, overlay: false };
const elsewhere: KeyContext = { area: 'other', typing: false, overlay: false };
const fresh = (): ChordState => ({ since: null });

describe('single keys', () => {
  it('move through a list, open, close and fold from one of its rows', () => {
    const read = (key: string) => readKey(press(key), list, fresh());
    expect(read('j')).toEqual({ kind: 'move', to: 'next' });
    expect(read('ArrowDown')).toEqual({ kind: 'move', to: 'next' });
    expect(read('k')).toEqual({ kind: 'move', to: 'previous' });
    expect(read('Home')).toEqual({ kind: 'move', to: 'first' });
    expect(read('End')).toEqual({ kind: 'move', to: 'last' });
    expect(read('Enter')).toEqual({ kind: 'open' });
    expect(read('Escape')).toEqual({ kind: 'close' });
    expect(read('ArrowRight')).toEqual({ kind: 'expand' });
    expect(read('ArrowLeft')).toEqual({ kind: 'collapse' });
    // n and p belong to the viewer, as the key map says.
    expect(read('n')).toBeNull();
  });

  it('in the viewer, take the list’s next item with j and k, a diff’s next file with n and p, and leave the arrows to scrolling', () => {
    const read = (key: string) => readKey(press(key), viewer, fresh());
    expect(read('j')).toEqual({ kind: 'move', to: 'next' });
    expect(read('k')).toEqual({ kind: 'move', to: 'previous' });
    expect(read('n')).toEqual({ kind: 'file', to: 'next' });
    expect(read('p')).toEqual({ kind: 'file', to: 'previous' });
    expect(read('Escape')).toEqual({ kind: 'close' });
    expect(read('ArrowDown')).toBeNull();
    expect(read('Enter')).toBeNull();
  });

  it('do nothing anywhere else, so the keys reach the browser', () => {
    for (const key of ['j', 'k', 'n', 'p', 'Enter', 'Escape', 'ArrowDown', 'x', '1']) expect(readKey(press(key), elsewhere, fresh()), key).toBeNull();
  });

  it('never act while typing, while something covers the app, with a modifier held, or during composition', () => {
    const cases: [Press, KeyContext][] = [
      [{}, { ...list, typing: true }],
      [{}, { ...viewer, typing: true }],
      [{}, { ...list, overlay: true }],
      [{ ctrlKey: true }, list],
      [{ metaKey: true }, list],
      [{ altKey: true }, list],
      [{ shiftKey: true }, list],
      [{ isComposing: true }, list],
      [{ keyCode: 229 }, list],
      [{ defaultPrevented: true }, list],
    ];
    for (const [extra, context] of cases) {
      expect(readKey(press('j', extra), context, fresh()), JSON.stringify({ extra, context })).toBeNull();
      expect(readKey(press('g', extra), context, fresh()), JSON.stringify({ extra, context })).toBeNull();
    }
  });

  it('read ? with the Shift it needs, and not while typing', () => {
    expect(readKey(press('?', { shiftKey: true }), elsewhere, fresh())).toEqual({ kind: 'help' });
    expect(readKey(press('?', { shiftKey: true }), { ...elsewhere, typing: true }, fresh())).toBeNull();
  });
});

describe('g and a section letter', () => {
  it('go to the section from anywhere outside a text field', () => {
    const chord = fresh();
    expect(readKey(press('g', { timeStamp: 1_000 }), elsewhere, chord)).toEqual({ kind: 'chord' });
    expect(readKey(press('h', { timeStamp: 1_400 }), elsewhere, chord)).toEqual({ kind: 'section', view: 'history' });
    const letters = { c: 'changes', f: 'files', h: 'history', p: 'prs', s: 'search' };
    for (const [letter, view] of Object.entries(letters)) {
      const state = fresh();
      readKey(press('g'), list, state);
      expect(readKey(press(letter), list, state)).toEqual({ kind: 'section', view });
    }
  });

  it('give up once the wait is over, read from the keys’ own times', () => {
    const chord = fresh();
    readKey(press('g', { timeStamp: 1_000 }), elsewhere, chord);
    expect(readKey(press('h', { timeStamp: 1_000 + CHORD_TIMEOUT_MS + 1 }), elsewhere, chord)).toBeNull();
    // At the limit it still counts.
    readKey(press('g', { timeStamp: 5_000 }), elsewhere, chord);
    expect(readKey(press('h', { timeStamp: 5_000 + CHORD_TIMEOUT_MS }), elsewhere, chord)).toEqual({ kind: 'section', view: 'history' });
  });

  it('give up on any other key, which then does what it does on its own', () => {
    const chord = fresh();
    readKey(press('g'), list, chord);
    expect(readKey(press('j'), list, chord)).toEqual({ kind: 'move', to: 'next' });
    expect(readKey(press('h'), list, chord)).toBeNull();
  });

  it('give up when the letter is typed into a field, or with a modifier', () => {
    const chord = fresh();
    readKey(press('g'), elsewhere, chord);
    expect(readKey(press('h'), { ...elsewhere, typing: true }, chord)).toBeNull();
    expect(readKey(press('h'), elsewhere, chord)).toBeNull();
    readKey(press('g'), elsewhere, chord);
    expect(readKey(press('h', { ctrlKey: true }), elsewhere, chord)).toBeNull();
    expect(readKey(press('h'), elsewhere, chord)).toBeNull();
  });
});

describe('where typing happens', () => {
  it('counts fields, selects, editable text and the code editor, and nothing else', () => {
    document.body.innerHTML = `
      <input id="field"><textarea id="area"></textarea><select id="choice"><option>a</option></select>
      <div contenteditable="plaintext-only"><span id="editor">code</span></div>
      <div contenteditable="false"><span id="locked">text</span></div>
      <div role="combobox" id="combo"></div>
      <button id="row">Row</button>`;
    for (const id of ['field', 'area', 'choice', 'editor', 'combo']) expect(isTypingTarget(document.getElementById(id)), id).toBe(true);
    for (const id of ['locked', 'row']) expect(isTypingTarget(document.getElementById(id)), id).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });

  it('sees a dialog, a menu or a sheet covering the app', () => {
    document.body.innerHTML = '<main><button>Row</button></main>';
    expect(isOverlayOpen()).toBe(false);
    for (const markup of ['<div data-slot="dialog-popup"></div>', '<div role="menu"></div>', '<div class="mobile-sheet"></div>', '<div role="listbox"></div>']) {
      document.body.innerHTML = `<main><button>Row</button></main>${markup}`;
      expect(isOverlayOpen(), markup).toBe(true);
    }
  });
});
