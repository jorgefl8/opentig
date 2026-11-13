// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { LineBlameCommit, LineBlameResult } from '@shared/line-blame';
import { blameForLine, blameGhostText, blameTargetLine, formatBlameAge, lineNumberFromEventPath } from './line-blame';

const now = Date.parse('2026-11-11T12:00:00Z');
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

const commit: LineBlameCommit = {
  oid: 'a'.repeat(40),
  uncommitted: false,
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  authoredAt: ago(95 * 86_400),
  summary: 'Fix rounding in totals',
};

describe('formatBlameAge', () => {
  it('spells out the largest whole unit', () => {
    expect(formatBlameAge(ago(10), now)).toBe('just now');
    expect(formatBlameAge(ago(60), now)).toBe('1 minute ago');
    expect(formatBlameAge(ago(5 * 3600), now)).toBe('5 hours ago');
    expect(formatBlameAge(ago(86_400), now)).toBe('1 day ago');
    expect(formatBlameAge(ago(12 * 86_400), now)).toBe('1 week ago');
    expect(formatBlameAge(ago(95 * 86_400), now)).toBe('3 months ago');
    expect(formatBlameAge(ago(800 * 86_400), now)).toBe('2 years ago');
  });

  it('reads a future time as now and ignores an invalid date', () => {
    expect(formatBlameAge(ago(-3600), now)).toBe('just now');
    expect(formatBlameAge('not a date', now)).toBe('');
  });
});

describe('blameGhostText', () => {
  it('reads like an editor inline blame', () => {
    expect(blameGhostText(commit, now)).toBe('Ada Lovelace, 3 months ago • Fix rounding in totals');
    expect(blameGhostText({ ...commit, oid: '0'.repeat(40), uncommitted: true }, now)).toBe('Not committed yet');
  });
});

describe('blameForLine', () => {
  const result: LineBlameResult = { status: 'ready', commits: [commit], lines: [{ commit: 0, originalLine: 4 }] };

  it('returns the commit of a one-based line', () => {
    expect(blameForLine(result, 1)).toEqual({ commit, originalLine: 4 });
  });

  it('returns nothing for lines or files without blame', () => {
    expect(blameForLine(result, 2)).toBeNull();
    expect(blameForLine(result, 0)).toBeNull();
    expect(blameForLine({ status: 'untracked' }, 1)).toBeNull();
    expect(blameForLine(null, 1)).toBeNull();
  });
});

describe('blameTargetLine', () => {
  it('prefers the hovered line and shows the caret line only while editing', () => {
    expect(blameTargetLine({ hovered: 3, caret: 7, focused: true })).toBe(3);
    expect(blameTargetLine({ hovered: null, caret: 7, focused: true })).toBe(7);
    expect(blameTargetLine({ hovered: null, caret: 7, focused: false })).toBeNull();
  });
});

describe('lineNumberFromEventPath', () => {
  function editor() {
    const pre = document.createElement('pre');
    pre.innerHTML = '<code><div data-gutter><div data-column-number="2"><span>2</span></div></div>'
      + '<div data-content><div data-line="2"><span data-char="0">sum</span></div></div><div data-editor-overlay></div></code>';
    return pre;
  }
  const pathTo = (element: Element) => {
    const path: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) path.push(node);
    return path;
  };

  it('finds the line from a token, a row or a gutter number', () => {
    const pre = editor();
    expect(lineNumberFromEventPath(pathTo(pre.querySelector('[data-char]')!))).toBe(2);
    expect(lineNumberFromEventPath(pathTo(pre.querySelector('[data-line]')!))).toBe(2);
    expect(lineNumberFromEventPath(pathTo(pre.querySelector('[data-column-number] span')!))).toBe(2);
  });

  it('ignores the rest of the editor', () => {
    const pre = editor();
    expect(lineNumberFromEventPath(pathTo(pre.querySelector('[data-editor-overlay]')!))).toBeNull();
    expect(lineNumberFromEventPath(pathTo(pre))).toBeNull();
  });
});
