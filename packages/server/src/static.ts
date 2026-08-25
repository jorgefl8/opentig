import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const STATIC_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function serveStatic(clientRoot: string, rawUrl: string, response: ServerResponse): Promise<void> {
  const rawPath = rawUrl.split(/[?#]/, 1)[0] ?? '/';
  const decodedPath = decodePath(rawPath);
  if (!decodedPath) return sendText(response, 400, 'Bad request.');

  const root = await realpath(clientRoot);
  const requested = decodedPath === '/' ? '/index.html' : decodedPath;
  const requestedFile = await safeExistingFile(root, requested);
  if (requestedFile) return streamFile(requestedFile, requested, response);

  if (path.posix.extname(requested)) return sendText(response, 404, 'Not found.');
  const indexFile = await safeExistingFile(root, '/index.html');
  if (!indexFile) return sendText(response, 404, 'Not found.');
  return streamFile(indexFile, '/index.html', response);
}

function decodePath(rawPath: string): string | null {
  try {
    const decoded = decodeURIComponent(rawPath);
    if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return null;
    if (decoded.split('/').some((part) => part === '.' || part === '..')) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function safeExistingFile(root: string, urlPath: string): Promise<string | null> {
  const candidate = path.resolve(root, `.${urlPath}`);
  if (!isSameOrInside(root, candidate)) return null;
  try {
    const resolved = await realpath(candidate);
    if (!isSameOrInside(root, resolved) || !(await stat(resolved)).isFile()) return null;
    return resolved;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

function streamFile(filePath: string, urlPath: string, response: ServerResponse): Promise<void> {
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    ...STATIC_SECURITY_HEADERS,
    'Cache-Control': urlPath === '/index.html'
      ? 'no-cache'
      : /-[a-zA-Z0-9_-]{8,}\.[^.]+$/.test(urlPath)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
  });
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    response.on('finish', resolve);
    response.on('close', resolve);
    stream.pipe(response);
  });
}

export function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { ...STATIC_SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function isSameOrInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
