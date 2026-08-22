export type PairingExchangeResult = 'paired' | 'missing-token' | 'rejected' | 'unavailable';

interface PairingLocation {
  pathname: string;
  search: string;
  hash: string;
}

interface PairingHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

type PairingRequest = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok'>>;

/** Exchanges a fragment credential without ever writing it to browser storage. */
export async function exchangePairingFragment(
  location: PairingLocation,
  history: PairingHistory,
  request: PairingRequest = fetch,
): Promise<PairingExchangeResult> {
  const fragment = location.hash;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  const token = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment).get('token');
  if (!token) return 'missing-token';

  try {
    const response = await request('/api/auth/pair', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return response.ok ? 'paired' : 'rejected';
  } catch {
    return 'unavailable';
  }
}
