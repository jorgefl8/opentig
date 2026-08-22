import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OpenTigRuntime } from '../../../src/main/runtime/OpenTigRuntime';
import type { OpenTigServerIdentity } from '../../../src/shared/server-protocol';
import { OpenTigSessionAuth } from './auth';
import { isAllowedOrigin } from './origin';
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
  allowedOrigins: ReadonlySet<string>;
  isReady(): boolean;
  onSessionsRevoked(sessionIds: readonly string[]): void;
  logger: OpenTigServerLogger;
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
    return sendJson(response, 200, {
      ...context.auth.descriptor(),
      authenticated: context.auth.authenticate(request.headers) !== null,
      mode: context.mode,
      ...context.identity,
    });
  }

  if (method === 'POST' && rawPath.startsWith('/api/')) {
    if (!isAllowedOrigin(request, context.allowedOrigins)) return sendJson(response, 403, { error: 'Forbidden origin.' });

    if (rawPath === '/api/auth/pair' || rawPath === '/api/auth/desktop') {
      const body = await readJsonObject(request, response);
      if (!body) return;
      const cookie = rawPath.endsWith('/pair')
        ? await context.auth.exchangePairingToken(body.token)
        : await context.auth.exchangeDesktopSecret(body.secret);
      if (!cookie) return sendJson(response, 401, { error: 'Authentication failed.' });
      return sendJson(response, 204, null, { 'Set-Cookie': cookie });
    }

    if (rawPath === '/api/auth/logout') {
      const sessionId = await context.auth.revoke(request.headers);
      if (!sessionId) return sendJson(response, 401, { error: 'Authentication required.' });
      context.onSessionsRevoked([sessionId]);
      return sendJson(response, 204, null, { 'Set-Cookie': context.auth.expiredCookie() });
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
