import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import type { OpenTigServerIdentity } from '../../../src/shared/server-protocol';
import type { OpenTigOwnerSession } from '../../../src/shared/server-protocol';
import { OpenTigSessionAuth } from './auth';
import { isAllowedOrigin, requestOriginIsSecure } from './origin';
import { serveStatic, STATIC_SECURITY_HEADERS } from './static';

const AUTH_BODY_LIMIT = 64 * 1024;

export type OpenTigServerMode = 'desktop' | 'web-access';
export type OpenTigServerLogger = (level: 'info' | 'warn' | 'error', message: string) => void;

export interface OpenTigHttpContext {
  runtime: OpenTigRuntime;
  clientRoot: string;
  auth: OpenTigSessionAuth;
  identity: OpenTigServerIdentity;
  mode: OpenTigServerMode;
  isReady(): boolean;
  sessionConnectionCount(sessionId: string): number;
  onSessionsRevoked(sessionIds: readonly string[]): void;
  logger: OpenTigServerLogger;
  admin?: {
    token: string;
    instanceId: string;
    createPairingToken(): { token: string; expiresAt: string };
  };
}

export function createOpenTigHttpHandler(context: OpenTigHttpContext) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      await handleRequest(context, request, response);
    } catch {
      context.logger('error', 'HTTP request failed.');
      if (!response.headersSent) sendJson(response, 500, { error: 'Internal server error.' });
      else response.destroy();
    }
  };
}

