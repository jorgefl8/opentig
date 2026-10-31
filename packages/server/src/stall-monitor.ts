import type { OpenTigServerLogger } from './http';

const CHECK_INTERVAL_MS = 1_000;
/** Well below the time a client waits for a heartbeat before it disconnects. */
const STALL_THRESHOLD_MS = 5_000;

/**
 * Notes when the server stops running for a while. A stalled server can't log
 * anything at the time, and its clients only see a disconnect, so it says so
 * afterwards. Wall-clock time also counts a suspended machine, which timers can't tell apart.
 */
export function startStallMonitor(logger: OpenTigServerLogger, now: () => number = Date.now): () => void {
  let last = now();
  const timer = setInterval(() => {
    const current = now();
    const stalledMs = current - last - CHECK_INTERVAL_MS;
    last = current;
    if (stalledMs < STALL_THRESHOLD_MS) return;
    try { logger('warn', `Server was unresponsive for ${Math.round(stalledMs)} ms: its event loop was blocked or the machine was suspended.`); }
    catch { /* Diagnostics must not stop the server. */ }
  }, CHECK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
