import { describe, expect, it } from 'vitest';
import { shouldOpenChangePreview } from './change-preview';

describe('shouldOpenChangePreview', () => {
  it('opens changed Markdown as a diff', () => {
    expect(shouldOpenChangePreview('README.md', 'modified')).toBe(false);
    expect(shouldOpenChangePreview('docs/guide.mdx', 'added')).toBe(false);
  });

  it('opens changed HTML and SVG as a diff, because their source is readable text', () => {
    expect(shouldOpenChangePreview('page.html', 'modified')).toBe(false);
    expect(shouldOpenChangePreview('docs/index.xhtml', 'added')).toBe(false);
    expect(shouldOpenChangePreview('logo.svg', 'modified')).toBe(false);
  });

  it('keeps the preview as the primary action for raster images', () => {
    expect(shouldOpenChangePreview('photo.png', 'modified')).toBe(true);
    expect(shouldOpenChangePreview('assets/banner.webp', 'added')).toBe(true);
  });

  it('does not preview deleted files or directory summaries', () => {
    expect(shouldOpenChangePreview('photo.png', 'deleted')).toBe(false);
    expect(shouldOpenChangePreview('assets/', 'modified')).toBe(false);
  });
});
