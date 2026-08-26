import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/** Accept same-authority requests across trusted loopback TLS termination. */
export function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return false;
  const originAuthority = normalizeOriginAuthority(origin);
  if (!originAuthority) return false;

  const authorities = new Set<string>();
  const direct = normalizeAuthority(request.headers.host);
  if (direct) authorities.add(direct);
  if (isLoopbackAddress(request.socket.remoteAddress)) {
    const forwarded = forwardedHost(request);
    if (forwarded) authorities.add(forwarded);
  }
  return authorities.has(originAuthority);
}

export function requestOriginIsSecure(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return false;
  try { return new URL(origin).protocol === 'https:'; }
  catch { return false; }
}

function forwardedHost(request: IncomingMessage): string | null {
  const standard = request.headers.forwarded;
  const standardValue = Array.isArray(standard) ? standard[0] : standard;
  if (standardValue) {
    const first = standardValue.split(',', 1)[0] ?? '';
    for (const part of first.split(';')) {
      const match = /^\s*host\s*=\s*(?:"([^"]+)"|([^\s]+))\s*$/i.exec(part);
      const value = match?.[1] ?? match?.[2];
      const normalized = normalizeAuthority(value);
      if (normalized) return normalized;
    }
  }

  const forwarded = request.headers['x-forwarded-host'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',', 1)[0];
  return normalizeAuthority(value);
}

function normalizeOriginAuthority(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeAuthority(value: string | undefined): string | null {
  if (!value || value.length > 512 || /[\s/?#@\\]/.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    return url.pathname === '/' && !url.search && !url.hash ? url.host.toLowerCase() : null;
  } catch { return null; }
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  if (normalized === '::1') return true;
  return isIP(normalized) === 4 && normalized.startsWith('127.');
}
