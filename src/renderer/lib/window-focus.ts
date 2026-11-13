/** Switching windows back and forth quickly checks again at most this often. */
export const WINDOW_RETURN_MIN_GAP_MS = 10_000;

type FocusTarget = Pick<Window, 'addEventListener' | 'removeEventListener'> & { document: Pick<Document, 'visibilityState'> };

/**
 * A focus listener for TanStack Query's `focusManager` that also reacts to the
 * window regaining focus. The default one only listens to `visibilitychange`,
 * which switching back to a visible window (as with Alt+Tab from a terminal
 * where a PR was just created) doesn't fire, so `refetchOnWindowFocus` never ran.
 *
 * It only asks the focus manager to re-evaluate visibility, never sets a focus
 * state: polling that pauses for hidden windows keeps running for visible but
 * unfocused ones.
 */
export function listenForWindowReturn(target: FocusTarget, now: () => number = Date.now) {
  return (handleFocus: () => void): (() => void) => {
    let lastReturn = Number.NEGATIVE_INFINITY;
    const returned = () => {
      if (target.document.visibilityState === 'hidden') return;
      const at = now();
      // Becoming visible and gaining focus usually arrive together.
      if (at - lastReturn < WINDOW_RETURN_MIN_GAP_MS) return;
      lastReturn = at;
      handleFocus();
    };
    // Hiding needs no notice: interval polling reads the visibility itself on each tick.
    target.addEventListener('visibilitychange', returned, false);
    target.addEventListener('focus', returned, false);
    return () => {
      target.removeEventListener('visibilitychange', returned);
      target.removeEventListener('focus', returned);
    };
  };
}