async function handleRequest(context: OpenTigHttpContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const rawPath = (request.url ?? '/').split(/[?#]/, 1)[0] ?? '/';

  if (method === 'GET' && rawPath === '/healthz') return sendJson(response, 200, { status: 'ok' });
  if (method === 'GET' && rawPath === '/readyz') {
    return sendJson(response, context.isReady() ? 200 : 503, {
      status: context.isReady() ? 'ready' : 'not-ready',
      ...context.identity,
    });
  }
  if (method === 'GET' && rawPath === '/api/auth/descriptor') {
    const currentSessionId = context.auth.authenticate(request.headers);
    return sendJson(response, 200, {
      ...context.auth.descriptor(),
      authenticated: currentSessionId !== null,
      currentSessionKind: currentSessionId
        ? context.auth.sessions().find((session) => session.id === currentSessionId)?.kind ?? null
        : null,
      mode: context.mode,
      ...context.identity,
    });
  }

  if (method === 'GET' && rawPath === '/api/auth/sessions') {
    const currentSessionId = context.auth.authenticate(request.headers);
    if (!currentSessionId) return sendJson(response, 401, { error: 'Authentication required.' });
    const sessions: OpenTigOwnerSession[] = context.auth.sessions().map((session) => {
      const connectionCount = context.sessionConnectionCount(session.id);
      return {
        ...session,
        connected: connectionCount > 0,
        connectionCount,
        current: session.id === currentSessionId,
      };
    });
    return sendJson(response, 200, { sessions });
  }

  if (method === 'POST' && rawPath === '/api/admin/pair') {
    return handleLocalAdminPair(context, request, response);
  }

  if (method === 'POST' && rawPath.startsWith('/api/')) {
    if (!isAllowedOrigin(request)) return sendJson(response, 403, { error: 'Forbidden origin.' });

    if (rawPath === '/api/auth/pair' || rawPath === '/api/auth/desktop') {
      const body = await readJsonObject(request, response);
      if (!body) return;
      const secure = requestOriginIsSecure(request);
      let cookie: string | null;
      if (rawPath.endsWith('/pair')) {
        const clientName = normalizeClientName(body.clientName);
        if (!clientName) return sendJson(response, 400, { error: 'Enter a device name between 1 and 64 characters.' });
        cookie = await context.auth.exchangePairingToken(body.token, browserSessionMetadata(request, clientName), secure);
      } else {
        cookie = await context.auth.exchangeDesktopSecret(body.secret);
      }
      if (!cookie) return sendJson(response, 401, { error: 'Authentication failed.' });
      return sendJson(response, 204, null, { 'Set-Cookie': cookie });
    }

    if (rawPath === '/api/auth/logout') {
      const sessionId = await context.auth.revoke(request.headers);
      if (!sessionId) return sendJson(response, 401, { error: 'Authentication required.' });
      context.onSessionsRevoked([sessionId]);
      return sendJson(response, 204, null, { 'Set-Cookie': context.auth.expiredCookie(requestOriginIsSecure(request)) });
    }


    if (rawPath === '/api/auth/sessions/revoke') {
      const currentSessionId = context.auth.authenticate(request.headers);
      if (!currentSessionId) return sendJson(response, 401, { error: 'Authentication required.' });
      const body = await readJsonObject(request, response);
      if (!body) return;
      if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(body.sessionId)) {
        return sendJson(response, 400, { error: 'Invalid session.' });
      }
      if (!await context.auth.revokeBrowserSession(body.sessionId)) {
        return sendJson(response, 404, { error: 'Browser session not found.' });
      }
      context.onSessionsRevoked([body.sessionId]);
      return sendJson(response, 200, { revokedCount: 1 }, body.sessionId === currentSessionId
        ? { 'Set-Cookie': context.auth.expiredCookie(requestOriginIsSecure(request)) }
        : {});
    }

    if (rawPath === '/api/auth/sessions/rename') {
      const currentSessionId = context.auth.authenticate(request.headers);
      if (!currentSessionId) return sendJson(response, 401, { error: 'Authentication required.' });
      const body = await readJsonObject(request, response);
      if (!body) return;
      if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(body.sessionId)) {
        return sendJson(response, 400, { error: 'Invalid session.' });
      }
      const clientName = normalizeClientName(body.clientName);
      if (!clientName) return sendJson(response, 400, { error: 'Enter a device name between 1 and 64 characters.' });
      if (!await context.auth.renameBrowserSession(body.sessionId, clientName)) {
        return sendJson(response, 404, { error: 'Browser session not found.' });
      }
      return sendJson(response, 200, { renamed: true });
    }

    if (rawPath === '/api/auth/sessions/revoke-all') {
      const currentSessionId = context.auth.authenticate(request.headers);
      if (!currentSessionId) return sendJson(response, 401, { error: 'Authentication required.' });
      const revoked = await context.auth.revokeBrowserSessions();
      context.onSessionsRevoked(revoked);
      return sendJson(response, 200, { revokedCount: revoked.length }, revoked.includes(currentSessionId)
        ? { 'Set-Cookie': context.auth.expiredCookie(requestOriginIsSecure(request)) }
        : {});
    }

    if (rawPath === '/api/auth/revoke-all') {
      const sessionId = context.auth.authenticate(request.headers);
      if (!sessionId) return sendJson(response, 401, { error: 'Authentication required.' });
      const revoked = await context.auth.revokeAll();
      context.onSessionsRevoked(revoked);
      return sendJson(response, 204, null, { 'Set-Cookie': context.auth.expiredCookie() });
    }
  }

  if (method === 'GET' && rawPath.startsWith('/api/image/')) {
    const sessionId = context.auth.authenticate(request.headers);
    if (!sessionId) return sendJson(response, 401, { error: 'Authentication required.' });
    const target = parseImageTarget(rawPath);
    if (!target) return sendJson(response, 400, { error: 'Invalid image path.' });
    const result = await context.runtime.services.files.readImage(target.repositoryId, target.path);
    if (result.status === 'too-large') return sendJson(response, 413, result);
    if (result.status === 'unsupported') return sendJson(response, 415, result);
    const bytes = Buffer.from(result.data);
    response.writeHead(200, {
      ...STATIC_SECURITY_HEADERS,
      'Cache-Control': 'private, no-store',
      'Content-Length': String(bytes.byteLength),
      'Content-Type': result.mimeType,
      'X-OpenTig-Mtime-Ms': String(result.mtimeMs),
    });
    response.end(bytes);
    return;
  }

  if (rawPath.startsWith('/api/')) return sendJson(response, 404, { error: 'Not found.' });
  if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
  await serveStatic(context.clientRoot, request.url ?? '/', response);
}

function browserSessionMetadata(request: IncomingMessage, clientName: string): {
  clientName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  os: string | null;
  browser: string | null;
  remoteAddress: string | null;
  viaProxy: boolean;
} {
  const userAgent = Array.isArray(request.headers['user-agent']) ? undefined : request.headers['user-agent'];
  const proxy = isLoopbackAddress(request.socket.remoteAddress) ? forwardedClientAddress(request) : null;
  return {
    clientName,
    deviceType: deviceType(userAgent),
    os: operatingSystem(userAgent),
    browser: browserName(userAgent),
    remoteAddress: proxy ?? normalizedRemoteAddress(request.socket.remoteAddress),
    viaProxy: proxy !== null || Boolean(request.headers.forwarded || request.headers['x-forwarded-host']),
  };
}

