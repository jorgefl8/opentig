import { describe, expect, it } from 'vitest';
import { parseAnsi, stripAnsi } from './ansi';

describe('colors in a log line', () => {
  it('reads the terminal colors and styles, and resets them', () => {
    expect(parseAnsi('\x1b[1;31mFAIL\x1b[0m test/a.ts \x1b[32m✓\x1b[39m')).toEqual([
      { text: 'FAIL', fg: 1, bg: null, bold: true, dim: false, italic: false, underline: false },
      { text: ' test/a.ts ', fg: null, bg: null, bold: false, dim: false, italic: false, underline: false },
      { text: '✓', fg: 2, bg: null, bold: false, dim: false, italic: false, underline: false },
    ]);
  });

  it('takes the nearest of the sixteen theme colors for 256-color and true-color codes', () => {
    expect(parseAnsi('\x1b[38;5;196mred\x1b[38;2;20;200;20mgreen\x1b[48;5;244mgrey').map((segment) => [segment.text, segment.fg, segment.bg])).toEqual([
      ['red', 9, null], ['green', 2, null], ['grey', 2, 8],
    ]);
  });

  it('keeps markup and stray escapes as text, never as anything else', () => {
    const segments = parseAnsi('<b onclick="x()">bold?</b>\x1b[2J\x1b');
    expect(segments.map((segment) => segment.text).join('')).toBe('<b onclick="x()">bold?</b>');
    expect(stripAnsi('\x1b[31mred\x1b[0m and \x1b[1mbold')).toBe('red and bold');
  });
});
