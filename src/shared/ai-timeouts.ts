/**
 * AI generation is deliberately long-running: large staged changes may need to
 * be understood and divided into several focused commits. Keep each outer
 * boundary above the one it contains so callers receive the real result or
 * provider error instead of racing an unrelated transport timeout.
 */
export const AI_PROVIDER_TIMEOUT_MS = 9 * 60_000;
export const AI_SERVER_TIMEOUT_MS = AI_PROVIDER_TIMEOUT_MS + 30_000;
export const AI_CLIENT_TIMEOUT_MS = AI_SERVER_TIMEOUT_MS + 30_000;

