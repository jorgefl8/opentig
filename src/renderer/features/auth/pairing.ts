export type PairingExchangeResult = 'paired' | 'rejected' | 'unavailable' | 'disabled';
export type PairingSessionResult = 'authenticated' | 'unpaired' | 'unavailable' | 'disabled';

/** A failed check must not be mistaken for a missing browser session. */
export async function checkPairingSession(
  signal: AbortSignal,
  request: (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>> = fetch,
): Promise<PairingSessionResult> {
  try {
    const response = await request('/api/auth/descriptor', { credentials: 'include', cache: 'no-store', signal });
    if (!response.ok) return 'unavailable';
    const descriptor: unknown = await response.json();
    if (!descriptor || typeof descriptor !== 'object' || !('authenticated' in descriptor)) return 'unavailable';
    if (descriptor.authenticated === true) return 'authenticated';
    if ('browserAccessEnabled' in descriptor && descriptor.browserAccessEnabled === false) return 'disabled';
    return descriptor.authenticated === false ? 'unpaired' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

interface PairingLocation {
  pathname: string;
  search: string;
  hash: string;
}

interface PairingHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

type PairingRequest = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok'> & Partial<Pick<Response, 'status' | 'json'>>>;

/** Reads and immediately removes a fragment credential without persisting it. */
export function consumePairingFragment(location: PairingLocation, history: PairingHistory): string {
  const fragment = location.hash;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment).get('token') ?? '';
}

export async function exchangePairingToken(
  token: string,
  clientName: string,
  request: PairingRequest = fetch,
): Promise<PairingExchangeResult> {
  try {
    const response = await request('/api/auth/pair', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, clientName }),
    });
    if (response.ok) return 'paired';
    if (response.status === 403 && response.json) {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'code' in body && body.code === 'WEB_ACCESS_DISABLED') return 'disabled';
    }
    return 'rejected';
  } catch {
    return 'unavailable';
  }
}

export function defaultDeviceName(userAgent: string): string {
  const browser = ([
    [/Edg\//, 'Edge'],
    [/Firefox\//, 'Firefox'],
    [/OPR\//, 'Opera'],
    [/Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari'],
  ] satisfies Array<[RegExp, string]>).find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser';
  const os = ([
    [/Windows NT/, 'Windows'],
    [/Android/, 'Android'],
    [/(?:iPhone|iPod)/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/CrOS/, 'ChromeOS'],
    [/Macintosh|Mac OS X/, 'Mac'],
    [/Linux/, 'Linux'],
  ] satisfies Array<[RegExp, string]>).find(([pattern]) => pattern.test(userAgent))?.[1];
  return os ? `${browser} on ${os}` : browser;
}

const RETURN_ADDRESS_KEY = 'opentig.pairing.return';

/** Keeps the app address a browser without a session was opened on, to return to once it is paired. */
export function rememberReturnAddress(location: Pick<Location, 'pathname' | 'search' | 'hash'>, storage: Pick<Storage, 'setItem'> = window.sessionStorage): void {
  if (location.pathname !== '/r' && !location.pathname.startsWith('/r/')) return;
  try { storage.setItem(RETURN_ADDRESS_KEY, `${location.pathname}${location.search}${location.hash}`); } catch { /* storage unavailable: pairing ends on the start page */ }
}

/**
 * Where pairing ends: the app address kept before it, if it still is one of this
 * origin's app addresses, or the start page. The kept value is used once.
 */
export function pairedDestination(origin: string, storage: Pick<Storage, 'getItem' | 'removeItem'> = window.sessionStorage): string {
  let kept: string | null = null;
  try {
    kept = storage.getItem(RETURN_ADDRESS_KEY);
    storage.removeItem(RETURN_ADDRESS_KEY);
  } catch { /* storage unavailable */ }
  if (!kept || !kept.startsWith('/r/') || kept.startsWith('//')) return '/';
  try {
    const url = new URL(kept, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/r/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
