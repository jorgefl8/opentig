import { describe, expect, it } from 'vitest';
import { buildHtmlPreviewDocument } from './html-preview-document';

describe('buildHtmlPreviewDocument', () => {
  it('adds JustGit scrollbar styling without changing the source body', () => {
    const source = '<!doctype html><html><head><title>Preview</title></head><body><main>Content</main></body></html>';
    const result = buildHtmlPreviewDocument(source, true);

    expect(result).toContain('data-justgit-preview-scrollbar');
    expect(result).toContain('scrollbar-width: thin');
    expect(result).toContain('rgb(255 255 255 / 18%)');
    expect(result).toContain('color-scheme: dark !important');
    expect(result).toContain('background-color: oklch(0.13 0 0) !important');
    expect(result).toContain('<body><main>Content</main></body>');
    expect(result.indexOf('data-justgit-preview-scrollbar')).toBeLessThan(result.indexOf('</head>'));
  });

  it('uses dark-on-light chrome and supports HTML fragments', () => {
    const result = buildHtmlPreviewDocument('<main>Content</main>', false);

    expect(result).toContain('rgb(0 0 0 / 18%)');
    expect(result).toContain('color-scheme: light !important');
    expect(result).toContain('<main>Content</main>');
  });

  it('creates a head when a full document does not provide one', () => {
    const result = buildHtmlPreviewDocument('<html lang="en"><body>Content</body></html>', false);

    expect(result).toContain('<html lang="en">\n<head><style data-justgit-preview-scrollbar>');
  });
});
