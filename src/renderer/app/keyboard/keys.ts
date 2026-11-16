import type { SidebarView } from '../navigation/location';

/**
 * The single keys OpenTig reads outside text fields: moving through a list and
 * the viewer beside it, `g` followed by a section's letter, and `?`. What a key
 * means is decided here, from the event and where focus is; acting on it is the
 * app's (see `list-navigation.ts`).
 */

/** How long `g` waits for a section's letter. */
export const CHORD_TIMEOUT_MS = 1_200;

export const SECTION_LETTERS: Readonly<Record<string, SidebarView>> = { c: 'changes', f: 'files', h: 'history', p: 'prs', s: 'search' };

/** Where the key was pressed: on a list's row, in the viewer, or anywhere else. */
export type KeyArea = 'list' | 'viewer' | 'other';

export type KeyCommand =
  | { kind: 'section'; view: SidebarView }
  | { kind: 'chord' }
  | { kind: 'help' }
  | { kind: 'move'; to: 'next' | 'previous' | 'first' | 'last' }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'expand' }
  | { kind: 'collapse' }
  | { kind: 'file'; to: 'next' | 'previous' };

export interface KeyContext {
  area: KeyArea;
  /** Focus is in something that takes text: a field, a select, the code editor. */
  typing: boolean;
  /** A dialog, menu, popover, sheet or the palette covers the app. */
  overlay: boolean;
}

/** When `g` was pressed, while it waits for a letter. */
export interface ChordState { since: number | null }

type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode' | 'defaultPrevented' | 'timeStamp'>;

/**
 * What a key does, or null to leave it to the browser and whatever else listens.
 * A pending `g` is taken by its letter, and given up by any other key or once
 * `CHORD_TIMEOUT_MS` has passed. It reads the event's own time, never a timer.
 */
export function readKey(event: KeyInput, context: KeyContext, chord: ChordState): KeyCommand | null {
  const pending = chord.since !== null && event.timeStamp - chord.since <= CHORD_TIMEOUT_MS;
  chord.since = null;
  // During IME composition the key belongs to the text being composed.
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null;
  if (context.typing || context.overlay) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key;
  // `?` is a shifted key on most layouts; every other key here is read without Shift.
  if (key === '?') return { kind: 'help' };
  if (event.shiftKey) return null;
  if (pending) {
    const view = SECTION_LETTERS[key];
    if (view) return { kind: 'section', view };
  }
  if (key === 'g') {
    chord.since = event.timeStamp;
    return { kind: 'chord' };
  }
  if (context.area === 'list') {
    if (key === 'ArrowDown' || key === 'j') return { kind: 'move', to: 'next' };
    if (key === 'ArrowUp' || key === 'k') return { kind: 'move', to: 'previous' };
    if (key === 'Home') return { kind: 'move', to: 'first' };
    if (key === 'End') return { kind: 'move', to: 'last' };
    if (key === 'Enter') return { kind: 'open' };
    if (key === 'Escape') return { kind: 'close' };
    if (key === 'ArrowRight') return { kind: 'expand' };
    if (key === 'ArrowLeft') return { kind: 'collapse' };
    return null;
  }
  if (context.area === 'viewer') {
    if (key === 'j') return { kind: 'move', to: 'next' };
    if (key === 'k') return { kind: 'move', to: 'previous' };
    if (key === 'n') return { kind: 'file', to: 'next' };
    if (key === 'p') return { kind: 'file', to: 'previous' };
    if (key === 'Escape') return { kind: 'close' };
  }
  return null;
}

const TEXT_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]';

/** Whether a single key pressed here belongs to text being typed or chosen. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  return element.isContentEditable === true || element.closest(TEXT_TARGETS) !== null;
}

const OVERLAYS = [
  '[data-slot="dialog-popup"]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]',
  '[data-slot="popover-content"]', '[data-slot="select-content"]', '[data-slot="combobox-content"]',
  '[data-slot="dropdown-menu-content"]', '.mobile-sheet', '.confirm-popover',
].join(', ');

/** Whether something covers the app and owns the keyboard: a dialog, menu, popover, sheet or the palette. */
export function isOverlayOpen(root: ParentNode = document): boolean {
  return root.querySelector(OVERLAYS) !== null;
}
