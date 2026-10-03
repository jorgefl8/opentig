import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from '../../../scripts/test-support/source-analysis';

describe('runtime dependency boundary', () => {
  it('contains no Electron or native shortcut dependencies', async () => {
    const root = path.join(process.cwd(), 'src', 'main', 'runtime');
    const files = await sourceFiles(root);
    const offenders = files.filter(({ imports }) => imports.some((name) => name === 'electron' || name === 'uiohook-napi'))
      .map(({ file }) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
