/**
 * Restores a scroll position expressed as a 0-1 fraction on a target whose
 * content is still growing.
 *
 * Both sides of the Markdown Preview/Code split settle late: the preview keeps
 * resizing while Mermaid diagrams, KaTeX, and images lay out, and the code
 * editor streams syntax highlighting into a virtualizer that only knows its
 * real height once rows are measured. Applying the fraction once on mount lands
 * on the wrong line in both cases, so the sync reapplies every frame until the
 * content height stops changing, and stops early if the user scrolls.
 */
export interface ScrollSyncTarget {
  /** Scrollable distance in pixels; 0 when the content fits. */
  getScrollRange(): number;
  /** Current scroll offset in pixels. */
  getScrollTop(): number;
  /** Content height, used to detect that layout is still settling. */
  getContentHeight(): number;
  scrollTo(top: number): void;
}

export interface ScrollSyncOptions {
  /** Frames the content height must hold steady before the sync stops. */
  stableFrames?: number;
  /** Hard cap so a target that never settles cannot keep the loop alive. */
  maxFrames?: number;
  /** Pixels the target may drift from the applied offset before it counts as a user scroll. */
  userScrollTolerance?: number;
  requestFrame?(callback: () => void): number;
  cancelFrame?(handle: number): void;
}

const DEFAULTS = {
  stableFrames: 3,
  // ~1s at 60fps: long enough for a large file to finish highlighting, short
  // enough that a stuck target releases the scroll back to the user quickly.
  maxFrames: 60,
  userScrollTolerance: 2,
};

/**
 * Scrolls `target` to `fraction` of its range and keeps reapplying it until the
 * content height settles. Returns a cancel function; calling it, or the user
 * scrolling the target, ends the sync.
 */
export function syncScrollFraction(
  target: ScrollSyncTarget,
  fraction: number,
  options: ScrollSyncOptions = {},
): () => void {
  const stableFrames = options.stableFrames ?? DEFAULTS.stableFrames;
  const maxFrames = options.maxFrames ?? DEFAULTS.maxFrames;
  const tolerance = options.userScrollTolerance ?? DEFAULTS.userScrollTolerance;
  const requestFrame = options.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));

  const wanted = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  let handle: number | null = null;
  let frames = 0;
  let steadyFrames = 0;
  let lastHeight: number | null = null;
  let lastApplied: number | null = null;
  let cancelled = false;

  const stop = () => {
    cancelled = true;
    if (handle !== null) cancelFrame(handle);
    handle = null;
  };

  const step = () => {
    handle = null;
    if (cancelled) return;
    frames += 1;

    const height = target.getContentHeight();
    // A scroll offset we did not write, while the content height held steady,
    // can only come from the user; leave their position alone.
    if (lastApplied !== null && lastHeight === height && Math.abs(target.getScrollTop() - lastApplied) > tolerance) {
      stop();
      return;
    }

    const range = target.getScrollRange();
    const top = range > 0 ? wanted * range : 0;
    target.scrollTo(top);
    lastApplied = top;

    // A height of 0 means the target has not rendered yet (a virtualizer that
    // is still mounting, say), so it must not be mistaken for settled content.
    steadyFrames = height > 0 && lastHeight === height ? steadyFrames + 1 : 0;
    lastHeight = height;

    if (steadyFrames >= stableFrames || frames >= maxFrames) {
      stop();
      return;
    }
    handle = requestFrame(step);
  };

  step();
  return stop;
}
