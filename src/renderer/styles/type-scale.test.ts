import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SIZE_TOKEN = /^var\(--text-(?:meta|ui|body|title|display|hero)\)$/;
const WEIGHT_TOKEN = /^var\(--weight-(?:regular|medium|strong)\)$/;
const FONT_SHORTHAND = /^(?:inherit|var\(--text-(?:meta|ui|body|title|display|hero)\) .+)$/;

function offTheScale(css: string): string[] {
  // @font-face descriptors describe a font file, so they can't use tokens.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
  const check = (property: string, allowed: RegExp) => [...rules.matchAll(new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;}]+)`, 'g'))]
    .map((match) => match[1]!.trim())
    .filter((value) => !allowed.test(value))
    .map((value) => `${property}: ${value}`);
  return [...check('font-size', SIZE_TOKEN), ...check('font-weight', WEIGHT_TOKEN), ...check('font', FONT_SHORTHAND)];
}

describe('type scale', () => {
  it('keeps every stylesheet on the size and weight tokens', () => {
    const root = path.join(process.cwd(), 'src', 'renderer');
    const offenders = globSync('**/*.css', { cwd: root }).sort().flatMap((file) =>
      offTheScale(readFileSync(path.join(root, file), 'utf8')).map((declaration) => `${file.split(path.sep).join('/')}: ${declaration}`));

    expect(offenders).toEqual([
      // PDF.js positions its text layer with a size computed for each glyph run.
      'features/viewer/pdf-file-viewer.css: font-size: calc(var(--text-scale-factor) * var(--font-height))',
      // Phone inputs stay 16px to avoid iOS focus zoom.
      'styles/mobile.css: font-size: 16px',
    ]);
  });

  it('flags raw values without tripping on tokens, custom properties or font files', () => {
    expect(offTheScale('.a { font-size: 11px; font-weight: 650; font: 10px var(--font-mono); }'))
      .toEqual(['font-size: 11px', 'font-weight: 650', 'font: 10px var(--font-mono)']);
    expect(offTheScale(`
      @font-face { font-family: 'Mono'; font-weight: 400; }
      html { --diffs-font-size: 16px; --diffs-token-light-font-weight: 400; }
      /* font-size: 9px */
      .a { font-size: var(--text-meta); font-weight: var(--weight-strong); font: var(--text-ui) var(--font-mono); }
      button { font: inherit; }
    `)).toEqual([]);
  });
});
