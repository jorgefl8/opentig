import { describe, expect, it } from 'vitest';
import { JUSTGIT_CODE_THEMES } from './diffThemes';

describe('JUSTGIT_CODE_THEMES', () => {
  it('exposes the registered custom theme names', () => {
    expect(JUSTGIT_CODE_THEMES).toEqual({
      light: 'justgit-light',
      dark: 'justgit-dark',
    });
  });
});
