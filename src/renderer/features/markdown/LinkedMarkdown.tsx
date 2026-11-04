import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { normalizeExternalUrl } from '@shared/external-url';
import { ExternalLink } from '@/components/ExternalLink';
import { scrollToMarkdownAnchor } from './markdown-links';

interface MarkdownLink {
  mount: HTMLSpanElement;
  href: string;
  html: string;
  className: string;
  id: string;
}

/** Receives sanitized renderMarkdown output; anchors and footnotes stay local. */
export function LinkedMarkdown({ html, className = 'markdown-prose' }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<MarkdownLink[]>([]);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML = html;
    const nextLinks: MarkdownLink[] = [];
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      anchor.removeAttribute('title');
      const href = anchor.getAttribute('href') ?? '';
      if (!normalizeExternalUrl(href)) continue;
      const mount = document.createElement('span');
      mount.style.display = 'contents';
      nextLinks.push({ mount, href, html: anchor.innerHTML, className: anchor.className, id: anchor.id });
      anchor.replaceWith(mount);
    }
    setLinks(nextLinks);
  }, [html]);
  // A `#section` link scrolls to its heading in this text, not to the page's address.
  const followAnchor = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    scrollToMarkdownAnchor(event.currentTarget, link.getAttribute('href') ?? '');
  };
  return <>
    <div ref={ref} className={className} onClick={followAnchor} />
    {links.map((link, index) => createPortal(
      <ExternalLink href={link.href} className={link.className} id={link.id} dangerouslySetInnerHTML={{ __html: link.html }} />,
      link.mount, String(index),
    ))}
  </>;
}
