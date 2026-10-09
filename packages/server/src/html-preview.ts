/** Raw form body cap. The browser percent-encodes the document before this limit applies. */
export const HTML_PREVIEW_BODY_LIMIT = 8_000_000;

/**
 * Policy for the preview document only. `sandbox` forces an opaque origin even
 * if the response is opened directly, and `allow-same-origin` is intentionally absent.
 */
export const HTML_PREVIEW_CSP = [
  'sandbox allow-scripts',
  "frame-ancestors 'self'",
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob: https: http:",
  "style-src 'unsafe-inline' data: blob: https: http:",
  "img-src data: blob: https: http:",
  "font-src data: blob: https: http:",
  "media-src data: blob: https: http:",
  "connect-src data: blob: https: http:",
  "worker-src blob:",
  "frame-src data: blob: https: http:",
].join('; ');

export function htmlPreviewDocumentFromFormBody(body: string): string | null {
  const params = new URLSearchParams(body);
  if (!params.has('document')) return null;
  return params.get('document') ?? '';
}
