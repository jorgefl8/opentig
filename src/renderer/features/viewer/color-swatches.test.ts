import { describe, expect, it } from 'vitest';
import { boxInside, sameSwatches, swatchAt, swatchBox, swatchCell, swatchSlots, type PlacedSwatch } from './color-swatches';
import type { ColorRange } from './css-colors';
import { createColorSwatchRegistry } from './color-swatch-registry';

function rangeOf(line: string, value: string): ColorRange {
  const start = line.indexOf(value);
  return { start, end: start + value.length, value };
}

describe('swatchCell', () => {
  it('uses the space before a declaration value', () => {
    const line = '  --chart-1: oklch(0.7 0.1 195);';
    expect(swatchCell(line, rangeOf(line, 'oklch(0.7 0.1 195)'))).toBe(line.indexOf(' oklch'));
  });

  it('uses the whitespace before an opening quote', () => {
    for (const line of ["primary: '#3b82f6',", 'primary: "#3b82f6",', 'primary: `#3b82f6`,']) {
      expect(swatchCell(line, rangeOf(line, '#3b82f6'))).toBe(line.indexOf(' '));
    }
  });

  it('uses indentation and tabs', () => {
    expect(swatchCell('    #fff,', rangeOf('    #fff,', '#fff'))).toBe(3);
    expect(swatchCell('a:\t#fff', rangeOf('a:\t#fff', '#fff'))).toBe(2);
  });

  it('finds no room when text comes right before the value', () => {
    for (const [line, value] of [['color:#fff;', '#fff'], ['<rect fill="#fff">', '#fff'], ['#fff', '#fff'], ['shadow(rgb(0 0 0))', 'rgb(0 0 0)']] as const) {
      expect(swatchCell(line, rangeOf(line, value))).toBe(-1);
    }
  });
});

describe('swatchSlots', () => {
  it('keeps only the colors with room, in order', () => {
    const line = 'a: linear-gradient(#fff, hsl(0 0% 0%)) red;';
    const ranges = [rangeOf(line, '#fff'), rangeOf(line, 'hsl(0 0% 0%)'), rangeOf(line, 'red')];
    expect(swatchSlots(line, ranges).map((slot) => slot.range.value)).toEqual(['hsl(0 0% 0%)', 'red']);
  });
});

describe('swatchBox', () => {
  it('centers a square a pixel narrower than a space', () => {
    const box = swatchBox({ left: 100, top: 50, width: 7.9, height: 17 });
    expect(box.size).toBe(7);
    expect(box.left).toBe(100.5);
    expect(box.top).toBe(55);
  });

  it('caps the size by the line height', () => {
    expect(swatchBox({ left: 0, top: 0, width: 30, height: 12 }).size).toBe(5);
  });

  it('sits next to the value inside a wide tab', () => {
    const box = swatchBox({ left: 100, top: 0, width: 31.75, height: 17 });
    expect(box.left + box.size).toBeCloseTo(100 + 31.75 - 3, 0);
  });
});

describe('boxInside', () => {
  const bounds = { left: 40, right: 400, top: 0, bottom: 300 };
  it('rejects swatches that would be cut by the gutter or the edges', () => {
    expect(boxInside({ left: 50, top: 10, width: 7, height: 7 }, bounds)).toBe(true);
    expect(boxInside({ left: 36, top: 10, width: 7, height: 7 }, bounds)).toBe(false);
    expect(boxInside({ left: 396, top: 10, width: 7, height: 7 }, bounds)).toBe(false);
    expect(boxInside({ left: 50, top: 296, width: 7, height: 7 }, bounds)).toBe(false);
  });
});

const line = {} as Element;
const swatch = (key: string, left: number): PlacedSwatch => ({ key, value: '#fff', line, start: 0, end: 4, left, top: 20, size: 7 });

describe('swatchAt', () => {
  it('hit-tests in viewport coordinates with a pixel of slack', () => {
    const swatches = [swatch('a', 10), swatch('b', 40)];
    const origin = { left: 100, top: 200 };
    expect(swatchAt(swatches, origin, 113, 223)?.key).toBe('a');
    expect(swatchAt(swatches, origin, 109.5, 219.5)?.key).toBe('a');
    expect(swatchAt(swatches, origin, 145, 225)?.key).toBe('b');
    expect(swatchAt(swatches, origin, 125, 223)).toBeUndefined();
  });
});

describe('sameSwatches', () => {
  it('compares what would be drawn', () => {
    expect(sameSwatches([swatch('a', 1)], [swatch('a', 1)])).toBe(true);
    expect(sameSwatches([swatch('a', 1)], [swatch('a', 2)])).toBe(false);
    expect(sameSwatches([swatch('a', 1)], [])).toBe(false);
  });
});

describe('createColorSwatchRegistry', () => {
  it('hit-tests the swatches its layer last drew', () => {
    const registry = createColorSwatchRegistry();
    expect(registry.hit(0, 0)).toBeUndefined();
    const layer = { getBoundingClientRect: () => ({ left: 100, top: 200 }) } as Element;
    registry.update(layer, [swatch('a', 10)]);
    expect(registry.hit(113, 223)?.key).toBe('a');
    registry.update(null, []);
    expect(registry.hit(113, 223)).toBeUndefined();
  });
});
