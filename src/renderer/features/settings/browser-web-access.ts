import type { OpenTigPairingLink, OpenTigWebAccessApi, OpenTigWebAccessStatus } from '@shared/desktop-api';
import type { OpenTigBrowserWebAccessStatus, OpenTigWebAccessPatch } from '@shared/web-access';

export async function loadBrowserWebAccessStatus(): Promise<OpenTigBrowserWebAccessStatus> {
  return request('/api/auth/web-access');
}

export async function createBrowserPairingLink(endpoint?: string): Promise<OpenTigPairingLink> {
  return request('/api/auth/pairing-link', 'POST', endpoint && endpoint !== window.location.origin ? { endpoint } : undefined);
}

export function browserConfiguration(value: OpenTigBrowserWebAccessStatus): OpenTigWebAccessStatus {
  return value.configuration ?? {
    webAccessEnabled: value.webAccessEnabled, lanAccessEnabled: value.listeningOnLan,
    listeningOnLan: value.listeningOnLan, publicOrigin: null, listenerHost: value.listenerHost,
    serverState: value.ready ? 'ready' : 'starting', actualPort: value.actualPort,
    localEndpoint: `http://127.0.0.1:${value.actualPort}`, networkEndpoints: [], pairingEndpoints: [window.location.origin],
    connectedSessionCount: 0, restartError: null, ...(value.recoveryCommand ? { recoveryCommand: value.recoveryCommand } : {}),
  };
}

export function updateBrowserWebAccess(patch: OpenTigWebAccessPatch): Promise<OpenTigWebAccessStatus> {
  return request('/api/auth/web-access', 'POST', patch);
}

export const browserWebAccessApi: OpenTigWebAccessApi = {
  getStatus: async () => browserConfiguration(await loadBrowserWebAccessStatus()),
  setEnabled: (webAccessEnabled) => updateBrowserWebAccess({ webAccessEnabled }),
  setLanEnabled: (lanAccessEnabled) => updateBrowserWebAccess({ lanAccessEnabled }),
  setPublicOrigin: (publicOrigin) => updateBrowserWebAccess({ publicOrigin: publicOrigin || null }),
  createPairingLink: createBrowserPairingLink,
};

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'include', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'Could not read web access information.');
  return value as T;
}
