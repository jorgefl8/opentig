import { afterEach, describe, expect, it, vi } from 'vitest';
import darkTheme from '@shikijs/themes/one-dark-pro';
import lightTheme from '@shikijs/themes/one-light';
import typescript from '@shikijs/langs-precompiled/ts';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRawEngine } from 'shiki/engine/javascript';
import { getHighlighterThemeStyles, resolveThemes, type DiffsHighlighter } from '@pierre/diffs';
import { OPENTIG_CODE_THEMES } from './diffThemes';

afterEach(() => vi.unstubAllGlobals());

describe('OPENTIG_CODE_THEMES', () => {
  it('exposes the registered custom theme names', () => {
    expect(OPENTIG_CODE_THEMES).toEqual({
      light: 'opentig-light',
      dark: 'opentig-dark',
    });
  });

  it('keeps app surfaces after Markdown has normalized the shared One palettes', async () => {
    // Shiki inserts an unscoped foreground/background rule into the imported
    // palette. Reproduce opening Markdown before resolving the lazy diff themes.
    const highlighter = await createHighlighterCore({
      themes: [lightTheme, darkTheme],
      langs: [typescript],
      engine: createJavaScriptRawEngine(),
    });
    const classes = new Set(['dark']);
    vi.stubGlobal('document', {
      documentElement: {
        classList: {
          contains: (name: string) => classes.has(name),
          toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
        },
        appendChild: vi.fn(),
      },
      createElement: () => ({ style: {}, remove: vi.fn() }),
    });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => {
        if (name === '--diff-editor-background') return classes.has('dark') ? '#0a0a0a' : '#ffffff';
        if (name === '--diff-editor-foreground') return classes.has('dark') ? '#eeeeee' : '#111111';
        return '';
      },
    }));

    try {
      const themes = await resolveThemes(Object.values(OPENTIG_CODE_THEMES));
      await highlighter.loadTheme(...themes);
      for (const [type, name] of Object.entries(OPENTIG_CODE_THEMES)) {
        const theme = highlighter.getTheme(name);
        expect(theme.bg).toBe(type === 'dark' ? '#0a0a0a' : '#ffffff');
        expect(theme.fg).toBe(type === 'dark' ? '#eeeeee' : '#111111');
        const tokens = highlighter.codeToTokens('const answer = "hello";', { lang: 'typescript', theme: name });
        expect(new Set(tokens.tokens.flat().map((token) => token.color)).size).toBeGreaterThan(1);
      }
      // This is the CSS Pierre installs on both File and FileDiff shadow hosts,
      // including themes serialized to its highlighting worker.
      const css = getHighlighterThemeStyles({
        theme: OPENTIG_CODE_THEMES,
        highlighter: highlighter as DiffsHighlighter,
      });
      expect(css).toContain('--diffs-dark-bg:#0a0a0a;');
      expect(css).toContain('--diffs-light-bg:#ffffff;');
      expect(highlighter.getTheme('one-dark-pro').bg).toBe('#282c34');
      expect(classes.has('dark')).toBe(true);
    } finally {
      highlighter.dispose();
    }
  });
});
