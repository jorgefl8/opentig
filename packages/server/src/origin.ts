import type { IncomingMessage } from 'node:http';

export function isAllowedOrigin(request: IncomingMessage, explicitOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (explicitOrigins.has(normalized)) return true;

  const host = request.headers.host;
  if (!host) return false;
  return normalized === `http://${host.toLowerCase()}`;
}

export function normalizeOrigins(origins: readonly string[] = []): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const origin of origins) {
    const value = normalizeOrigin(origin);
    if (!value) throw new Error(`Invalid allowed origin: ${origin}`);
    normalized.add(value);
  }
  return normalized;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}
