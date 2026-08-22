import { describe, expect, it } from 'vitest';
import { OPENTIG_CODE_THEMES } from './diffThemes';

describe('OPENTIG_CODE_THEMES', () => {
  it('exposes the registered custom theme names', () => {
    expect(OPENTIG_CODE_THEMES).toEqual({
      light: 'opentig-light',
      dark: 'opentig-dark',
    });
  });
});
