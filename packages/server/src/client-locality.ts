import type { IncomingMessage } from 'node:http';

/**
 * A browser on this machine talking to the server directly: a loopback peer with no
 * proxy in between. A tunnel or reverse proxy on this machine also connects over
 * loopback, but says whom it forwards for, and its clients are remote.
 */
export function isDirectLocalClient(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (normalized !== '::1' && !normalized.startsWith('127.')) return false;
  const headers = request.headers;
  return !(headers.forwarded || headers['x-forwarded-for'] || headers['x-forwarded-host'] || headers['x-real-ip'] || headers['cf-connecting-ip']);
}
