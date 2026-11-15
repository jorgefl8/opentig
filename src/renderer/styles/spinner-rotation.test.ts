import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The names of the keyframes that turn something. */
function turningKeyframes(css: string): string[] {
  return [...withoutComments(css).matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)/g)]
    .filter((match) => match[2]!.includes('rotate'))
    .map((match) => match[1]!);
}

/** The selectors of the rules that run one of those keyframes. */
function rotatingSelectors(css: string, keyframes: string[]): string[] {
  return [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((rule) => [...rule[2]!.matchAll(/(?<![\w-])animation(?:-name)?\s*:\s*([^;]+)/g)]
      .some((declaration) => keyframes.some((name) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(declaration[1]!))))
    .map((rule) => rule[1]!.trim());
}

/** Tailwind's `animate-spin`, or the same written as an arbitrary value, rotates the element it is on. */
const SPIN_UTILITY = /animate-\[?spin/;

describe('spinner rotation', () => {
  const root = process.cwd();
  const renderer = path.join(root, 'src', 'renderer');
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  const sources = (pattern: string) => globSync(pattern, { cwd: renderer }).sort().map((file) => path.posix.join('src/renderer', file.split(path.sep).join('/')));

  // Rotating a whole `<svg>` element was measured to carry it around a small
  // circle on some displays, so a spinner only ever turns a group inside one.
  it('turns only the arc drawn inside a spinner, never an element', () => {
    const stylesheets = [...sources('**/*.css'), 'index.html'];
    const keyframes = stylesheets.flatMap((file) => turningKeyframes(read(file)));
    const rotating = stylesheets.flatMap((file) => rotatingSelectors(read(file), keyframes).map((selector) => `${file}: ${selector}`));

    expect(rotating).toEqual([
      // Each of these is a `<g>` inside an SVG that is not transformed itself.
      'src/renderer/styles/index.css: .splash-mark-arc',
      'src/renderer/styles/index.css: .spinner-arc',
      'index.html: #boot-shell .boot-mark-arc',
    ]);
  });

  it('keeps the spin utility out of the renderer', () => {
    const self = 'src/renderer/styles/spinner-rotation.test.ts';
    const offenders = sources('**/*.{ts,tsx,css}').filter((file) => file !== self && SPIN_UTILITY.test(read(file)));

    expect(offenders).toEqual([]);
  });

  it('flags a rotating rule and the spin utility without tripping on other animations', () => {
    const css = `
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes turn { from { rotate: 0deg; } to { rotate: 1turn; } }
      @keyframes fade-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      /* .ghost { animation: spin 1s linear infinite; } */
      @layer components {
        .icon { animation: spin 1s linear infinite; }
        .ring, .ring-two { animation-name: turn; }
        .panel { animation: fade-rise .2s ease-out; }
        .spinning-top { animation: fade-rise .2s; }
      }
    `;
    expect(turningKeyframes(css)).toEqual(['spin', 'turn']);
    expect(rotatingSelectors(css, turningKeyframes(css))).toEqual(['.icon', '.ring, .ring-two']);

    expect(SPIN_UTILITY.test('<IconRefresh className="size-4 animate-spin" />')).toBe(true);
    expect(SPIN_UTILITY.test('className="animate-[spin_2s_linear_infinite]"')).toBe(true);
    expect(SPIN_UTILITY.test('className="animate-in fade-in" data-slot="spinner"')).toBe(false);
  });
});
