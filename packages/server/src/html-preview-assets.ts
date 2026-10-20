import path from 'node:path';
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { installHtmlPreviewNavigation } from '../../../src/shared/html-preview-navigation';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ReadAsset = (path: string, limit: number) => Promise<{ data: Buffer | null; size: number }>;
const LIMIT = 8 * 1024 * 1024;
const MIME: Record<string, string> = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

/** Bundle local assets into the opaque-origin frame; never expose a repository asset server. */
export async function embedHtmlPreviewAssets(document: string, filePath: string, read: ReadAsset, navigationId?: string): Promise<string> {
  let remaining = LIMIT;
  let embedded = 0;
  let requests = 0;
  const cache = new Map<string, string>();
  const asset = async (reference: string, parent: string, ancestors: string[] = []): Promise<string> => {
    if (!reference.trim() || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference.trim())) return reference;
    if (++requests > 128) return 'data:,';
    let local: string;
    try {
      const decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0]!);
      if (decoded.includes('\\') || decoded.includes('\0')) return 'data:,';
      local = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(parent), decoded));
    } catch { return 'data:,'; }
    if (local === '..' || local.startsWith('../') || local.split('/').includes('.git')) return 'data:,';
    const mime = MIME[path.posix.extname(local).toLowerCase()];
    if (!mime || ancestors.includes(local) || ancestors.length >= 8) return 'data:,';
    const cached = cache.get(local);
    if (cached) {
      embedded += cached.length;
      return embedded <= LIMIT * 2 ? cached : 'data:,';
    }
    if (remaining <= 0) return 'data:,';
    try {
      const result = await read(local, remaining);
      if (!result.data) return 'data:,';
      remaining -= result.size;
      const bytes = mime === 'text/css'
        ? Buffer.from(await css(result.data.toString('utf8'), local, [...ancestors, local]))
        : result.data;
      const url = `data:${mime};base64,${bytes.toString('base64')}`;
      embedded += url.length;
      if (embedded > LIMIT * 2) return 'data:,';
      cache.set(local, url);
      return url + (mime.startsWith('image/') && reference.includes('#') ? `#${reference.split('#').slice(1).join('#')}` : '');
    } catch { return 'data:,'; }
  };
  const css = async (source: string, parent: string, ancestors: string[] = []) => {
    // Handle url(...) and the quoted @import shorthand, resolving each from its stylesheet.
    const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
    let result = '';
    let end = 0;
    for (const match of source.matchAll(pattern)) {
      const url = await asset((match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim(), parent, ancestors);
      result += source.slice(end, match.index) + (match[4] !== undefined || match[5] !== undefined ? `@import url("${url}")` : `url("${url}")`);
      end = match.index + match[0].length;
    }
    return result + source.slice(end);
  };
  const tree = parse(document);
  const visit = async (node: Node): Promise<void> => {
    if ('tagName' in node) {
      const element = node as Element;
      const attr = (name: string) => element.attrs.find(item => item.name === name);
      // A base URL must not redirect local references into the application's origin.
      if (element.tagName === 'base') element.attrs = [];
      const resource = element.tagName === 'link' && attr('rel')?.value.split(/\s+/).includes('stylesheet')
        ? attr('href') : ['script', 'img', 'source'].includes(element.tagName) ? attr('src') : undefined;
      if (resource) resource.value = await asset(resource.value, filePath);
      const style = attr('style');
      if (style) style.value = await css(style.value, filePath);
      if (element.tagName === 'style') {
        for (const child of element.childNodes) if ('value' in child) child.value = await css(child.value, filePath);
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) await visit(child);
  };
  await visit(tree);
  if (navigationId && /^[\w-]{1,128}$/.test(navigationId)) {
    const html = tree.childNodes.find((node): node is Element => 'tagName' in node && node.tagName === 'html');
    const head = html?.childNodes.find((node): node is Element => 'tagName' in node && node.tagName === 'head');
    const bridge = parseFragment(`<script>(${installHtmlPreviewNavigation.toString()})(${JSON.stringify(navigationId)});</script>`).childNodes[0];
    if (head && bridge) {
      bridge.parentNode = head;
      head.childNodes.unshift(bridge);
    }
  }
  return serialize(tree);
}
