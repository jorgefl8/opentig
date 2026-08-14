import { describe, expect, it } from 'vitest';
import { normalizeRepositoryKey } from './repository-projects';

describe('normalizeRepositoryKey', () => {
  it('normalizes Windows separators, casing, and trailing separators', () => {
    expect(normalizeRepositoryKey('C:\\Work\\Project\\.git\\')).toBe('c:/work/project/.git');
  });

  it('leaves an already normalized key stable', () => {
    expect(normalizeRepositoryKey('c:/work/project/.git')).toBe('c:/work/project/.git');
  });
});
