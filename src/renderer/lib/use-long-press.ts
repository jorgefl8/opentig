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
 */
export function useLongPress(onLongPress: () => void, { disabled = false, delay = LONG_PRESS_MS, tolerance = MOVE_TOLERANCE_PX }: { disabled?: boolean; delay?: number; tolerance?: number } = {}): LongPressHandlers {
  const callback = useRef(onLongPress);
  useEffect(() => { callback.current = onLongPress; });
  const press = useRef<{ x: number; y: number; id: number; timer: number; fired: boolean; stopWatchingScroll(): void } | null>(null);
  const swallowClick = useRef(false);
  const swallowTimer = useRef<number | undefined>(undefined);

  const end = () => {
    const current = press.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    current.stopWatchingScroll();
    press.current = null;
  };
  useEffect(() => () => { end(); window.clearTimeout(swallowTimer.current); }, []);

  const fire = () => {
    if (press.current) {
      if (press.current.fired) return;
      press.current.fired = true;
      window.clearTimeout(press.current.timer);
      swallowClick.current = true;
    }
    callback.current();
  };

  if (disabled) return NO_HANDLERS;
  return {
    onPointerDown(event) {
      end();
      swallowClick.current = false;
      window.clearTimeout(swallowTimer.current);
      // A mouse has its right click, and keeps pressing for selecting text.
      if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0 || isInnerControl(event.target, event.currentTarget)) return;
      const onScroll = () => end();
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
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
