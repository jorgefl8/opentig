import { describe, expect, it } from 'vitest';
import { getCustomExtensionsMap, getFiletypeFromFileName } from '@pierre/diffs';
import { createHighlighter } from 'shiki';
import { bundledLanguages } from '@/lib/pierre-bundled-languages';
import './pierreLanguages';

describe('Pierre SVG language registration', () => {
  it('detects SVG as XML and includes it in the mapping sent to workers', () => {
    expect(getFiletypeFromFileName('assets/logo.svg')).toBe('xml');
    expect(getFiletypeFromFileName('assets/logo.SVG')).toBe('xml');
    expect(getFiletypeFromFileName('component.tsx')).toBe('tsx');
    expect(getCustomExtensionsMap()).toMatchObject({ svg: 'xml', SVG: 'xml' });
  });

  it('colors SVG tags, attributes, and values with the bundled XML grammar in both themes', async () => {
    const highlighter = await createHighlighter({
      langs: [await bundledLanguages.xml()],
      themes: ['one-light', 'one-dark-pro'],
    });
    try {
      const lang = getFiletypeFromFileName('logo.svg');
      if (lang !== 'xml') throw new Error(`Expected XML, received ${lang}`);
      for (const theme of ['one-light', 'one-dark-pro']) {
        const { tokens } = highlighter.codeToTokens('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>', {
          lang: lang as 'xml', theme,
        });
        const colors = new Set(tokens.flat().map(token => token.color));
        expect(colors.size).toBeGreaterThan(2);
      }
    } finally {
      highlighter.dispose();
    }
  });
});
