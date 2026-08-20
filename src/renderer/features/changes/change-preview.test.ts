import { describe, expect, it } from 'vitest';
import { shouldOpenChangePreview } from './change-preview';

describe('shouldOpenChangePreview', () => {
  it('opens changed Markdown as a diff', () => {
    expect(shouldOpenChangePreview('README.md', 'modified')).toBe(false);
    expect(shouldOpenChangePreview('docs/guide.mdx', 'added')).toBe(false);
  });

  it('keeps visual file previews as the primary action', () => {
    expect(shouldOpenChangePreview('page.html', 'modified')).toBe(true);
    expect(shouldOpenChangePreview('logo.svg', 'modified')).toBe(true);
    expect(shouldOpenChangePreview('photo.png', 'modified')).toBe(true);
  });

  it('does not preview deleted files or directory summaries', () => {
    expect(shouldOpenChangePreview('photo.png', 'deleted')).toBe(false);
    expect(shouldOpenChangePreview('assets/', 'modified')).toBe(false);
  });
});
