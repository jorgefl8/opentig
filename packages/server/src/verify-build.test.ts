import { describe, expect, it } from 'vitest';
// @ts-expect-error The build validator is a Node script, exercised as shipped.
import { containsPersonalPath } from '../scripts/verify-build.mjs';

describe('server build privacy check', () => {
  it('allows only the exact standard Homebrew executable directory literal', () => {
    expect(containsPersonalPath('const bin = "/home/linuxbrew/.linuxbrew/bin";')).toBe(false);
    for (const source of ['"/home/sample/project"', '"/Users/sample/project"', '"C:/Users/sample/project"', '"/home/linuxbrew/private"', '"/home/linuxbrew/.linuxbrew/bin/private"']) expect(containsPersonalPath(source)).toBe(true);
  });
});
