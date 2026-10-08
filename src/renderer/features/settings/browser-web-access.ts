import type { OpenTigPairingLink } from '@shared/desktop-api';
import type { OpenTigBrowserWebAccessStatus } from '@shared/web-access';

export async function loadBrowserWebAccessStatus(): Promise<OpenTigBrowserWebAccessStatus> {
  return request('/api/auth/web-access');
}

export async function createBrowserPairingLink(): Promise<OpenTigPairingLink> {
  return request('/api/auth/pairing-link', 'POST');
}

async function request<T>(url: string, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method, credentials: 'include' });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'Could not read web access information.');
  return value as T;
}
