import darkTheme from '@shikijs/themes/one-dark-pro';
import lightTheme from '@shikijs/themes/one-light';
import { registerCustomTheme, type ThemeRegistration } from '@pierre/diffs';

// Same One Light/One Dark Pro pair the Markdown highlighter uses (see
// `syntaxThemes.ts`), so a `.ts` snippet reads identically across Files,
// diffs, conflicts, and Markdown previews.
const BASE_TOKEN_COLORS = { light: lightTheme.tokenColors ?? [], dark: darkTheme.tokenColors ?? [] };

export const JUSTGIT_CODE_THEMES = {
  light: 'justgit-light',
  dark: 'justgit-dark',
} as const;

function cssColor(variable: string, fallback: string): string {
  return `var(${variable}, ${fallback})`;
}

function createJustGitTheme(name: string, type: 'light' | 'dark'): ThemeRegistration {
  const dark = type === 'dark';
  const color = (variable: string, lightFallback: string, darkFallback: string) =>
    cssColor(variable, dark ? darkFallback : lightFallback);

  const added = color('--diff-added', '#218739', '#63d471');
  const deleted = color('--diff-deleted', '#c9362b', '#f0746b');
  const modified = color('--diff-modified', '#2563c7', '#65a8ff');

  return {
    name,
    type,
    colors: {
      'editor.background': color('--diff-editor-background', '#ffffff', '#17191a'),
      'editor.foreground': color('--diff-editor-foreground', '#25292e', '#f3f5f5'),
      foreground: color('--diff-editor-foreground', '#25292e', '#f3f5f5'),
      'editor.selectionBackground': color('--diff-selection', '#cfe8d3', '#294a31'),
      'editor.lineHighlightBackground': color('--diff-line-highlight', '#f3f7f4', '#202526'),
      'editorLineNumber.foreground': color('--diff-line-number', '#7b898e', '#748186'),
      'editorLineNumber.activeForeground': color('--diff-editor-foreground', '#25292e', '#f3f5f5'),
      'gitDecoration.addedResourceForeground': added,
      'gitDecoration.deletedResourceForeground': deleted,
      'gitDecoration.modifiedResourceForeground': modified,
      'terminal.ansiGreen': added,
      'terminal.ansiRed': deleted,
      'terminal.ansiBlue': modified,
    },
    // The base palette carries full language-aware highlighting; only the diff
    // markup scopes are appended so a viewed `.diff`/`.patch` file still tints
    // its inserted/deleted/changed lines with the app's diff colors.
    tokenColors: [
      ...BASE_TOKEN_COLORS[type],
      {
        scope: ['markup.inserted', 'punctuation.definition.inserted'],
        settings: { foreground: added },
      },
      {
        scope: ['markup.deleted', 'punctuation.definition.deleted'],
        settings: { foreground: deleted },
      },
      {
        scope: ['markup.changed', 'punctuation.definition.changed'],
        settings: { foreground: modified },
      },
    ],
  };
}

registerCustomTheme(JUSTGIT_CODE_THEMES.light, async () =>
  createJustGitTheme(JUSTGIT_CODE_THEMES.light, 'light'),
);
registerCustomTheme(JUSTGIT_CODE_THEMES.dark, async () =>
  createJustGitTheme(JUSTGIT_CODE_THEMES.dark, 'dark'),
);
