/**
 * Decides when the color preview shows, switches and hides, apart from the DOM
 * so the timing can be tested. A color shows after the pointer rests on it;
 * once one is showing, moving to another switches at once, like a tooltip
 * group; leaving every color hides it at once.
 */

export interface ColorHoverTarget {
  /** Identifies one color at one place; the same key means the same hover. */
  key: string;
}

interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ColorHoverController<T extends ColorHoverTarget> {
  /** The color now under the pointer, or null for none. */
  update(target: T | null): void;
  dispose(): void;
}

export function createColorHoverController<T extends ColorHoverTarget>({ delayMs, onChange, timers = globalThis as Timers }: {
  delayMs: number;
  onChange(target: T | null): void;
  timers?: Timers;
}): ColorHoverController<T> {
  let shown: T | null = null;
  let pending: { target: T; handle: unknown } | null = null;

  const cancel = () => {
    if (pending) timers.clearTimeout(pending.handle);
    pending = null;
  };
  const show = (target: T) => {
    cancel();
    shown = target;
    onChange(target);
  };

  return {
    update(target) {
      if (!target) {
        cancel();
        if (shown) {
          shown = null;
          onChange(null);
        }
        return;
      }
      if (shown?.key === target.key || pending?.target.key === target.key) return;
      if (shown) {
        show(target);
        return;
      }
      cancel();
      pending = { target, handle: timers.setTimeout(() => show(target), delayMs) };
    },
    dispose() {
      cancel();
      shown = null;
    },
  };
}
