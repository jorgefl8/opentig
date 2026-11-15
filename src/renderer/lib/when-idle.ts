/**
 * Runs `run` once the browser has nothing more urgent to do, or soon after
 * where it cannot tell. Returns how to call it off.
 */
export function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 2_000 });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, 200);
  return () => clearTimeout(timer);
}
