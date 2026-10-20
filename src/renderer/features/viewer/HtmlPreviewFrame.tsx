import { useEffect, useId, useMemo, useRef } from 'react';
import { openExternalUrl } from '@/lib/browser-capabilities';
import { resolveHtmlPreviewLink, type HtmlPreviewAnchor } from './html-preview-links';

interface HtmlPreviewFrameProps {
  document: string;
  repositoryId: string;
  path: string;
  active: boolean;
  anchor: HtmlPreviewAnchor | null;
  onNavigate(path: string, hash: string): void;
}

export function HtmlPreviewFrame({ document, repositoryId, path, active, anchor, onNavigate }: HtmlPreviewFrameProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameName = `html-preview-${useId().replace(/:/g, '')}`;
  // Bind messages to this exact draft, even when React reuses the iframe for another file.
  const { navigationId } = useMemo(() => ({ document, repositoryId, path, navigationId: crypto.randomUUID() }), [document, repositoryId, path]);
  useEffect(() => {
    if (!active) return;
    const scrollToAnchor = () => {
      if (anchor) frameRef.current?.contentWindow?.postMessage({ type: 'opentig:html-anchor', navigationId, hash: anchor.hash }, '*');
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== 'null') return;
      const message = event.data;
      if (!message || message.navigationId !== navigationId) return;
      if (message.type === 'opentig:html-ready') { scrollToAnchor(); return; }
      if (message.type !== 'opentig:html-link') return;
      const link = resolveHtmlPreviewLink(path, message.href);
      if (link?.type === 'file') onNavigate(link.path, link.hash);
      else if (link?.type === 'external') openExternalUrl(link.url);
    };
    window.addEventListener('message', handleMessage);
    scrollToAnchor();
    return () => window.removeEventListener('message', handleMessage);
  }, [active, anchor, navigationId, onNavigate, path]);
  // Posting the draft gives the preview its own sandboxed CSP for inline scripts.
  useEffect(() => {
    if (active) formRef.current?.requestSubmit();
  }, [document, repositoryId, path, active, navigationId]);
  return <>
    <iframe ref={frameRef} className="html-preview-frame" name={frameName} title={`Preview of ${path}`} sandbox="allow-scripts" referrerPolicy="no-referrer" />
    <form ref={formRef} className="html-preview-form" method="post" action="/api/html-preview" target={frameName} encType="application/x-www-form-urlencoded">
      <input type="hidden" name="document" value={document} />
      <input type="hidden" name="repositoryId" value={repositoryId} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="navigationId" value={navigationId} />
    </form>
  </>;
}
