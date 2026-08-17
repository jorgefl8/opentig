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

const THEME_CSS_VARIABLES = [
  'diff-editor-background',
  'diff-editor-foreground',
  'diff-selection',
  'diff-line-highlight',
  'diff-line-number',
  'diff-added',
  'diff-deleted',
  'diff-modified',
] as const;

const FALLBACK_COLORS: Record<'light' | 'dark', Record<(typeof THEME_CSS_VARIABLES)[number], string>> = {
  light: {
    'diff-editor-background': '#ffffff',
    'diff-editor-foreground': '#25292e',
    'diff-selection': '#cfe8d3',
    'diff-line-highlight': '#f3f7f4',
    'diff-line-number': '#7b898e',
    'diff-added': '#218739',
    'diff-deleted': '#c9362b',
    'diff-modified': '#2563c7',
  },
  dark: {
    'diff-editor-background': '#17191a',
    'diff-editor-foreground': '#f3f5f5',
    'diff-selection': '#294a31',
    'diff-line-highlight': '#202526',
    'diff-line-number': '#748186',
    'diff-added': '#63d471',
    'diff-deleted': '#f0746b',
    'diff-modified': '#65a8ff',
  },
};

/**
 * @pierre/diffs threads theme colors through Shiki (main thread) and its own
 * worker-side tokenizer, then bakes the result into a shadow-DOM `<style>`
 * block. A live `var(--name)` reference doesn't survive that round-trip
 * reliably - the editor silently fell back to Pierre's own bundled theme
 * instead of ours. Resolving each variable to its real computed color up
 * front (via a detached, `.dark`-toggled probe element so both variants can
 * be read regardless of which theme is currently active) sidesteps that: Shiki
 * only ever sees plain, already-resolved colors.
 */
function resolveThemeColors(type: 'light' | 'dark'): Record<(typeof THEME_CSS_VARIABLES)[number], string> {
  // `.dark` is toggled on <html> (see App.tsx), and custom properties inherit
  // through any descendant regardless of that descendant's own class list -
  // a probe without `.dark` still inherits the *ambient* dark values if the
  // app currently happens to be dark. So the probe can't just omit the class;
  // <html>'s own class has to be forced to the variant being resolved (and
  // restored after) to read that variant's values correctly.
  const root = document.documentElement;
  const wantsDark = type === 'dark';
  const hadDark = root.classList.contains('dark');
  if (hadDark !== wantsDark) root.classList.toggle('dark', wantsDark);
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.top = '-9999px';
  probe.style.left = '-9999px';
  probe.style.pointerEvents = 'none';
  root.appendChild(probe);
  const computed = getComputedStyle(probe);
  const fallback = FALLBACK_COLORS[type];
  const resolved = {} as Record<(typeof THEME_CSS_VARIABLES)[number], string>;
  for (const name of THEME_CSS_VARIABLES) {
    resolved[name] = computed.getPropertyValue(`--${name}`).trim() || fallback[name];
  }
  probe.remove();
  if (hadDark !== wantsDark) root.classList.toggle('dark', hadDark);
  return resolved;
}

function createJustGitTheme(name: string, type: 'light' | 'dark'): ThemeRegistration {
  const colors = resolveThemeColors(type);
  const added = colors['diff-added'];
  const deleted = colors['diff-deleted'];
  const modified = colors['diff-modified'];

  return {
    name,
    type,
    colors: {
      'editor.background': colors['diff-editor-background'],
      'editor.foreground': colors['diff-editor-foreground'],
      foreground: colors['diff-editor-foreground'],
      'editor.selectionBackground': colors['diff-selection'],
      'editor.lineHighlightBackground': colors['diff-line-highlight'],
      'editorLineNumber.foreground': colors['diff-line-number'],
      'editorLineNumber.activeForeground': colors['diff-editor-foreground'],
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
