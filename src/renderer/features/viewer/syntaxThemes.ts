import type { ThemesType } from '@pierre/diffs';

/** Bundled Shiki theme names used by the standalone Markdown highlighter. */
export const OPENTIG_SYNTAX_THEMES = {
  light: 'one-light',
  dark: 'one-dark-pro',
} as const satisfies ThemesType;
