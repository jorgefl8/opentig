import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('Markdown syntax highlighting', () => {
  it('does not initialize or load a grammar for Markdown without code fences', async () => {
    const { getLoadedMarkdownLanguages } = await import('./highlight');
    const { renderMarkdown } = await import('./render-markdown');

    expect(getLoadedMarkdownLanguages()).toEqual([]);
    await renderMarkdown('# Plain document\n\nNo fenced code.');
    expect(getLoadedMarkdownLanguages()).toEqual([]);
  }, 20_000);

  it('loads only the languages requested by code fences', async () => {
    const { getLoadedMarkdownLanguages, highlightCode } = await import('./highlight');

    await highlightCode('const value: number = 1', 'ts');
    await highlightCode('value: int = 1', 'python');

    expect(getLoadedMarkdownLanguages()).toEqual(expect.arrayContaining(['typescript', 'ts']));
    expect(getLoadedMarkdownLanguages()).toEqual(expect.arrayContaining(['python', 'py']));
    expect(getLoadedMarkdownLanguages()).not.toContain('rust');
  });

  it('normalizes supported aliases to canonical grammar names', async () => {
    const { resolveMarkdownLanguage } = await import('./highlight');

    expect(resolveMarkdownLanguage('JS')).toBe('javascript');
    expect(resolveMarkdownLanguage('shell')).toBe('shellscript');
    expect(resolveMarkdownLanguage('yml')).toBe('yaml');
    expect(resolveMarkdownLanguage('dockerfile')).toBe('docker');
    expect(resolveMarkdownLanguage('rs')).toBe('rust');
  });

  it('uses plain text for unknown languages without loading a grammar', async () => {
    const { getLoadedMarkdownLanguages, highlightCode } = await import('./highlight');

    const html = await highlightCode('<unsafe>', 'made-up-language');

    expect(html).toContain('unsafe');
    expect(html).not.toContain('<unsafe>');
    expect(getLoadedMarkdownLanguages()).toEqual([]);
  });

  it('coalesces concurrent highlights of one language', async () => {
    const { getLoadedMarkdownLanguages, highlightCode } = await import('./highlight');

    const [first, second] = await Promise.all([
      highlightCode('const first = 1', 'typescript'),
      highlightCode('const second = 2', 'ts'),
    ]);

    expect(first).toContain('shiki');
    expect(second).toContain('shiki');
    expect(getLoadedMarkdownLanguages()).toEqual(expect.arrayContaining(['typescript', 'ts']));
  });

  it('loads every supported canonical language and produces highlighted HTML', async () => {
    const { highlightCode } = await import('./highlight');
    const samples: Record<string, string> = {
      html: '<main>Hello</main>',
      javascript: 'const value = 1',
      typescript: 'const value: number = 1',
      tsx: 'const view = <main>Hello</main>',
      css: '.example { color: red; }',
      json: '{"value": 1}',
      shellscript: 'echo "hello"',
      markdown: '# Heading',
      python: 'value: int = 1',
      yaml: 'value: 1',
      go: 'package main',
      docker: 'FROM node:24',
      sql: 'SELECT 1;',
      rust: 'fn main() {}',
      java: 'class Main {}',
      xml: '<root />',
    };

    for (const [language, code] of Object.entries(samples)) {
      await expect(highlightCode(code, language)).resolves.toContain('shiki');
    }
  }, 20_000);
});
