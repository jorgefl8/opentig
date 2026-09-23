const RENEWAL_INTERVAL_MS = 60 * 60 * 1_000;
const RETRY_DELAY_MS = 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10 * 1_000;

interface SessionRenewalOptions {
  request?: typeof fetch;
  page?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  lifecycle?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** Refresh HttpOnly browser access while the app is in use, without restarting its socket. */
export function maintainBrowserSession({ request = fetch, page = document, lifecycle = window }: SessionRenewalOptions = {}): () => void {
  let stopped = false;
  let pending: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const retryLater = () => {
    if (!stopped) retry = setTimeout(() => { void renew(); }, RETRY_DELAY_MS);
  };
  const renew = async () => {
    if (stopped || pending || page.visibilityState !== 'visible') return;
    clearTimeout(retry);
    const controller = new AbortController();
    pending = controller;
    timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await request('/api/auth/renew', {
        method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
      });
      // Expired/revoked sessions need pairing; transport authentication handles that state.
      if (!response.ok && response.status !== 401 && response.status !== 403) retryLater();
    } catch {
      retryLater();
    } finally {
      clearTimeout(timeout);
      pending = null;
    }
  };
  const wake = () => { void renew(); };
  const interval = setInterval(wake, RENEWAL_INTERVAL_MS);
  page.addEventListener('visibilitychange', wake);
  lifecycle.addEventListener('focus', wake);
  lifecycle.addEventListener('online', wake);
  wake();

  return () => {
    stopped = true;
    clearInterval(interval);
    clearTimeout(retry);
    clearTimeout(timeout);
    pending?.abort();
    page.removeEventListener('visibilitychange', wake);
    lifecycle.removeEventListener('focus', wake);
    lifecycle.removeEventListener('online', wake);
  };
}
