import darkTheme from '@shikijs/themes/one-dark-pro';
import lightTheme from '@shikijs/themes/one-light';
import { registerCustomTheme, type ThemeRegistration } from '@pierre/diffs';

// Same One Light/One Dark Pro pair the Markdown highlighter uses (see
// `syntaxThemes.ts`), so a `.ts` snippet reads identically across Files,
// diffs, conflicts, and Markdown previews.
const BASE_TOKEN_COLORS = { light: lightTheme.tokenColors ?? [], dark: darkTheme.tokenColors ?? [] };

export const OPENTIG_CODE_THEMES = {
  light: 'opentig-light',
  dark: 'opentig-dark',
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
/**
 * Pierre keeps non-hex theme colors by swapping in placeholders such as
 * `#00000001`. The static stylesheet later restores the real color, but the
 * editor's token color map does not, so the first edit paints ordinary text
 * in that near-transparent black. Shiki and the editor both need hex.
 */
export function concreteColor(color: string, fallback: string): string {
  const value = color.trim();
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
  if (typeof document === 'undefined') return fallback;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return fallback;
  context.fillStyle = '#010203';
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  const red = pixel[0] ?? 0;
  const green = pixel[1] ?? 0;
  const blue = pixel[2] ?? 0;
  if (red === 1 && green === 2 && blue === 3) return fallback;
  const hex = [red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
}

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
    resolved[name] = concreteColor(computed.getPropertyValue(`--${name}`).trim() || fallback[name], fallback[name]);
  }
  probe.remove();
  if (hadDark !== wantsDark) root.classList.toggle('dark', hadDark);
  return resolved;
}

function createOpenTigTheme(name: string, type: 'light' | 'dark'): ThemeRegistration {
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
    // Shiki normalizes the shared Markdown palettes in place, inserting an
    // unscoped foreground/background rule that takes precedence over `colors`.
    // Read only scoped syntax rules at resolution time (either view may load
    // first), and clone them so our highlighter cannot mutate the source theme.
    // Diff markup scopes still use the app's inserted/deleted/changed colors.
    tokenColors: [
      ...structuredClone(BASE_TOKEN_COLORS[type].filter(({ scope }) =>
        Array.isArray(scope) ? scope.length > 0 : Boolean(scope?.trim()),
      )),
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

registerCustomTheme(OPENTIG_CODE_THEMES.light, async () =>
  createOpenTigTheme(OPENTIG_CODE_THEMES.light, 'light'),
);
registerCustomTheme(OPENTIG_CODE_THEMES.dark, async () =>
  createOpenTigTheme(OPENTIG_CODE_THEMES.dark, 'dark'),
);
