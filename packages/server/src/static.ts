import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
/** Text worth compressing; images other than SVG, fonts and WebAssembly are compressed already or barely shrink. */
const COMPRESSIBLE = new Set(['.css', '.html', '.js', '.mjs', '.json', '.svg']);
/** Below this, compressing saves less than it costs. */
const MIN_COMPRESSED_BYTES = 1024;
/** Compressed files kept in memory, so each is compressed once per run; the least recently served go first. */
const COMPRESSED_CACHE_BYTES = 48 * 1024 * 1024;
const compressedCache = new Map<string, Buffer>();
let compressedCacheBytes = 0;

/** How a response may be encoded: by the request's `Accept-Encoding`, and never for a browser on this machine. */
export interface StaticEncoding {
  acceptEncoding?: string | undefined;
  /** A browser on this machine, which gains nothing from compression and would only wait for it. */
  local?: boolean;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const STATIC_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; font-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // Native same-origin form POSTs need a non-null Origin for CSRF checks.
  // External destinations still receive no referrer.
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function serveStatic(clientRoot: string, rawUrl: string, response: ServerResponse, dev = false, encoding: StaticEncoding = {}): Promise<void> {
  const rawPath = rawUrl.split(/[?#]/, 1)[0] ?? '/';
  // File icons carry the fingerprint of the icon set in their address (`?v=`), so they can be kept for good.
  const versioned = /[?&]v=[0-9a-f]{6,64}(?:&|#|$)/.test(rawUrl.slice(rawPath.length));
  const decodedPath = decodePath(rawPath);
  if (!decodedPath) return sendText(response, 400, 'Bad request.');

  const root = await realpath(clientRoot);
  const requested = decodedPath === '/' ? '/index.html' : decodedPath;
  const requestedFile = await safeExistingFile(root, requested);
  if (requestedFile) return serveFile(requestedFile, requested, response, dev, encoding, versioned);

  if (path.posix.extname(requested)) return sendText(response, 404, 'Not found.');
  const indexFile = await safeExistingFile(root, '/index.html');
  if (!indexFile) return sendText(response, 404, 'Not found.');
  return serveFile(indexFile, '/index.html', response, dev, encoding, false);
}

async function serveFile(filePath: string, urlPath: string, response: ServerResponse, dev: boolean, encoding: StaticEncoding, versioned: boolean): Promise<void> {
  if (!dev || urlPath !== '/index.html') return streamFile(filePath, urlPath, response, encoding, versioned);
  // The same client assets serve either profile, including unauthenticated pairing.
  const html = (await readFile(filePath, 'utf8'))
    .replace(/<html\b/i, '<html data-opentig-profile="dev"')
    .replace(/<title>[^<]*<\/title>/i, '<title>OpenTig Dev</title>')
    .replace('<strong>OpenTig</strong>', '<strong>OpenTig Dev</strong>')
    .replace('id="boot-shell" aria-label="OpenTig"', 'id="boot-shell" aria-label="OpenTig Dev"');
  response.writeHead(200, { ...STATIC_SECURITY_HEADERS, 'Cache-Control': 'no-cache', 'Content-Type': MIME_TYPES['.html']! });
  response.end(html);
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

async function streamFile(filePath: string, urlPath: string, response: ServerResponse, encoding: StaticEncoding, versioned: boolean): Promise<void> {
  const extension = path.extname(filePath).toLowerCase();
  const compressible = COMPRESSIBLE.has(extension);
  const headers = {
    ...STATIC_SECURITY_HEADERS,
    'Cache-Control': urlPath === '/index.html'
      ? 'no-cache'
      : /-[a-zA-Z0-9_-]{8,}\.[^.]+$/.test(urlPath) || (versioned && urlPath.startsWith('/vscode-icons/'))
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
    ...(compressible ? { Vary: 'Accept-Encoding' } : {}),
  };
  const contentEncoding = compressible && !encoding.local ? chooseEncoding(encoding.acceptEncoding) : null;
  if (contentEncoding) {
    const compressed = await compressedFile(filePath, contentEncoding);
    if (compressed) {
      response.writeHead(200, { ...headers, 'Content-Encoding': contentEncoding, 'Content-Length': compressed.length });
      response.end(compressed);
      return;
    }
  }
  response.writeHead(200, headers);
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    response.on('finish', resolve);
    response.on('close', resolve);
    stream.pipe(response);
  });
}

function chooseEncoding(acceptEncoding: string | undefined): 'br' | 'gzip' | null {
  const accepted = new Map((acceptEncoding ?? '').toLowerCase().split(',').map((part) => {
    const [name = '', ...parameters] = part.trim().split(';');
    const quality = parameters.map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter)?.[1]).find(Boolean);
    return [name.trim(), quality === undefined ? 1 : Number(quality)] as const;
  }));
  if ((accepted.get('br') ?? 0) > 0) return 'br';
  if ((accepted.get('gzip') ?? 0) > 0) return 'gzip';
  return null;
}

/** The file compressed, from memory after the first time; null for a file too small to bother. */
async function compressedFile(filePath: string, encoding: 'br' | 'gzip'): Promise<Buffer | null> {
  const info = await stat(filePath);
  if (info.size < MIN_COMPRESSED_BYTES || info.size > COMPRESSED_CACHE_BYTES / 4) return null;
  const key = `${encoding}\0${info.mtimeMs}\0${info.size}\0${filePath}`;
  const cached = compressedCache.get(key);
  if (cached) {
    compressedCache.delete(key);
    compressedCache.set(key, cached);
    return cached;
  }
  const contents = await readFile(filePath);
  // A middle quality: most of the saving, at a cost paid once per file and run.
  const compressed = encoding === 'br'
    ? await brotli(contents, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: contents.length } })
    : await gzipAsync(contents, { level: 6 });
  compressedCache.set(key, compressed);
  compressedCacheBytes += compressed.length;
  for (const [oldKey, oldValue] of compressedCache) {
    if (compressedCacheBytes <= COMPRESSED_CACHE_BYTES) break;
    compressedCache.delete(oldKey);
    compressedCacheBytes -= oldValue.length;
  }
  return compressed;
}

export function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { ...STATIC_SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function isSameOrInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
