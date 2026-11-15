/**
 * A log line's ANSI color codes, read into runs of plain text with a style. The
 * text is only ever put on the page as text: nothing in it is read as markup.
 * Colors are the terminal's sixteen, which the theme defines; a 256-color or
 * true-color code takes the nearest of them, so every color stays readable in
 * both themes.
 */
export interface AnsiSegment {
  text: string;
  /** 0–15: black, red, green, yellow, blue, magenta, cyan, white, then their bright forms. */
  fg: number | null;
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

type Style = Omit<AnsiSegment, 'text'>;

const PLAIN: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
// Only SGR survives the server's cleaning; anything else that looks like an escape is dropped here too.
// eslint-disable-next-line no-control-regex
const ESCAPE = /\x1b\[([0-9;]*)m|\x1b\[[^m]*$|\x1b[^[]?/g;

export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style = PLAIN;
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const previous = segments.at(-1);
    if (previous && sameStyle(previous, style)) previous.text += text;
    else segments.push({ text, ...style });
  };
  for (const match of line.matchAll(ESCAPE)) {
    push(line.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[1] !== undefined) style = applySgr(style, match[1]);
  }
  push(line.slice(last));
  return segments;
}

/** The line as plain text, as it is copied. */
export function stripAnsi(line: string): string {
  return line.replace(ESCAPE, '');
}

function sameStyle(left: Style, right: Style): boolean {
  return left.fg === right.fg && left.bg === right.bg && left.bold === right.bold && left.dim === right.dim && left.italic === right.italic && left.underline === right.underline;
}

function applySgr(current: Style, parameters: string): Style {
  const codes = parameters === '' ? [0] : parameters.split(';').map((value) => value === '' ? 0 : Number(value));
  let style = { ...current };
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index]!;
    if (!Number.isFinite(code)) continue;
    if (code === 0) style = { ...PLAIN };
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 22) { style.bold = false; style.dim = false; }
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code >= 30 && code <= 37) style.fg = code - 30;
    else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
    else if (code === 39) style.fg = null;
    else if (code >= 40 && code <= 47) style.bg = code - 40;
    else if (code >= 100 && code <= 107) style.bg = code - 100 + 8;
    else if (code === 49) style.bg = null;
    else if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      let color: number | null;
      if (mode === 5) { color = from256(codes[index + 2]); index += 2; }
      else if (mode === 2) { color = fromRgb(codes[index + 2], codes[index + 3], codes[index + 4]); index += 4; }
      else break;
      if (code === 38) style.fg = color;
      else style.bg = color;
    }
  }
  return style;
}

function from256(value: number | undefined): number | null {
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > 255) return null;
  if (value < 16) return value;
  if (value >= 232) {
    const level = value - 232;
    return level < 6 ? 0 : level < 15 ? 8 : level < 21 ? 7 : 15;
  }
  const cube = value - 16;
  const scale = [0, 95, 135, 175, 215, 255];
  return fromRgb(scale[Math.floor(cube / 36)], scale[Math.floor(cube / 6) % 6], scale[cube % 6]);
}

function fromRgb(red: number | undefined, green: number | undefined, blue: number | undefined): number | null {
  const channels = [red, green, blue];
  if (channels.some((value) => value === undefined || !Number.isFinite(value))) return null;
  const [r, g, b] = channels.map((value) => Math.max(0, Math.min(255, value!))) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Greys: black, bright black, white or bright white.
  if (max - min < 40) return max < 64 ? 0 : max < 150 ? 8 : max < 220 ? 7 : 15;
  const threshold = (max + min) / 2;
  const index = (r > threshold ? 1 : 0) + (g > threshold ? 2 : 0) + (b > threshold ? 4 : 0);
  return index + (max > 200 ? 8 : 0);
}
