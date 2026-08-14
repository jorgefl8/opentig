import { registerCustomTheme, type ThemeRegistration } from '@pierre/diffs';

export const JUSTGIT_DIFF_THEMES = {
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

  const foreground = color('--diff-editor-foreground', '#25292e', '#f3f5f5');
  const background = color('--diff-editor-background', '#ffffff', '#17191a');
  const muted = color('--diff-token-comment', '#66747a', '#9aa6aa');
  const added = color('--diff-added', '#218739', '#63d471');
  const deleted = color('--diff-deleted', '#c9362b', '#f0746b');
  const modified = color('--diff-modified', '#2563c7', '#65a8ff');

  return {
    name,
    type,
    colors: {
      'editor.background': background,
      'editor.foreground': foreground,
      foreground,
      'editor.selectionBackground': color('--diff-selection', '#cfe8d3', '#294a31'),
      'editor.lineHighlightBackground': color('--diff-line-highlight', '#f3f7f4', '#202526'),
      'editorLineNumber.foreground': color('--diff-line-number', '#7b898e', '#748186'),
      'editorLineNumber.activeForeground': foreground,
      'gitDecoration.addedResourceForeground': added,
      'gitDecoration.deletedResourceForeground': deleted,
      'gitDecoration.modifiedResourceForeground': modified,
      'terminal.ansiGreen': added,
      'terminal.ansiRed': deleted,
      'terminal.ansiBlue': modified,
    },
    tokenColors: [
      {
        scope: ['comment', 'punctuation.definition.comment', 'string.quoted.docstring.multi'],
        settings: { foreground: muted, fontStyle: 'italic' },
      },
      {
        scope: ['string', 'markup.fenced_code', 'markup.inline'],
        settings: { foreground: color('--diff-token-string', '#237a3b', '#70d982') },
      },
      {
        scope: [
          'keyword',
          'storage.modifier',
          'storage.type',
          'entity.name.tag.yaml',
          'support.type.property-name.json',
          'punctuation.separator.key-value',
        ],
        settings: { foreground: color('--diff-token-keyword', '#b54827', '#ff7959') },
      },
      {
        scope: [
          'constant.numeric',
          'constant.language',
          'constant.other',
          'variable.language',
          'variable.other.constant',
          'meta.property-name',
          'support.constant',
        ],
        settings: { foreground: color('--diff-token-constant', '#176eab', '#58b9ee') },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call',
          'entity.name.type',
          'entity.other.inherited-class',
        ],
        settings: { foreground: color('--diff-token-function', '#2563c7', '#80aaff') },
      },
      {
        scope: ['variable.parameter.function', 'variable.parameter'],
        settings: { foreground: color('--diff-token-parameter', '#7653a6', '#c099e8') },
      },
      {
        scope: [
          'entity.name.tag',
          'entity.other.attribute-name',
          'string.regexp',
          'string.interpolated',
          'string.unquoted.plain.out.yaml',
        ],
        settings: { foreground: color('--diff-token-expression', '#35745b', '#74c7a2') },
      },
      {
        scope: ['punctuation', 'meta.brace', 'meta.delimiter'],
        settings: { foreground: color('--diff-token-punctuation', '#66747a', '#b3bdc0') },
      },
      {
        scope: ['markup.underline.link', 'meta.link', 'string.other.link'],
        settings: { foreground: color('--diff-token-link', '#2563c7', '#65a8ff'), fontStyle: 'underline' },
      },
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

registerCustomTheme(JUSTGIT_DIFF_THEMES.light, async () =>
  createJustGitTheme(JUSTGIT_DIFF_THEMES.light, 'light'),
);
registerCustomTheme(JUSTGIT_DIFF_THEMES.dark, async () =>
  createJustGitTheme(JUSTGIT_DIFF_THEMES.dark, 'dark'),
);
