import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RepositoryFavicon } from '../../shared/contracts';
import { detectRasterImageMime } from '../../shared/image-types';
import {
  extractIconHref,
  faviconMimeFromPath,
  localIconHrefCandidates,
  REPOSITORY_FAVICON_CANDIDATES,
  REPOSITORY_FAVICON_MAX_BYTES,
  REPOSITORY_FAVICON_SOURCE_FILES,
} from '../../shared/repository-favicon';

export async function readRepositoryFavicon(rootPath: string): Promise<RepositoryFavicon | null> {
  const root = path.resolve(rootPath);
  for (const candidate of REPOSITORY_FAVICON_CANDIDATES) {
    const favicon = await readCandidate(root, candidate);
    if (favicon) return favicon;
  }
  for (const sourceFile of REPOSITORY_FAVICON_SOURCE_FILES) {
    const source = await readSource(root, sourceFile);
    if (!source) continue;
    const href = extractIconHref(source);
    if (!href) continue;
    for (const candidate of localIconHrefCandidates(href)) {
      const favicon = await readCandidate(root, candidate);
      if (favicon) return favicon;
    }
  }
  return null;
}

async function readCandidate(root: string, relativePath: string): Promise<RepositoryFavicon | null> {
  const target = resolveWithinRoot(root, relativePath);
  if (!target) return null;
  try {
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > REPOSITORY_FAVICON_MAX_BYTES) return null;
    const bytes = await readFile(target);
    const mimeType = mimeTypeOf(relativePath, bytes);
    if (!mimeType) return null;
    return { mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') return null;
    throw error;
  }
}

async function readSource(root: string, relativePath: string): Promise<string | null> {
  const target = resolveWithinRoot(root, relativePath);
  if (!target) return null;
  try {
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > REPOSITORY_FAVICON_MAX_BYTES) return null;
    return await readFile(target, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') return null;
    throw error;
  }
}

function resolveWithinRoot(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) return null;
  const posix = relativePath.replace(/\\/g, '/');
  if (posix.split('/').includes('..')) return null;
  const target = path.resolve(root, posix);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

function mimeTypeOf(relativePath: string, bytes: Buffer): string | null {
  const fromPath = faviconMimeFromPath(relativePath);
  if (fromPath === 'image/svg+xml') return fromPath;
  return detectRasterImageMime(bytes) ?? fromPath;
}
