export const DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS = 30;
export const MIN_REMOTE_FETCH_INTERVAL_SECONDS = 5;
export const MAX_REMOTE_FETCH_INTERVAL_SECONDS = 300;
export const REMOTE_FETCH_INTERVAL_STEP_SECONDS = 5;

/** `0` disables periodic fetch. Any other value is clamped to the settings range. */
export function normalizeRemoteFetchIntervalSeconds(value: unknown): number {
  if (value === 0 || value === '0') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS;
  const rounded = Math.round(parsed);
  if (rounded <= 0) return 0;
  const stepped = Math.round(rounded / REMOTE_FETCH_INTERVAL_STEP_SECONDS) * REMOTE_FETCH_INTERVAL_STEP_SECONDS;
  return Math.min(
    MAX_REMOTE_FETCH_INTERVAL_SECONDS,
    Math.max(MIN_REMOTE_FETCH_INTERVAL_SECONDS, stepped),
  );
}

export function formatRemoteFetchInterval(seconds: number): string {
  return seconds <= 0 ? 'Off' : `${seconds}s`;
}
