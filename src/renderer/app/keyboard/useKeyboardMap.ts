import { useEffect, useLayoutEffect, useRef } from 'react';
import type { SidebarView } from '../navigation/location';
import { isOverlayOpen, isTypingTarget, readKey, type ChordState, type KeyArea, type KeyCommand } from './keys';
import {
  currentRow, focusRow, folderExpanded, isFolderRow, listRows, listScroller, moveToFile, parentRow, rowAfter, rowAt, rowTarget, shownList,
} from './list-navigation';

export interface KeyboardMapOptions {
  /** Off while no repository is open or the start screen covers it. */
  enabled: boolean;
  mobile: boolean;
  /** The viewer shows something, and what: a file is left open by Esc, being a tab of its own. */
  viewer(): 'none' | 'file' | 'other';
  /** Whether the section on screen is Changes, whose diffs are one file each: n and p move through its list. */
  changes(): boolean;
  showSection(view: SidebarView): void;
  showShortcuts(): void;
  closeViewer(): void;
  /** What a phone's back arrow does. */
  phoneBack(): void;
}

/** Holding j or k moves the focus at once, and opens the row it stops on this long after the last repeat. */
const HELD_KEY_OPEN_MS = 140;

/** One listener for the single keys of every list and the viewer (see `keys.ts`). */
export function useKeyboardMap(options: KeyboardMapOptions): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    const chord: ChordState = { since: null };
    let held: HTMLElement | null = null;
    let heldTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const open = (row: HTMLElement) => rowTarget(row).click();
    const openHeld = () => {
      clearTimeout(heldTimer);
      const row = held;
      held = null;
      if (row?.isConnected) open(row);
    };
    /** Opens a row the list moved to; while the key repeats, only the row it stops on. */
    const follow = (row: HTMLElement, repeat: boolean) => {
      clearTimeout(heldTimer);
      held = null;
      if (!repeat) { open(row); return; }
      held = row;
      heldTimer = setTimeout(openHeld, HELD_KEY_OPEN_MS);
    };
    /** Runs once the next frames have drawn what a key changed, retrying while it is not there yet. */
    const afterPaint = (run: () => boolean, tries = 12) => {
      cancelAnimationFrame(frame);
      const step = (left: number) => { frame = requestAnimationFrame(() => { if (!run() && left > 0) step(left - 1); }); };
      step(tries);
    };
    const viewerBody = () => document.querySelector<HTMLElement>('.viewer-pane-body');
    const keepFocusInViewer = () => afterPaint(() => {
      const body = viewerBody();
      if (!body) return false;
      if (!body.contains(document.activeElement)) body.focus({ preventScroll: true });
      return true;
    }, 2);
    const focusShownList = (preferCurrent = true) => afterPaint(() => {
      if (isTypingTarget(document.activeElement)) return true;
      const root = shownList();
      if (!root) return false;
      const row = (preferCurrent ? currentRow(root) : null) ?? listRows(root)[0];
      if (!row) return false;
      focusRow(row);
      return true;
    });

    const run = (command: KeyCommand, area: KeyArea, target: EventTarget | null, repeat: boolean): boolean => {
      const { mobile, viewer } = latest.current;
      if (command.kind === 'chord') return true;
      if (command.kind === 'section') {
        latest.current.showSection(command.view);
        focusShownList();
        return true;
      }
      if (command.kind === 'help') {
        // Phones have no Shortcuts settings, and no keyboard to speak of.
        if (mobile) return false;
        latest.current.showShortcuts();
        return true;
      }
      if (area === 'list') {
        const at = rowAt(target);
        if (!at) return false;
        const { root, row } = at;
        const rows = listRows(root);
        if (command.kind === 'move') {
          if (command.to === 'first' || command.to === 'last') {
            // A virtual list draws only what is near the view: scroll to the end first, then take the row there.
            const scroller = listScroller(root);
            if (scroller) scroller.scrollTop = command.to === 'first' ? 0 : scroller.scrollHeight;
            afterPaint(() => {
              const end = rowAfter(listRows(root), null, command.to);
              if (end) focusRow(end);
              return end !== null;
            }, 3);
            return true;
          }
          const next = rowAfter(rows, row, command.to);
          if (!next || next === row) return true;
          focusRow(next);
          // With the viewer showing one of this list's rows, it follows the selection, as a click would.
          if (!mobile && viewer() !== 'none' && currentRow(root) && !isFolderRow(next)) follow(next, repeat);
          return true;
        }
        if (command.kind === 'open') {
          open(row);
          if (!isFolderRow(row)) keepFocusInViewer();
          return true;
        }
        if (command.kind === 'close') {
          if (mobile || viewer() !== 'other' || !currentRow(root)) return false;
          latest.current.closeViewer();
          return true;
        }
        if (command.kind === 'expand') {
          if (!isFolderRow(row)) return false;
          if (!folderExpanded(row)) open(row);
          else {
            const child = rowAfter(rows, row, 'next');
            if (child) focusRow(child);
          }
          return true;
        }
        if (command.kind === 'collapse') {
          if (isFolderRow(row) && folderExpanded(row)) { open(row); return true; }
          const parent = parentRow(rows, row);
          if (!parent) return false;
          focusRow(parent);
          return true;
        }
        return false;
      }
      if (area !== 'viewer') return false;
      if (command.kind === 'file') {
        // A change in Changes is one file: n and p go on to the next change, as j and k do.
        const changes = latest.current.changes();
        const pane = document.querySelector('.viewer-pane');
        if (pane && moveToFile(pane, command.to, changes ? 2 : 1)) return true;
        return changes ? moveFromViewer(command.to, repeat) : false;
      }
      if (command.kind === 'move' && (command.to === 'next' || command.to === 'previous')) return moveFromViewer(command.to, repeat);
      if (command.kind === 'close') {
        if (mobile) {
          latest.current.phoneBack();
          focusShownList();
          return true;
        }
        const shown = viewer();
        if (shown === 'none') return false;
        if (shown === 'other') latest.current.closeViewer();
        focusShownList();
        return true;
      }
      return false;
    };
    /** j and k in the viewer: the list's next row, opened at once, without going back to the list. */
    const moveFromViewer = (to: 'next' | 'previous', repeat: boolean): boolean => {
      const root = shownList();
      if (!root) return false;
      const from = currentRow(root);
      const next = rowAfter(listRows(root), from, to, true);
      if (!next || next === from) return true;
      next.scrollIntoView?.({ block: 'nearest' });
      follow(next, repeat);
      keepFocusInViewer();
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!latest.current.enabled) { chord.since = null; return; }
      const target = event.target;
      const viewer = document.querySelector('.viewer-pane');
      const area: KeyArea = rowAt(target) ? 'list' : viewer && target instanceof Node && viewer.contains(target) ? 'viewer' : 'other';
      const command = readKey(event, { area, typing: isTypingTarget(target), overlay: isOverlayOpen() }, chord);
      if (command && run(command, area, target, event.repeat)) event.preventDefault();
    };
    // Letting go of a held key opens the row it stopped on without waiting.
    const onKeyUp = () => { if (held) openHeld(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearTimeout(heldTimer);
      cancelAnimationFrame(frame);
    };
  }, []);
}
