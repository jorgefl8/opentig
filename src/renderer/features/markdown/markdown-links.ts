/** Heading ids carry GitHub's prefix, so a heading called "Root" can't take an id the app uses. */
export const HEADING_ID_PREFIX = 'user-content-';

/** Where a `#section` link points inside rendered Markdown: a heading by GitHub's anchor, or any other id such as a footnote's. */
export function findMarkdownAnchor(root: ParentNode, href: string): HTMLElement | null {
  let name = href.replace(/^#/, '');
  try { name = decodeURIComponent(name); } catch { /* A malformed escape is looked up as written. */ }
  if (!name) return null;
  const wanted = [HEADING_ID_PREFIX + name, name, HEADING_ID_PREFIX + name.toLowerCase()];
  const elements = [...root.querySelectorAll<HTMLElement>('[id]')];
  for (const id of wanted) {
    const match = elements.find((element) => element.id === id);
    if (match) return match;
  }
  return null;
}

/**
 * Scrolls the pane that holds the text to a `#section` link's target. Only that pane moves:
 * scrollIntoView would also scroll every box around it, shifting the whole window out of place.
 */
export function scrollToMarkdownAnchor(root: HTMLElement, href: string): HTMLElement | null {
  const target = findMarkdownAnchor(root, href);
  if (!target) return null;
  const scroller = scrollingAncestor(target);
  if (!scroller) return target;
  const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  return target;
}

function scrollingAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

export function resolveMarkdownRepositoryPath(markdownPath: string, href: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;

  const rawPath = value.split(/[?#]/, 1)[0];
  if (!rawPath) return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath).replaceAll('\\', '/');
  } catch {
    return null;
  }

  const resolved = decodedPath.startsWith('/')
    ? []
    : markdownPath.replaceAll('\\', '/').split('/').slice(0, -1).filter(Boolean);
  for (const segment of decodedPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    if (hasControlCharacter(segment)) return null;
    resolved.push(segment);
  }
  return resolved.length > 0 ? resolved.join('/') : null;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
