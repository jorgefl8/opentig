import { useLayoutEffect, useRef, useState } from 'react';

type Handlers = Record<string, ((...args: never[]) => unknown) | undefined>;

/**
 * The same functions on every render, each calling the one passed in the latest
 * render. For handing callbacks to a memoized component, which then redraws only
 * when what it shows changes. Only for event handlers: a component that must react
 * to a callback changing, in an effect's dependencies, needs the callback itself.
 */
export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  const [stable] = useState(() => {
    const result: Record<string, (...args: never[]) => unknown> = {};
    for (const name of Object.keys(handlers)) {
      result[name] = (...args: never[]) => (latest.current[name] as ((...callArgs: never[]) => unknown) | undefined)?.(...args);
    }
    return result as T;
  });
  return stable;
}
