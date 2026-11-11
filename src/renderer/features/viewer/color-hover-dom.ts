/**
 * Reads positions out of @pierre/diffs' rendered lines without touching them.
 * Pierre owns that DOM (and, while editing, the caret inside it), so these
 * helpers only walk and measure text nodes; they never add or move nodes.
 */

const LINE_ATTRIBUTE = 'data-line';
const GUTTER_ATTRIBUTE = 'data-column-number';

/** The rendered code line under the pointer, from an event's composed path; null over the gutter. */
export function findLineElement(path: readonly EventTarget[]): Element | null {
  for (const target of path) {
    if (!isElement(target)) continue;
    if (target.hasAttribute(GUTTER_ATTRIBUTE)) return null;
    if (target.hasAttribute(LINE_ATTRIBUTE)) return target;
  }
  return null;
}

/** The closest value of `attribute` along an event's composed path. */
export function attributeFromPath(path: readonly EventTarget[], attribute: string): string | undefined {
  for (const target of path) {
    if (isElement(target) && target.hasAttribute(attribute)) return target.getAttribute(attribute) ?? undefined;
  }
  return undefined;
}

/** The line's source text, as its text nodes spell it. */
export function lineText(line: Element): string {
  return textNodes(line).map((node) => node.data).join('');
}

/** The text node and offset where `column` falls; the end of the line maps to its last node's end. */
export function positionAtColumn(line: Element, column: number): { node: Text; offset: number } | null {
  if (column < 0) return null;
  let start = 0;
  let last: Text | null = null;
  for (const node of textNodes(line)) {
    const end = start + node.data.length;
    if (column < end) return { node, offset: column - start };
    start = end;
    last = node;
  }
  return last && column === start ? { node: last, offset: last.data.length } : null;
}

/** A DOM range over columns `[start, end)` of a line, for anchoring a popup to the text. */
export function rangeForColumns(line: Element, start: number, end: number): Range | null {
  const from = positionAtColumn(line, start);
  const to = positionAtColumn(line, end);
  if (!from || !to) return null;
  const range = line.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** The column of the character drawn under a viewport point, or null between or beyond characters. */
export function columnFromPoint(line: Element, x: number, y: number): number | null {
  const range = line.ownerDocument.createRange();
  let start = 0;
  for (const node of textNodes(line)) {
    range.selectNodeContents(node);
    if (rectsContain(range.getClientRects(), x, y)) {
      for (let offset = 0; offset < node.data.length; offset += 1) {
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        if (rectsContain(range.getClientRects(), x, y)) return start + offset;
      }
    }
    start += node.data.length;
  }
  return null;
}

function rectsContain(rects: DOMRectList, x: number, y: number): boolean {
  for (const rect of rects) {
    if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return true;
  }
  return false;
}

function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function isElement(target: EventTarget): target is Element {
  return typeof (target as Element).hasAttribute === 'function' && (target as Node).nodeType === 1;
}
