/** Widths the desktop sidebar can take, in CSS pixels. Settings normalizes the stored width to the same range. */
export const SIDEBAR_MIN_WIDTH = 300;
export const SIDEBAR_MAX_WIDTH = 680;
export const SIDEBAR_DEFAULT_WIDTH = 400;
/** Releasing a drag below this width collapses the sidebar to its rail. */
export const SIDEBAR_COLLAPSE_THRESHOLD = 220;
/** How far one arrow-key press moves the resize handle. */
export const SIDEBAR_KEYBOARD_STEP = 16;

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width)));
}

export interface SidebarDrag {
  /** The width to keep: clamped, and unchanged by a drag that collapses. */
  width: number;
  /** The drag went past the threshold, so the sidebar folds into its rail on release. */
  collapse: boolean;
  /** What to paint while dragging: below the minimum it follows the pointer toward the rail. */
  previewWidth: number;
}

/** Turns a drag of the resize handle into the width to keep and whether it collapses. */
export function resolveSidebarDrag(startWidth: number, deltaX: number, railWidth: number): SidebarDrag {
  const raw = startWidth + deltaX;
  const collapse = raw < SIDEBAR_COLLAPSE_THRESHOLD;
  return {
    width: collapse ? clampSidebarWidth(startWidth) : clampSidebarWidth(raw),
    collapse,
    previewWidth: collapse ? Math.max(railWidth, Math.round(raw)) : clampSidebarWidth(raw),
  };
}

/** `Ctrl+B` → `Control+B`, the spelling `aria-keyshortcuts` expects. */
export function ariaKeyShortcut(combo: string): string {
  return combo.split('+').map((part) => part === 'Ctrl' ? 'Control' : part).join('+');
}
