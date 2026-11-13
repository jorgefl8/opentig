// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attributeFromPath, columnFromPoint, findLineElement, lineText, positionAtColumn, rangeForColumns } from './color-hover-dom';

// Shiki splits one color into several tokens, the way Pierre renders a CSS line.
function renderLine(): HTMLElement {
  const host = document.createElement('section');
  host.setAttribute('data-color-language', 'css');
  host.innerHTML = '<div data-gutter><span data-column-number="3">3</span></div>'
    + '<div data-line="3"><span data-char="0">  --chart-1</span><span data-char="11">: </span>'
    + '<span data-char="13">oklch</span><span data-char="18">(</span><span data-char="19">0.7 0.1 195</span>'
    + '<span data-char="30">)</span><span data-char="31">;</span></div>';
  document.body.append(host);
  return host;
}

function pathFrom(element: Element): EventTarget[] {
  const path: EventTarget[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) path.push(node);
  return [...path, document, window];
}

const CHAR_WIDTH = 10;

describe('color hover DOM helpers', () => {
  let host: HTMLElement;
  let line: Element;

  beforeEach(() => {
    host = renderLine();
    line = host.querySelector('[data-line]')!;
    // jsdom has no layout: lay the line out as one row of fixed-width characters.
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        const before = document.createRange();
        before.setStart(line, 0);
        before.setEnd(this.startContainer, this.startOffset);
        const left = before.toString().length * CHAR_WIDTH;
        const right = left + this.toString().length * CHAR_WIDTH;
        return [{ left, right, top: 0, bottom: 20 }];
      },
    });
  });

  afterEach(() => {
    host.remove();
    delete (Range.prototype as Partial<Range>).getClientRects;
  });

  it('reads the full line text across tokens', () => {
    expect(lineText(line)).toBe('  --chart-1: oklch(0.7 0.1 195);');
  });

  it('finds the hovered line but not the gutter', () => {
    expect(findLineElement(pathFrom(line.querySelector('[data-char="19"]')!))).toBe(line);
    expect(findLineElement(pathFrom(host.querySelector('[data-column-number]')!))).toBeNull();
    expect(findLineElement(pathFrom(host))).toBeNull();
  });

  it('reads the language from an ancestor', () => {
    expect(attributeFromPath(pathFrom(line.firstElementChild!), 'data-color-language')).toBe('css');
    expect(attributeFromPath([document, window], 'data-color-language')).toBeUndefined();
  });

  it('maps columns into text nodes', () => {
    const start = positionAtColumn(line, 13)!;
    expect(start.node.data).toBe('oklch');
    expect(start.offset).toBe(0);
    expect(positionAtColumn(line, 22)).toMatchObject({ offset: 3 });
    expect(positionAtColumn(line, 32)).toMatchObject({ offset: 1 });
    expect(positionAtColumn(line, 33)).toBeNull();
    expect(positionAtColumn(line, -1)).toBeNull();
  });

  it('spans a range over a color split across tokens', () => {
    expect(rangeForColumns(line, 13, 31)?.toString()).toBe('oklch(0.7 0.1 195)');
  });

  it('finds the column under a point', () => {
    expect(columnFromPoint(line, 13 * CHAR_WIDTH + 2, 10)).toBe(13);
    expect(columnFromPoint(line, 24 * CHAR_WIDTH + 9, 10)).toBe(24);
    expect(columnFromPoint(line, 40 * CHAR_WIDTH, 10)).toBeNull();
    expect(columnFromPoint(line, 13 * CHAR_WIDTH, 30)).toBeNull();
  });
});
