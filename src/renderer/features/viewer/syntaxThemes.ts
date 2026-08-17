import type { ThemesType } from '@pierre/diffs';

/** Shared syntax palette for normal code surfaces, distinct from Git diffs. */
export const JUSTGIT_SYNTAX_THEMES = {
  light: 'one-light',
  dark: 'one-dark-pro',
} as const satisfies ThemesType;
