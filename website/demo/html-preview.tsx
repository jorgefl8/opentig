/** Static demo transport: render edits locally, in an opaque-origin sandbox. */
export function HtmlPreviewFrame({ document, path }: { document: string; path: string; active: boolean }) {
  return <iframe className="html-preview-frame" title={`Preview of ${path}`} srcDoc={document} sandbox="" referrerPolicy="no-referrer" />;
}
