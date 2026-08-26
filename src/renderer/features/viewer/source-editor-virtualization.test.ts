import { describe, expect, it } from 'vitest';
import { shouldVirtualizeSourceEditor } from './source-editor-virtualization';

describe('shouldVirtualizeSourceEditor', () => {
  it('keeps ordinary files with repeated trailing blank lines on the base File surface', () => {
    expect(shouldVirtualizeSourceEditor('first\nlast\n\n\n', 10)).toBe(false);
  });

  it('virtualizes only after the line threshold is exceeded', () => {
    expect(shouldVirtualizeSourceEditor('1\n2\n3', 3)).toBe(false);
    expect(shouldVirtualizeSourceEditor('1\n2\n3\n', 3)).toBe(true);
  });

  it('does not mistake a large single line for a large row count', () => {
    expect(shouldVirtualizeSourceEditor('x'.repeat(10_000), 3)).toBe(false);
  });
});
