export type PairingExchangeResult = 'paired' | 'rejected' | 'unavailable';
export type PairingSessionResult = 'authenticated' | 'unpaired' | 'unavailable';

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

type PairingRequest = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok'>>;

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
    return response.ok ? 'paired' : 'rejected';
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
