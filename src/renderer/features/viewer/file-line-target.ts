import { createContext, useContext, useEffect } from 'react';

/** The line a search result asked its file to open at. `reached` stops a later remount pulling the view back there. */
export interface FileLineTarget { path: string; line: number; reached: boolean }

export const FileLineTargetContext = createContext<FileLineTarget | null>(null);

/** A file that opens on its preview shows its code instead when a result points into it. */
export function useShowCodeForLineTarget(path: string, showCode: () => void): void {
  const target = useContext(FileLineTargetContext);
  useEffect(() => {
    if (target?.path === path && !target.reached) showCode();
  }, [path, showCode, target]);
}

const MAX_FRAMES = 120;
const STEADY_FRAMES = 3;

function findLine(scroller: HTMLElement, line: number): Element | null {
  for (const element of scroller.querySelectorAll('*')) {
    const found = element.shadowRoot?.querySelector(`[data-line="${line}"]`);
    if (found) return found;
  }
  return null;
}

/**
 * Centres a line in its editor. The code streams in and highlights over several
 * frames, and a large file only renders the lines near its scroll position, so
 * this heads for the line's share of the file until it exists, then holds it
 * there until it stops moving. Touching the editor gives the scroll back.
 */
export function revealSourceLine(getScroller: () => HTMLElement | null, target: FileLineTarget, lineCount: number, options: { requestFrame?(callback: () => void): number; cancelFrame?(handle: number): void } = {}): () => void {
  const requestFrame = options.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  let frames = 0;
  let steady = 0;
  let last: number | null = null;
  let handle: number | null = null;
  let listening: HTMLElement | null = null;
  const stopListening = () => {
    for (const type of ['pointerdown', 'wheel'] as const) listening?.removeEventListener(type, finish);
    listening = null;
  };
  const stop = () => {
    if (handle !== null) cancelFrame(handle);
    handle = null;
    stopListening();
  };
  function finish() {
    target.reached = true;
    stop();
  }
  const step = () => {
    handle = null;
    frames += 1;
    const scroller = getScroller();
    if (scroller && !listening) {
      listening = scroller;
      for (const type of ['pointerdown', 'wheel'] as const) scroller.addEventListener(type, finish, { passive: true });
    }
    if (scroller) {
      const line = findLine(scroller, target.line);
      if (line) {
        const box = line.getBoundingClientRect();
        const top = Math.max(0, scroller.scrollTop + box.top - scroller.getBoundingClientRect().top - (scroller.clientHeight - box.height) / 2);
        scroller.scrollTop = top;
        steady = last !== null && Math.abs(last - scroller.scrollTop) < 1 ? steady + 1 : 0;
        last = scroller.scrollTop;
        if (steady >= STEADY_FRAMES) { finish(); return; }
      } else {
        const range = scroller.scrollHeight - scroller.clientHeight;
        if (range > 0) scroller.scrollTop = range * Math.min(1, (target.line - 1) / Math.max(1, lineCount));
      }
    }
    if (frames >= MAX_FRAMES) { finish(); return; }
    handle = requestFrame(step);
  };
  handle = requestFrame(step);
  return stop;
}
