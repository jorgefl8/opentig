export const REPOSITORY_FAVICON_MAX_BYTES = 256 * 1024;

/** Well-known icon files, checked in order. Mirrors t3code's project discovery. */
export const REPOSITORY_FAVICON_CANDIDATES = [
  'favicon.svg',
  'favicon.ico',
  'favicon.png',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'app/favicon.svg',
  'app/favicon.ico',
  'app/favicon.png',
  'app/icon.svg',
  'app/icon.png',
  'app/icon.ico',
  'src/favicon.ico',
  'src/favicon.svg',
  'src/app/favicon.ico',
  'src/app/icon.svg',
  'src/app/icon.png',
  'assets/icon.svg',
  'assets/icon.png',
  'assets/logo.svg',
  'assets/logo.png',
  '.idea/icon.svg',
] as const;

export const REPOSITORY_FAVICON_SOURCE_FILES = [
  'index.html',
  'public/index.html',
  'app/routes/__root.tsx',
  'src/routes/__root.tsx',
  'app/root.tsx',
  'src/root.tsx',
  'src/index.html',
] as const;

const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const ICON_REL_RE = /\brel\s*:\s*["'](?:icon|shortcut icon)["']/i;
const ICON_HREF_RE = /\bhref\s*:\s*["']([^"'?]+)/i;

export function repositoryRootFromCommonDir(commonDir: string): string {
  return commonDir.replace(/[\\/]\.git[\\/]?$/i, '');
}

export function extractIconHref(source: string): string | null {
  const htmlMatch = source.match(LINK_ICON_HTML_RE);
  if (htmlMatch?.[1]) return htmlMatch[1];
  for (const run of source.split('}')) {
    if (!ICON_REL_RE.test(run)) continue;
    const hrefMatch = run.match(ICON_HREF_RE);
    if (hrefMatch?.[1]) return hrefMatch[1];
  }
  return null;
}

export function isLocalIconHref(href: string): boolean {
  const trimmed = href.trim();
  return trimmed.length > 0 && !/^(?:[a-z]+:)?\/\//i.test(trimmed) && !trimmed.toLowerCase().startsWith('data:');
}

/** Local hrefs are tried as `public/<path>` then `<path>`, matching static web apps. */
export function localIconHrefCandidates(href: string): string[] {
  if (!isLocalIconHref(href)) return [];
  const clean = href.trim().replace(/^\/+/, '').replace(/\\/g, '/');
  if (!clean || clean.split('/').includes('..')) return [];
  return [`public/${clean}`, clean];
}

export function faviconMimeFromPath(filePath: string): string | null {
  const extension = extensionOf(filePath);
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'ico' || extension === 'cur') return 'image/x-icon';
  if (extension === 'png' || extension === 'apng') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg' || extension === 'jfif' || extension === 'pjpeg' || extension === 'pjp') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'avif') return 'image/avif';
  return null;
}

function extensionOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}
