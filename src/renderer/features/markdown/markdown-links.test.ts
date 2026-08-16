import { describe, expect, it } from 'vitest';
import { resolveMarkdownRepositoryPath } from './markdown-links';

describe('resolveMarkdownRepositoryPath', () => {
  it('resolves repository files relative to the current Markdown file', () => {
    expect(resolveMarkdownRepositoryPath('README.md', 'docs/architecture/feature-based-architecture.md'))
      .toBe('docs/architecture/feature-based-architecture.md');
    expect(resolveMarkdownRepositoryPath('docs/guides/setup.md', '../architecture.md'))
      .toBe('docs/architecture.md');
  });

  it('supports repository-root paths, encoded names, queries and fragments', () => {
    expect(resolveMarkdownRepositoryPath('docs/guide.md', '/README.md#usage')).toBe('README.md');
    expect(resolveMarkdownRepositoryPath('docs/guide.md', './my%20file.md?raw=1#title')).toBe('docs/my file.md');
  });

  it('rejects anchors, external links, invalid encoding and traversal outside the repository', () => {
    expect(resolveMarkdownRepositoryPath('README.md', '#usage')).toBeNull();
    expect(resolveMarkdownRepositoryPath('README.md', 'https://example.com/file.md')).toBeNull();
    expect(resolveMarkdownRepositoryPath('README.md', 'mailto:user@example.com')).toBeNull();
    expect(resolveMarkdownRepositoryPath('README.md', '../outside.md')).toBeNull();
    expect(resolveMarkdownRepositoryPath('README.md', '%E0%A4%A')).toBeNull();
  });
});