function browserName(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const candidates: Array<[RegExp, string]> = [
    [/Edg\//, 'Microsoft Edge'],
    [/Firefox\//, 'Firefox'],
    [/OPR\//, 'Opera'],
    [/Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari'],
  ];
  return candidates.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

function operatingSystem(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const candidates: Array<[RegExp, string]> = [
    [/Windows NT/, 'Windows'],
    [/Android/, 'Android'],
    [/(?:iPhone|iPod)/, 'iOS'],
    [/iPad/, 'iPadOS'],
    [/CrOS/, 'ChromeOS'],
    [/Macintosh|Mac OS X/, 'macOS'],
    [/Linux/, 'Linux'],
  ];
  return candidates.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

function deviceType(userAgent: string | undefined): 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown' {
  if (!userAgent) return 'unknown';
  if (/bot|crawler|spider|headless/i.test(userAgent)) return 'bot';
  if (/iPad|Tablet/i.test(userAgent)) return 'tablet';
  if (/Mobile|iPhone|iPod|Android/i.test(userAgent)) return 'mobile';
  if (/Windows NT|Macintosh|CrOS|Linux/i.test(userAgent)) return 'desktop';
  return 'unknown';
}

function forwardedClientAddress(request: IncomingMessage): string | null {
  const cloudflare = singleHeader(request.headers['cf-connecting-ip']);
  if (cloudflare) return normalizedRemoteAddress(cloudflare);
  const forwardedFor = singleHeader(request.headers['x-forwarded-for'])?.split(',', 1)[0]?.trim();
  return normalizedRemoteAddress(forwardedFor);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedRemoteAddress(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  return isIP(normalized) ? normalized : null;
}

function normalizeClientName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 64 && ![...name].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  }) ? name : null;
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  return normalized === '::1' || normalized.startsWith('127.');
}

async function handleLocalAdminPair(
  context: OpenTigHttpContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const admin = context.admin;
  const suppliedToken = request.headers['x-opentig-admin'];
  if (!admin
    || !isLocalAddress(request.socket.remoteAddress)
    || typeof suppliedToken !== 'string'
    || !sameSecret(admin.token, suppliedToken)) {
    return sendJson(response, 404, { error: 'Not found.' });
  }
  const body = await readJsonObject(request, response);
  if (!body) return;
  if (body.instanceId !== admin.instanceId || typeof body.publicOrigin !== 'string') {
    return sendJson(response, 409, { error: 'OpenTig server identity mismatch.' });
  }
  const origin = normalizePublicOrigin(body.publicOrigin);
  if (!origin) return sendJson(response, 400, { error: 'Invalid public origin.' });
  const pairing = admin.createPairingToken();
  const url = new URL('/pair', origin);
  url.hash = new URLSearchParams({ token: pairing.token }).toString();
  return sendJson(response, 200, { url: url.href, expiresAt: pairing.expiresAt });
}

function parseImageTarget(rawPath: string): { repositoryId: string; path: string } | null {
  try {
    const decoded = decodeURIComponent(rawPath.slice('/api/image/'.length));
    if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null;
    const parts = decoded.split('/');
    const repositoryId = parts.shift();
    if (!repositoryId || repositoryId.length > 64 || parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..')) return null;
    return { repositoryId, path: parts.join('/') };
  } catch {
    return null;
  }
}

function isLocalAddress(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  return Object.values(networkInterfaces()).flat().some((address) => address?.address === normalized);
}

function sameSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function normalizePublicOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function readJsonObject(request: IncomingMessage, response: ServerResponse): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > AUTH_BODY_LIMIT) {
    sendJson(response, 413, { error: 'Request body is too large.' });
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > AUTH_BODY_LIMIT) {
      sendJson(response, 413, { error: 'Request body is too large.' });
      return null;
    }
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, unknown>;
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON body.' });
    return null;
  }
}

export function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  const body = status === 204 ? '' : JSON.stringify(value);
  response.writeHead(status, {
    ...STATIC_SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(body);
}
