import type { OpenTigWebAccessStatus } from './desktop-api';

export interface OpenTigWebAccessPatch {
  webAccessEnabled?: boolean;
  lanAccessEnabled?: boolean;
  publicOrigin?: string | null;
  listenerHost?: string;
  listenerPort?: number;
}

/** Listener configuration shared by every authenticated owner. */
export interface OpenTigBrowserWebAccessStatus {
  webAccessEnabled: boolean;
  pairingAvailable: boolean;
  listeningOnLan: boolean;
  listenerHost: string;
  actualPort: number;
  ready: boolean;
  configuration?: OpenTigWebAccessStatus;
  recoveryCommand?: string;
}

/** An address for link construction only, never an authentication allowlist. */
export function normalizePairingOrigin(value: string): string {
  const input = value.trim();
  if (!input || input.length > 2_048 || /[\s\\]/.test(input) || !/^https?:\/\/[^/?#]+\/?$/i.test(input)) throw new Error('Enter an HTTP or HTTPS address without a path, query, fragment, or credentials.');
  const url = new URL(input);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter an HTTP or HTTPS address without a path, query, fragment, or credentials.');
  }
  return url.origin;
}
