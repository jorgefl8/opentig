import { normalizeExternalUrl } from '@shared/external-url';
import { resolveMarkdownRepositoryPath } from '@/features/markdown/markdown-links';

export type HtmlPreviewLink = { type: 'file'; path: string; hash: string } | { type: 'external'; url: string };
export interface HtmlPreviewAnchor { hash: string; id: string }

export function resolveHtmlPreviewLink(path: string, href: unknown): HtmlPreviewLink | null {
  if (typeof href !== 'string' || href.length > 8192) return null;
  const value = href.trim();
  const external = normalizeExternalUrl(value);
  if (external) return { type: 'external', url: external };
  const target = value.startsWith('#') || value.startsWith('?') ? path : resolveMarkdownRepositoryPath(path, value);
  if (!target || target.split('/').some(part => part.toLowerCase() === '.git')) return null;
  const hashIndex = value.indexOf('#');
  return { type: 'file', path: target, hash: hashIndex < 0 ? '' : value.slice(hashIndex) };
}
