// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findMarkdownAnchor, resolveMarkdownRepositoryPath } from './markdown-links';

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

describe('findMarkdownAnchor', () => {
  const root = () => {
    const element = document.createElement('div');
    element.innerHTML = '<h2 id="user-content-optional-ai-assistance">A</h2><h2 id="user-content-ñandú">B</h2><li id="footnote-1">C</li>';
    return element;
  };
  it('finds a heading by GitHub\'s anchor, also when encoded or in other case', () => {
    expect(findMarkdownAnchor(root(), '#optional-ai-assistance')?.textContent).toBe('A');
    expect(findMarkdownAnchor(root(), '#%C3%B1and%C3%BA')?.textContent).toBe('B');
    expect(findMarkdownAnchor(root(), '#Optional-AI-Assistance')?.textContent).toBe('A');
  });
  it('finds other ids such as footnotes, and nothing for an unknown or empty anchor', () => {
    expect(findMarkdownAnchor(root(), '#footnote-1')?.textContent).toBe('C');
    expect(findMarkdownAnchor(root(), '#missing')).toBeNull();
    expect(findMarkdownAnchor(root(), '#')).toBeNull();
  });
});
