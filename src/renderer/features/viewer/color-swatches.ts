/**
 * Where the always-visible color swatches go. Pierre draws the caret and
 * selections from measured text widths, so making room for a swatch inside
 * the line would put them out of step with the text. Instead a swatch sits in
 * the whitespace already in front of the value, drawn above the code, and a
 * value with no whitespace before it keeps only the hover preview.
 */
import type { ColorRange } from './css-colors';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A swatch for one color, with the whitespace character it is drawn over. */
export interface SwatchSlot {
  range: ColorRange;
  cell: number;
}

/** A swatch laid out relative to its layer. */
export interface PlacedSwatch {
  key: string;
  value: string;
  line: Element;
  start: number;
  end: number;
  left: number;
  top: number;
  size: number;
}

const OPENING_QUOTES = new Set(['"', "'", '`']);
const SMALLEST_SWATCH = 5;
/** Space kept between a swatch and the value when a wide tab leaves room for it. */
const TAB_GAP = 3;

/**
 * The whitespace character a swatch for `range` can cover without hiding any
 * text: the one right before the value, or before its opening quote. -1 when
 * the value follows other text directly, as in `color:#fff` or `fill="#fff"`.
 */
export function swatchCell(line: string, range: ColorRange): number {
  let index = range.start - 1;
  if (index >= 0 && OPENING_QUOTES.has(line[index]!)) index -= 1;
  return index >= 0 && (line[index] === ' ' || line[index] === '\t') ? index : -1;
}

/** The colors in a line that get a swatch, in source order. */
export function swatchSlots(line: string, ranges: readonly ColorRange[]): SwatchSlot[] {
  const slots: SwatchSlot[] = [];
  for (const range of ranges) {
    const cell = swatchCell(line, range);
    if (cell !== -1) slots.push({ range, cell });
  }
  return slots;
}

/**
 * A square inside the whitespace character's box, a pixel narrower so it does
 * not touch the glyphs on either side. A tab is wider than the swatch, so the
 * swatch moves next to the value instead of floating in the middle of it.
 */
export function swatchBox(cell: Box): Box & { size: number } {
  const size = Math.max(SMALLEST_SWATCH, Math.round(Math.min(cell.width, cell.height * 0.5)) - 1);
  const left = cell.width >= size * 2 + TAB_GAP
    ? cell.left + cell.width - size - TAB_GAP
    : cell.left + (cell.width - size) / 2;
  const top = cell.top + (cell.height - size) / 2;
  return { left: Math.round(left * 2) / 2, top: Math.round(top * 2) / 2, width: size, height: size, size };
}

/** Whether a box lies wholly inside the bounds; a swatch is never drawn cut in half. */
export function boxInside(box: Box, bounds: Bounds): boolean {
  return box.left >= bounds.left && box.left + box.width <= bounds.right
    && box.top >= bounds.top && box.top + box.height <= bounds.bottom;
}

/** The swatch under a viewport point, given where the layer's origin is now. */
export function swatchAt(swatches: readonly PlacedSwatch[], origin: { left: number; top: number }, x: number, y: number): PlacedSwatch | undefined {
  // One extra pixel around each swatch, since they are small targets.
  return swatches.find((swatch) => {
    const left = origin.left + swatch.left - 1;
    const top = origin.top + swatch.top - 1;
    return x >= left && x <= left + swatch.size + 2 && y >= top && y <= top + swatch.size + 2;
  });
}

/** Whether two layouts would draw the same thing, so an unchanged frame skips a render. */
export function sameSwatches(a: readonly PlacedSwatch[], b: readonly PlacedSwatch[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((swatch, index) => {
    const other = b[index]!;
    return swatch.key === other.key && swatch.value === other.value && swatch.left === other.left
      && swatch.top === other.top && swatch.size === other.size && swatch.line === other.line;
  });
}
