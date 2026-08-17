import { describe, expect, it } from 'vitest';
import { JUSTGIT_SYNTAX_THEMES } from './syntaxThemes';

describe('JUSTGIT_SYNTAX_THEMES', () => {
  it('uses the same One themes as Markdown code blocks', () => {
    expect(JUSTGIT_SYNTAX_THEMES).toEqual({
      light: 'one-light',
      dark: 'one-dark-pro',
    });
  });
});
