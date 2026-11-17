import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;
/** A press's click can arrive after the finger lifts; a later one is a new tap. */
const CLICK_AFTER_PRESS_MS = 400;
/** Any of these is a control of its own, unless it is the row's main target. */
const INNER_CONTROL = 'button, a, input, select, textarea, [role="button"]';

export interface LongPressHandlers {
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  onPointerMove(event: PointerEvent<HTMLElement>): void;
  onPointerUp(event: PointerEvent<HTMLElement>): void;
  onPointerCancel(event: PointerEvent<HTMLElement>): void;
  onPointerLeave(event: PointerEvent<HTMLElement>): void;
  onClickCapture(event: MouseEvent<HTMLElement>): void;
  onContextMenu(event: MouseEvent<HTMLElement>): void;
}

const NO_HANDLERS = {} as LongPressHandlers;

/**
 * Holding a finger on a row runs its second action, as does the browser's
 * `contextmenu`: Android fires it on long press, a mouse on right click, and a
 * keyboard on the menu key. Scrolling, moving, or a second finger cancels it, so
 * the row can sit in a list that scrolls. The click after a press is swallowed.
 *
 * Mark a nested button that is the row's main target with
 * `data-long-press-target`; presses on any other inner control are its own.
 * `onLongPress` returns false when it had nothing to do: the press is then an
 * ordinary click.
 */
export function useLongPress(onLongPress: () => void | boolean, { disabled = false, delay = LONG_PRESS_MS, tolerance = MOVE_TOLERANCE_PX, mouse = false }: {
  disabled?: boolean; delay?: number; tolerance?: number;
  /** A held mouse button counts too, for a button that has no text to select. */
  mouse?: boolean;
} = {}): LongPressHandlers {
  const callback = useRef(onLongPress);
  useEffect(() => { callback.current = onLongPress; });
  const press = useRef<{ x: number; y: number; id: number; timer: number; fired: boolean; stopWatchingScroll(): void } | null>(null);
  /** Stops listening for the end of a press anywhere on the page. */
  const stopWatchingRelease = useRef<(() => void) | null>(null);
  const swallowClick = useRef(false);
  const swallowTimer = useRef<number | undefined>(undefined);

  const end = () => {
    const current = press.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    current.stopWatchingScroll();
    press.current = null;
  };
  useEffect(() => () => { end(); stopWatchingRelease.current?.(); window.clearTimeout(swallowTimer.current); }, []);

  /** When a press last fired: Windows sends its own `contextmenu` for a held finger or pen once it lifts. */
  const firedAt = useRef(Number.NEGATIVE_INFINITY);
  const fire = () => {
    const current = press.current;
    if (current) {
      if (current.fired) return;
      current.fired = true;
      window.clearTimeout(current.timer);
      firedAt.current = Date.now();
    } else if (Date.now() - firedAt.current < CLICK_AFTER_PRESS_MS) {
      // The same gesture as the press that just fired.
      return;
    }
    // Nothing happened: the click that follows is the user's.
    if (callback.current() === false) return;
    if (current) swallowClick.current = true;
  };

  if (disabled) return NO_HANDLERS;
  return {
    onPointerDown(event) {
      end();
      swallowClick.current = false;
      window.clearTimeout(swallowTimer.current);
      // A mouse has its right click, and keeps pressing for selecting text.
      if ((event.pointerType === 'mouse' && !mouse) || !event.isPrimary || event.button !== 0 || isInnerControl(event.target, event.currentTarget)) return;
      const onScroll = () => end();
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      // Released anywhere else, as on the row of a menu the press opened, no click comes here to swallow,
      // and a later Enter or Space on this element must still work.
      const element = event.currentTarget;
      const pointerId = event.pointerId;
      stopWatchingRelease.current?.();
      const onRelease = (release: globalThis.PointerEvent) => {
        if (release.pointerId !== pointerId) return;
        stopWatchingRelease.current?.();
        end();
        if (!(release.target instanceof Node && element.contains(release.target))) swallowClick.current = false;
      };
      document.addEventListener('pointerup', onRelease, true);
      document.addEventListener('pointercancel', onRelease, true);
      stopWatchingRelease.current = () => {
        document.removeEventListener('pointerup', onRelease, true);
        document.removeEventListener('pointercancel', onRelease, true);
        stopWatchingRelease.current = null;
      };
      press.current = {
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        timer: window.setTimeout(fire, delay),
        fired: false,
        stopWatchingScroll: () => window.removeEventListener('scroll', onScroll, { capture: true }),
      };
    },
    onPointerMove(event) {
      const current = press.current;
      if (!current || current.fired || event.pointerId !== current.id) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > tolerance) end();
    },
    onPointerUp(event) {
      if (press.current && event.pointerId !== press.current.id) return;
      end();
      if (swallowClick.current) swallowTimer.current = window.setTimeout(() => { swallowClick.current = false; }, CLICK_AFTER_PRESS_MS);
    },
    onPointerCancel() {
      end();
      swallowClick.current = false;
    },
    onPointerLeave(event) {
      // Gone before it fired, however little it moved on the way: no long press.
      const current = press.current;
      if (current && !current.fired && event.pointerId === current.id) end();
    },
    onClickCapture(event) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu(event) {
      if (isInnerControl(event.target, event.currentTarget)) return;
      // Never the browser's own menu, even when this press already fired.
      event.preventDefault();
      fire();
    },
  };
}

function isInnerControl(target: EventTarget, row: Element): boolean {
  const control = (target as Partial<Element>).closest?.call(target, INNER_CONTROL);
  return Boolean(control) && control !== row && !control!.hasAttribute('data-long-press-target');
}
