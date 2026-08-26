import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, requestOriginIsSecure } from './origin';

describe('request origin policy', () => {
  it('accepts an exact direct authority and allows local TLS termination', () => {
    expect(isAllowedOrigin(request('http://127.0.0.1:6767', '127.0.0.1:6767'))).toBe(true);
    expect(isAllowedOrigin(request('https://opentig.example.com', 'opentig.example.com'))).toBe(true);
    expect(requestOriginIsSecure(request('https://opentig.example.com', 'opentig.example.com'))).toBe(true);
  });

  it('accepts a reverse-proxy authority only when the immediate peer is loopback', () => {
    expect(isAllowedOrigin(request(
      'https://opentig.example.com',
      '127.0.0.1:6767',
      '127.0.0.1',
      { 'x-forwarded-host': 'opentig.example.com' },
    ))).toBe(true);
    expect(isAllowedOrigin(request(
      'https://opentig.example.com',
      '127.0.0.1:6767',
      '192.168.1.20',
      { 'x-forwarded-host': 'opentig.example.com' },
    ))).toBe(false);
  });

  it('rejects mismatched and malformed origins', () => {
    expect(isAllowedOrigin(request('https://evil.example', 'opentig.example.com'))).toBe(false);
    expect(isAllowedOrigin(request('https://opentig.example.com/path', 'opentig.example.com'))).toBe(false);
    expect(isAllowedOrigin(request(undefined, 'opentig.example.com'))).toBe(false);
  });
});

function request(
  origin: string | undefined,
  host: string,
  remoteAddress = '127.0.0.1',
  additionalHeaders: Record<string, string> = {},
): IncomingMessage {
  return {
    headers: { ...(origin ? { origin } : {}), host, ...additionalHeaders },
    socket: { remoteAddress },
  } as IncomingMessage;
}
