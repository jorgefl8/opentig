/** Switching windows back and forth quickly checks again at most this often. */
export const WINDOW_RETURN_MIN_GAP_MS = 10_000;
/** With nobody touching the window for this long, nothing is read again on a timer. */
export const IDLE_AFTER_MS = 6 * 60_000;

type FocusTarget = Pick<Window, 'addEventListener' | 'removeEventListener'> & { document: Pick<Document, 'visibilityState'> };

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
let lastActivityAt = Date.now();

/** Nobody has moved the pointer, pressed a key or scrolled for `IDLE_AFTER_MS`. Timers that read again on their own stop meanwhile. */
export function isUserIdle(now: number = Date.now()): boolean {
  return now - lastActivityAt >= IDLE_AFTER_MS;
}

/**
 * A focus listener for TanStack Query's `focusManager` that also reacts to the
 * window regaining focus. The default one only listens to `visibilitychange`,
 * which switching back to a visible window (as with Alt+Tab from a terminal
 * where a PR was just created) doesn't fire, so `refetchOnWindowFocus` never ran.
 *
 * It only asks the focus manager to re-evaluate visibility, never sets a focus
 * state: polling that pauses for hidden windows keeps running for visible but
 * unfocused ones.
 *
 * It also keeps `isUserIdle` current, and treats the first activity after an
 * idle stretch as a return to the window.
 */
export function listenForWindowReturn(target: FocusTarget, now: () => number = Date.now) {
  return (handleFocus: () => void): (() => void) => {
    let lastReturn = Number.NEGATIVE_INFINITY;
    lastActivityAt = now();
    const returned = () => {
      if (target.document.visibilityState === 'hidden') return;
      const at = now();
      // Coming back to the window is being there, before any key or pointer says so.
      lastActivityAt = at;
      // Becoming visible and gaining focus usually arrive together.
      if (at - lastReturn < WINDOW_RETURN_MIN_GAP_MS) return;
      lastReturn = at;
      handleFocus();
    };
    const active = () => {
      const at = now();
      const wasIdle = isUserIdle(at);
      lastActivityAt = at;
      if (wasIdle) returned();
    };
    // Hiding needs no notice: interval polling reads the visibility itself on each tick.
    target.addEventListener('visibilitychange', returned, false);
    target.addEventListener('focus', returned, false);
    for (const event of ACTIVITY_EVENTS) target.addEventListener(event, active, { passive: true, capture: true });
    return () => {
      target.removeEventListener('visibilitychange', returned);
      target.removeEventListener('focus', returned);
      for (const event of ACTIVITY_EVENTS) target.removeEventListener(event, active, { capture: true });
    };
  };
}

/**
 * Makes interval polling stop while the user is idle. Every query that reads
 * again on a timer asks the focus manager first, on each tick, so answering
 * "not focused" pauses them all in one place, and the tick after the user is
 * back resumes them.
 */
export function pausePollingWhileIdle(manager: { isFocused(): boolean }, idle: () => boolean = isUserIdle): void {
  const focused = manager.isFocused.bind(manager);
  manager.isFocused = () => focused() && !idle();
}
