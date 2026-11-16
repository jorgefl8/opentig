import { useSyncExternalStore } from 'react';
import { formatTimeAgo } from '@shared/date-format';

/** How often the ages on screen are worked out again. */
export const AGE_TICK_MS = 30_000;

// One timer for every age on screen, running only while there is one.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticks = 0;
let tickedAt = Date.now();

function tick(): void {
  ticks += 1;
  tickedAt = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(tick, AGE_TICK_MS);
    // Ages that were hidden for a while, with the timer stopped, are worked out as they show again.
    if (Date.now() - tickedAt >= AGE_TICK_MS) tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const currentTick = () => ticks;

/**
 * How long ago `value` was, kept current while it is on screen. An age has no
 * other reason to be drawn again: the list it sits in redraws only when its
 * data changes.
 */
export function TimeAgo({ value }: { value: string }) {
  useSyncExternalStore(subscribe, currentTick, currentTick);
  return formatTimeAgo(value);
}
