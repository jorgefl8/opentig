import { useEffect, useMemo, useRef } from 'react';

/** How long the pointer rests on a row before what the row opens is read. */
export const INTENT_DELAY_MS = 150;

/**
 * Reads what a row opens once the pointer has rested on it, so the click shows
 * it instead of starting to load. Moving across rows asks for nothing, and a
 * finger asks for nothing either: it arrives with the tap.
 */
export function useIntentPrefetch<Target>(prefetch: (target: Target) => void): {
  rest(target: Target, event: { pointerType: string }): void;
  leave(): void;
} {
  const latest = useRef(prefetch);
  useEffect(() => { latest.current = prefetch; });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useMemo(() => ({
    rest: (target, event) => {
      clearTimeout(timer.current);
      if (event.pointerType !== 'mouse') return;
      timer.current = setTimeout(() => latest.current(target), INTENT_DELAY_MS);
    },
    leave: () => clearTimeout(timer.current),
  }), []);
}
