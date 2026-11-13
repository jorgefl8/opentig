/**
 * Finds CSS color literals in a line of source text, for the hover preview in
 * the Files editor and diffs. Detection is purely textual; whether a candidate
 * is really a color is left to an injected validator, which in the app is the
 * browser's own CSS parser.
 */

/** A color literal found in a line: `start` inclusive, `end` exclusive, in UTF-16 code units. */
export interface ColorRange {
  start: number;
  end: number;
  value: string;
}

/** Answers whether a candidate parses as a CSS `<color>`. */
export type ColorValidator = (value: string) => boolean;

export interface FindColorOptions {
  /**
   * Stylesheet-like source (CSS, SCSS, Less, Vue/Svelte style blocks…). Only
   * there are named colors such as `red` previewed, and all-digit hex such as
   * `#123`, which elsewhere is usually an issue or pull request reference.
   */
  stylesheet: boolean;
  isValid: ColorValidator;
}

/** Lines longer than this are minified or generated; scanning them is not worth it. */
const MAX_LINE_LENGTH = 5_000;
/** A color function longer than this is not a literal anyone wants previewed. */
const MAX_FUNCTION_LENGTH = 256;

const STYLESHEET_LANGUAGES = new Set([
  'css', 'scss', 'sass', 'less', 'stylus', 'postcss', 'vue', 'svelte', 'astro',
]);

/** Languages whose files are stylesheets or carry style blocks of their own. */
export function isStylesheetLanguage(language: string | undefined): boolean {
  return language !== undefined && STYLESHEET_LANGUAGES.has(language.toLowerCase());
}

// CSS Color 4 named colors, plus `transparent`. `currentcolor` and system
// colors depend on context, so there is nothing to preview for them.
export const CSS_NAMED_COLORS: ReadonlySet<string> = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'transparent', 'turquoise', 'violet', 'wheat',
  'white', 'whitesmoke', 'yellow', 'yellowgreen',
]);

// Not part of a longer word, a selector (`.`/`#`), a variable (`$`/`@`), a path or an HTML entity (`&#`).
const HEX = /(?<![\w&#$@./\\-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNCTION = /(?<![\w$.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/gi;
const WORD = /(?<![\w$@.#-])[a-z]+(?![\w(-])/gi;
// Values that depend on context the editor cannot know, so their swatch would be a guess.
const CONTEXTUAL = /\b(?:var|env|attr)\(/i;

/** Every color literal in `line`, in source order. Nested colors (inside `color-mix()`) are listed too. */
export function findColorRanges(line: string, { stylesheet, isValid }: FindColorOptions): ColorRange[] {
  if (line.length > MAX_LINE_LENGTH || !mayContainColor(line, stylesheet)) return [];
  const ranges: ColorRange[] = [];

  for (const match of line.matchAll(HEX)) {
    const value = match[0];
    if (!stylesheet && /^#\d+$/.test(value)) continue;
    if (isValid(value)) ranges.push({ start: match.index, end: match.index + value.length, value });
  }

  for (const match of line.matchAll(FUNCTION)) {
    const end = closingParenthesis(line, match.index + match[0].length - 1);
    if (end === -1) continue;
    const value = line.slice(match.index, end + 1);
    if (CONTEXTUAL.test(value) || !isValid(value)) continue;
    ranges.push({ start: match.index, end: end + 1, value });
  }

  // Named colors only in a declaration's value, after its colon, so selectors,
  // property names, and keywords before it are never mistaken for a color.
  const colon = stylesheet ? line.indexOf(':') : -1;
  if (colon !== -1) {
    for (const match of line.slice(colon + 1).matchAll(WORD)) {
      const value = match[0];
      if (!CSS_NAMED_COLORS.has(value.toLowerCase()) || !isValid(value)) continue;
      const start = colon + 1 + match.index;
      ranges.push({ start, end: start + value.length, value });
    }
  }

  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** The innermost color under `column`, so a color inside `color-mix()` wins over the mix itself. */
export function colorRangeAt(ranges: readonly ColorRange[], column: number): ColorRange | undefined {
  let found: ColorRange | undefined;
  for (const range of ranges) {
    if (column < range.start || column >= range.end) continue;
    if (!found || range.end - range.start < found.end - found.start) found = range;
  }
  return found;
}

/** Caches a validator's answers, since the same few values are checked on every pointer move. */
export function cachedColorValidator(isValid: ColorValidator, limit = 500): ColorValidator {
  const cache = new Map<string, boolean>();
  return (value) => {
    const known = cache.get(value);
    if (known !== undefined) return known;
    const valid = isValid(value);
    if (cache.size >= limit) cache.delete(cache.keys().next().value!);
    cache.set(value, valid);
    return valid;
  };
}

/** The browser's CSS parser as a validator, or one that rejects everything where there is none. */
export function browserColorValidator(): ColorValidator {
  const supports = globalThis.CSS?.supports;
  if (typeof supports !== 'function') return () => false;
  return cachedColorValidator((value) => globalThis.CSS.supports('color', value));
}

/** Remembers each line's colors, since the same lines are scanned on every pointer move and render. */
export function createColorRangeCache(isValid: ColorValidator, limit = 1_000): (line: string, stylesheet: boolean) => ColorRange[] {
  const cache = new Map<string, ColorRange[]>();
  return (line, stylesheet) => {
    const key = `${stylesheet ? 's' : 'c'}${line}`;
    let ranges = cache.get(key);
    if (!ranges) {
      ranges = findColorRanges(line, { stylesheet, isValid });
      if (cache.size >= limit) cache.delete(cache.keys().next().value!);
      cache.set(key, ranges);
    }
    return ranges;
  };
}

let sharedLineColors: ((line: string, stylesheet: boolean) => ColorRange[]) | undefined;

/** The colors in a rendered line, validated by the browser and shared by the hover and the swatches. */
export function lineColors(line: string, stylesheet: boolean): ColorRange[] {
  sharedLineColors ??= createColorRangeCache(browserColorValidator());
  return sharedLineColors(line, stylesheet);
}

function mayContainColor(line: string, stylesheet: boolean): boolean {
  return stylesheet || line.includes('#') || line.includes('(');
}

function closingParenthesis(line: string, open: number): number {
  let depth = 0;
  const limit = Math.min(line.length, open + MAX_FUNCTION_LENGTH);
  for (let index = open; index < limit; index += 1) {
    const char = line[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    } else if (char === ';' || char === '{' || char === '}') return -1;
  }
  return -1;
}
