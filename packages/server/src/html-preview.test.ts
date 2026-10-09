import { describe, expect, it } from 'vitest';
import { HTML_PREVIEW_CSP, htmlPreviewDocumentFromFormBody } from './html-preview';

describe('html preview document', () => {
  it('keeps scripts inside an opaque sandbox', () => {
    expect(HTML_PREVIEW_CSP).toContain('sandbox allow-scripts');
    expect(HTML_PREVIEW_CSP).not.toContain('allow-same-origin');
    expect(HTML_PREVIEW_CSP).not.toContain("script-src 'self'");
    expect(HTML_PREVIEW_CSP).toContain("frame-ancestors 'self'");
  });

  it('reads the posted document and preserves encoded characters', () => {
    const document = '<p>a+b & "quotes"</p><script>document.body.dataset.ran="1"</script>';
    expect(htmlPreviewDocumentFromFormBody(new URLSearchParams({ document }).toString())).toBe(document);
  });

  it('rejects a body that does not carry the document field', () => {
    expect(htmlPreviewDocumentFromFormBody('other=1')).toBeNull();
    expect(htmlPreviewDocumentFromFormBody('')).toBeNull();
  });
});
