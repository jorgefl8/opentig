import { describe, expect, it, vi } from 'vitest';
import { cachedColorValidator, colorRangeAt, findColorRanges, isStylesheetLanguage, type ColorValidator } from './css-colors';

// Stands in for CSS.supports('color', value): accepts the shapes these tests use.
const isValid: ColorValidator = (value) =>
  /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
  || /^[\w-]+\((?=.*\d)[^"'`$]*\)$/.test(value)
  || ['red', 'white', 'transparent', 'rebeccapurple', 'RED'].includes(value);

const css = (line: string) => findColorRanges(line, { stylesheet: true, isValid }).map((range) => range.value);
const code = (line: string) => findColorRanges(line, { stylesheet: false, isValid }).map((range) => range.value);

describe('findColorRanges', () => {
  it('finds every hex length', () => {
    expect(css('a: #abc #abcd #3b82f6 #3b82f680;')).toEqual(['#abc', '#abcd', '#3b82f6', '#3b82f680']);
  });

  it('ignores hex-like text that is not a color', () => {
    expect(css('a: #abcde #12345g;')).toEqual([]);
    expect(css('#header .x { }')).toEqual([]);
    expect(code('see https://example.com/#abc and &#123; and $#fff')).toEqual([]);
  });

  it('reports exact ranges', () => {
    const line = '  --chart-1: oklch(0.7 0.1 195);';
    const [range] = findColorRanges(line, { stylesheet: true, isValid });
    expect(range).toEqual({ start: 13, end: 31, value: 'oklch(0.7 0.1 195)' });
    expect(line.slice(range!.start, range!.end)).toBe(range!.value);
  });

  it('finds every color function', () => {
    expect(css('a: rgb(255 0 0); b: rgba(0, 0, 0, 0.5); c: hsl(210 50% 40%); d: hsla(1, 2%, 3%, .4);'))
      .toEqual(['rgb(255 0 0)', 'rgba(0, 0, 0, 0.5)', 'hsl(210 50% 40%)', 'hsla(1, 2%, 3%, .4)']);
    expect(css('a: hwb(12 30% 40%); b: lab(52% 40 59); c: lch(52% 72 56); d: oklab(0.6 0.1 0.1); e: oklch(0.7 0.1 195 / 50%);'))
      .toEqual(['hwb(12 30% 40%)', 'lab(52% 40 59)', 'lch(52% 72 56)', 'oklab(0.6 0.1 0.1)', 'oklch(0.7 0.1 195 / 50%)']);
    expect(css('a: color(display-p3 1 0.5 0);')).toEqual(['color(display-p3 1 0.5 0)']);
  });

  it('keeps nested colors so the innermost can be picked', () => {
    const line = 'a: color-mix(in oklch, oklch(0.7 0.1 195) 40%, white);';
    expect(css(line)).toEqual(['color-mix(in oklch, oklch(0.7 0.1 195) 40%, white)', 'oklch(0.7 0.1 195)', 'white']);
    const ranges = findColorRanges(line, { stylesheet: true, isValid });
    expect(colorRangeAt(ranges, line.indexOf('0.1'))?.value).toBe('oklch(0.7 0.1 195)');
    expect(colorRangeAt(ranges, line.indexOf('white'))?.value).toBe('white');
    expect(colorRangeAt(ranges, line.indexOf('40%'))?.value).toMatch(/^color-mix/);
  });

  it('skips values that depend on context or do not parse', () => {
    expect(css('a: rgb(var(--r) 0 0); b: oklch(from var(--x) l c h); c: rgb(;')).toEqual([]);
    expect(code('const shade = rgb(r);')).toEqual([]);
    expect(code('paint(rgb(')).toEqual([]);
  });

  it('uses the validator as the final word', () => {
    const reject = vi.fn(() => false);
    expect(findColorRanges('a: #fff; b: red; c: rgb(0 0 0)', { stylesheet: true, isValid: reject })).toEqual([]);
    expect(reject).toHaveBeenCalledWith('#fff');
    expect(reject).toHaveBeenCalledWith('rgb(0 0 0)');
    expect(reject).toHaveBeenCalledWith('red');
  });

  it('previews named colors only in stylesheet values', () => {
    expect(css('  color: red; background: RebeccaPurple;')).toEqual(['red']);
    expect(css('  border: 1px solid RED;')).toEqual(['RED']);
    expect(css('.red > .white-space:hover { color: transparent; }')).toEqual(['transparent']);
    expect(css('  white-space: nowrap;')).toEqual([]);
    expect(css('$accent: red;')).toEqual(['red']);
    expect(code('const color = "red"; // red: the error state')).toEqual([]);
  });

  it('treats all-digit hex as a reference outside stylesheets', () => {
    expect(code('Fixes #123 and #4567')).toEqual([]);
    expect(code("const accent = '#123456' + '#3b82f6';")).toEqual(['#3b82f6']);
    expect(css('a: #123;')).toEqual(['#123']);
  });

  it('finds colors in strings of other languages', () => {
    expect(code("primary: 'oklch(0.7 0.1 195)', muted: '#e5e7eb',")).toEqual(['oklch(0.7 0.1 195)', '#e5e7eb']);
  });

  it('skips very long lines', () => {
    expect(css(`a: #fff;${' '.repeat(6_000)}`)).toEqual([]);
  });
});

describe('colorRangeAt', () => {
  const ranges = findColorRanges('a: #fff, #000;', { stylesheet: true, isValid });

  it('matches start inclusive and end exclusive', () => {
    expect(colorRangeAt(ranges, 3)?.value).toBe('#fff');
    expect(colorRangeAt(ranges, 6)?.value).toBe('#fff');
    expect(colorRangeAt(ranges, 7)).toBeUndefined();
    expect(colorRangeAt(ranges, 9)?.value).toBe('#000');
  });
});

describe('isStylesheetLanguage', () => {
  it('covers stylesheets and single-file components', () => {
    for (const language of ['css', 'scss', 'sass', 'less', 'vue', 'svelte', 'CSS']) expect(isStylesheetLanguage(language)).toBe(true);
    for (const language of ['typescript', 'markdown', 'html', 'text', undefined]) expect(isStylesheetLanguage(language)).toBe(false);
  });
});

describe('cachedColorValidator', () => {
  it('asks once per value and stays bounded', () => {
    const supports = vi.fn((value: string) => value === 'red');
    const validate = cachedColorValidator(supports, 2);
    expect(validate('red')).toBe(true);
    expect(validate('red')).toBe(true);
    expect(validate('nope')).toBe(false);
    expect(supports).toHaveBeenCalledTimes(2);
    validate('third');
    validate('red');
    expect(supports).toHaveBeenCalledTimes(4);
  });
});
