import { useEffect, useState, type RefObject } from 'react';

/** Comments drawn as HTML, by their text, so a comment seen again is not rendered again; the oldest go first. */
const MAX_RENDERED = 300;
/** How far outside the visible part of the conversation a comment is rendered ahead of being scrolled to. */
const AHEAD = '1200px 0px';

const rendered = new Map<string, string>();
const rendering = new Map<string, Promise<string>>();

/** The comment's text as sanitized HTML, rendered once per text. */
function renderComment(body: string): Promise<string> {
  const pending = rendering.get(body);
  if (pending) return pending;
  const promise = import('@/features/markdown/render-markdown')
    .then(({ renderMarkdown }) => renderMarkdown(body))
    .catch(() => '<p>Could not render this comment.</p>')
    .then((html) => {
      rendered.delete(body);
      rendered.set(body, html);
      while (rendered.size > MAX_RENDERED) rendered.delete(rendered.keys().next().value!);
      return html;
    })
    .finally(() => rendering.delete(body));
  rendering.set(body, promise);
  return promise;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
  }
  return null;
}

/**
 * A conversation entry's Markdown, rendered on its own and only once the entry comes
 * near the visible part of the conversation, so a long conversation does not render
 * every comment at once. Null until then.
 */
export function useCommentHtml(body: string, element: RefObject<HTMLElement | null>): string | null {
  const [shown, setShown] = useState<{ body: string; html: string } | null>(() => {
    const html = rendered.get(body);
    return html === undefined ? null : { body, html };
  });
  useEffect(() => {
    if (!body.trim()) return;
    const cached = rendered.get(body);
    if (cached !== undefined) { setShown({ body, html: cached }); return; }
    let cancelled = false;
    const start = () => { void renderComment(body).then((html) => { if (!cancelled) setShown({ body, html }); }); };
    const node = element.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      start();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((records) => {
      if (!records.some((record) => record.isIntersecting)) return;
      observer.disconnect();
      start();
    }, { root: scrollParent(node), rootMargin: AHEAD });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); };
  }, [body, element]);
  return shown?.body === body ? shown.html : null;
}
