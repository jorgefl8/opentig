import { useEffect, useState } from 'react';

/** True once `key` has stayed the same non-null value for `delayMs`; a new key or a null restarts the wait. */
export function useElapsed(key: string | null, delayMs: number): boolean {
  const [elapsedKey, setElapsedKey] = useState<string | null>(null);
  useEffect(() => {
    setElapsedKey(null);
    if (key === null) return;
    const timer = window.setTimeout(() => setElapsedKey(key), delayMs);
    return () => window.clearTimeout(timer);
  }, [key, delayMs]);
  return key !== null && elapsedKey === key;
}
