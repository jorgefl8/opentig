import { describe, expect, it } from 'vitest';
// @ts-expect-error The build validator is a Node script, exercised as shipped.
import { containsPersonalPath, importedSpecifiers } from '../scripts/verify-build.mjs';

it('ignores library documentation examples while still checking real server imports', () => {
  expect(importedSpecifiers(`/* const parser = require('parse5'); */
    // import('example')
    import fs from 'node:fs';
    const url = "https://example.com"; const ws = require('ws');
    const other = import('unexpected-package');`)).toEqual(['node:fs', 'ws', 'unexpected-package']);
});

describe('server build privacy check', () => {
  it('allows only the exact standard Homebrew executable directory literal', () => {
    expect(containsPersonalPath('const bin = "/home/linuxbrew/.linuxbrew/bin";')).toBe(false);
    for (const source of ['"/home/sample/project"', '"/Users/sample/project"', '"C:/Users/sample/project"', '"/home/linuxbrew/private"', '"/home/linuxbrew/.linuxbrew/bin/private"']) expect(containsPersonalPath(source)).toBe(true);
  });
  it('allows the Emscripten virtual home bundled with PDF.js, but not real checkout paths', () => {
    expect(containsPersonalPath('const env = {HOME:"/home/web_user",PATH:"/"}')).toBe(false);
    expect(containsPersonalPath('const env = {HOME:"/home/web_user/private"}')).toBe(true);
    expect(containsPersonalPath('const path = "/home/web_user"')).toBe(true);
  });
});
