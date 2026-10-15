import { useEffect, useId, useRef } from 'react';

export function HtmlPreviewFrame({ document, path, active }: { document: string; path: string; active: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const frameName = `html-preview-${useId().replace(/:/g, '')}`;
  // Posting the draft gives the preview its own sandboxed CSP for inline scripts.
  useEffect(() => {
    if (active) formRef.current?.requestSubmit();
  }, [document, active]);
  return <>
    <iframe className="html-preview-frame" name={frameName} title={`Preview of ${path}`} sandbox="allow-scripts" referrerPolicy="no-referrer" />
    <form ref={formRef} className="html-preview-form" method="post" action="/api/html-preview" target={frameName} encType="application/x-www-form-urlencoded">
      <input type="hidden" name="document" value={document} />
    </form>
  </>;
}
