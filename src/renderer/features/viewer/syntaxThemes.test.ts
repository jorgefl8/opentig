import { describe, expect, it } from 'vitest';
import { OPENTIG_SYNTAX_THEMES } from './syntaxThemes';

describe('OPENTIG_SYNTAX_THEMES', () => {
  it('uses the same One themes as Markdown code blocks', () => {
    expect(OPENTIG_SYNTAX_THEMES).toEqual({
      light: 'one-light',
      dark: 'one-dark-pro',
    });
  });
});
