import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render-markdown';

describe('renderMarkdown', () => {
  it('renders GFM, alerts, footnotes, math and highlighted code', async () => {
    const html = await renderMarkdown([
      '# Title',
      '',
      '- [x] done',
      '',
      '> [!NOTE]',
      '> Useful',
      '',
      'A footnote[^1] and $x^2$.',
      '',
      '[^1]: Footnote text.',
      '',
      '```ts title="config.ts"',
      'const value = 1',
      '```',
    ].join('\n'));

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('markdown-alert');
    expect(html).toContain('footnote');
    expect(html).toContain('katex');
    expect(html).toContain('markdown-code-block');
    expect(html).toContain('config.ts');
    expect(html).toContain('class="markdown-code-icon"');
    expect(html).toContain('file_type_typescript.svg');
    expect(html).toContain('data-copy-code=');
    expect(html).toContain('class="copy-button-icon tabler-icon tabler-icon-copy"');
    expect(html).not.toContain('>Copy</span>');
    expect(html).toContain('class="copy-button-check"');
    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
  });

  it('keeps mermaid source inert for client rendering', async () => {
    const html = await renderMarkdown('```mermaid\ngraph TD\nA-->B\n```');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('data-mermaid-source=');
    expect(html).toContain('graph TD');
  });

  it('sanitizes scripts, event handlers and unsafe URLs', async () => {
    const html = await renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('preserves safe remote Markdown images', async () => {
    const html = await renderMarkdown('<img src="https://img.shields.io/badge/test-pass-green" alt="Test badge">');
    expect(html).toContain('src="https://img.shields.io/badge/test-pass-green"');
    expect(html).toContain('alt="Test badge"');
  });

  it('preserves centered README image groups', async () => {
    const html = await renderMarkdown([
      '<div align="center">',
      '  <h1 align="center"><img width="100" height="100" src="https://example.com/logo.png" alt="Logo"><br>App</h1>',
      '  <p align="center">',
      '    <img src="https://img.shields.io/badge/one-1-black" alt="One">',
      '    <img src="https://img.shields.io/badge/two-2-black" alt="Two">',
      '  </p>',
      '</div>',
    ].join('\n'));

    expect(html).toContain('<div align="center">');
    expect(html).toContain('<h1 align="center">');
    expect(html).toContain('<p align="center">');
    expect(html).toContain('width="100"');
    expect(html).toContain('height="100"');
  });

  it('does not collide identical code blocks with different languages', async () => {
    const html = await renderMarkdown('```ts\nvalue\n```\n\n```python\nvalue\n```');
    expect(html).toContain('data-language="ts"');
    expect(html).toContain('data-language="python"');
    expect(html).toContain('file_type_typescript.svg');
    expect(html).toContain('file_type_python.svg');
  });

  it('omits a code icon when the language has no VS Code icon', async () => {
    const html = await renderMarkdown('```totally-unknown\nvalue\n```');
    expect(html).not.toContain('class="markdown-code-icon"');
  });
});
