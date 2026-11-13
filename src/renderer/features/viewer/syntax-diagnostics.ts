import { printParseErrorCode, visit, type JSONVisitor } from 'jsonc-parser';
import { LineCounter, parseAllDocuments, type YAMLError } from 'yaml';
import { resolvePierreLanguage } from './pierreLanguages';

/**
 * Lightweight syntax checks for structured data files, run in the renderer on
 * the editor draft. This is not a language server: it only reports what the
 * JSON/JSONC and YAML parsers themselves find, with short Error Lens-style
 * messages and zero-based positions that match Pierre's editor ranges.
 */

export type SyntaxDiagnosticLanguage = 'json' | 'jsonc' | 'yaml';
export type SyntaxDiagnosticSeverity = 'error' | 'warning';

export interface SyntaxPosition {
  /** Zero-based line. */
  line: number;
  /** Zero-based UTF-16 column. */
  character: number;
}

export interface SyntaxDiagnostic {
  severity: SyntaxDiagnosticSeverity;
  message: string;
  start: SyntaxPosition;
  end: SyntaxPosition;
  source: 'JSON' | 'JSONC' | 'YAML';
  code: string;
}

export interface SyntaxDiagnosticsResult {
  diagnostics: SyntaxDiagnostic[];
  /** Problems found beyond the cap and left out of `diagnostics`. */
  omitted: number;
  /** True when the text is too large to check. */
  skipped: boolean;
}

/** Larger drafts are not checked; they also leave the plain editor surface. */
export const SYNTAX_DIAGNOSTICS_MAX_CHARS = 512 * 1024;
/** Enough to show every problem in a broken file without flooding the editor. */
export const SYNTAX_DIAGNOSTICS_MAX_RESULTS = 100;

const EMPTY_RESULT: SyntaxDiagnosticsResult = Object.freeze({ diagnostics: [], omitted: 0, skipped: false }) as SyntaxDiagnosticsResult;

export function syntaxDiagnosticsLanguage(path: string): SyntaxDiagnosticLanguage | null {
  const language: string = resolvePierreLanguage(path);
  if (language === 'json' || language === 'jsonc') return language;
  return language === 'yaml' || language === 'yml' ? 'yaml' : null;
}

export function analyzeSyntax(
  text: string,
  language: SyntaxDiagnosticLanguage | null,
  { maxChars = SYNTAX_DIAGNOSTICS_MAX_CHARS, maxResults = SYNTAX_DIAGNOSTICS_MAX_RESULTS } = {},
): SyntaxDiagnosticsResult {
  if (language === null) return EMPTY_RESULT;
  if (text.length > maxChars) return { diagnostics: [], omitted: 0, skipped: true };
  const found = language === 'yaml' ? yamlProblems(text) : jsonProblems(text, language === 'jsonc');
  const lines = new LineIndex(text);
  const diagnostics = collapseErrors(found.map(({ offset, length, ...problem }) => ({ ...problem, ...lines.range(offset, length) })));
  diagnostics.sort((a, b) => comparePosition(a.start, b.start) || severityRank(a) - severityRank(b));
  return { diagnostics: diagnostics.slice(0, maxResults), omitted: Math.max(0, diagnostics.length - maxResults), skipped: false };
}

function comparePosition(a: SyntaxPosition, b: SyntaxPosition) {
  return a.line - b.line || a.character - b.character;
}

/**
 * While recovering, a parser can report several errors at one spot, such as a
 * missing comma, value, and bracket. Keep the one that explains it best.
 */
function collapseErrors(diagnostics: SyntaxDiagnostic[]): SyntaxDiagnostic[] {
  const errorsAt = new Map<string, number>();
  const kept: SyntaxDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'error') {
      kept.push(diagnostic);
      continue;
    }
    const key = `${diagnostic.start.line}:${diagnostic.start.character}`;
    const index = errorsAt.get(key);
    if (index === undefined) {
      errorsAt.set(key, kept.length);
      kept.push(diagnostic);
    } else if (errorPriority(diagnostic.code) > errorPriority(kept[index]!.code)) {
      kept[index] = diagnostic;
    }
  }
  return kept;
}

function errorPriority(code: string) {
  return code === 'CloseBraceExpected' || code === 'CloseBracketExpected' || code === 'TrailingComma' ? 1 : 0;
}

/** A problem as the parser reports it, before offsets become line positions. */
interface RawProblem extends Omit<SyntaxDiagnostic, 'start' | 'end'> {
  offset: number;
  length: number;
}

function severityRank(diagnostic: SyntaxDiagnostic) {
  return diagnostic.severity === 'error' ? 0 : 1;
}

/** Maps offsets to zero-based line/character positions. */
class LineIndex {
  readonly #starts: number[] = [0];
  readonly #text: string;
  /** Offset just past the last non-whitespace character. */
  readonly #contentEnd: number;

  constructor(text: string) {
    this.#text = text;
    let contentEnd = text.length;
    while (contentEnd > 0 && /\s/.test(text[contentEnd - 1]!)) contentEnd -= 1;
    this.#contentEnd = contentEnd;
    for (let index = 0; index < text.length; index += 1) {
      if (text.charCodeAt(index) === 10) this.#starts.push(index + 1);
    }
  }

  position(offset: number): SyntaxPosition {
    const bounded = Math.max(0, Math.min(offset, this.#text.length));
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.#starts[middle]! <= bounded) low = middle;
      else high = middle - 1;
    }
    return { line: low, character: bounded - this.#starts[low]! };
  }

  /**
   * A parser that runs out of input reports the end of the text, which is often
   * the empty line after the final newline. Show it on the last line that has
   * content instead, where the problem is visible.
   */
  range(offset: number, length: number): { start: SyntaxPosition; end: SyntaxPosition } {
    let start = Math.max(0, Math.min(offset, this.#text.length));
    let end = Math.max(start, Math.min(offset + Math.max(0, length), this.#text.length));
    if (start === end && start >= this.#contentEnd && this.#contentEnd > 0) {
      start = this.#contentEnd - 1;
      end = this.#contentEnd;
    }
    return { start: this.position(start), end: this.position(end) };
  }
}

// Wording follows the JSON messages VS Code shows, as full sentences.
const JSON_MESSAGES: Record<string, string> = {
  InvalidSymbol: 'Invalid symbol.',
  InvalidNumberFormat: 'Invalid number format.',
  PropertyNameExpected: 'Property expected.',
  ValueExpected: 'Value expected.',
  ColonExpected: 'Colon expected.',
  CommaExpected: 'Comma expected.',
  CloseBraceExpected: 'Closing brace expected.',
  CloseBracketExpected: 'Closing bracket expected.',
  EndOfFileExpected: 'End of file expected.',
  InvalidCommentToken: 'Comments are not permitted in JSON.',
  UnexpectedEndOfComment: 'Unexpected end of comment.',
  UnexpectedEndOfString: 'Unexpected end of string.',
  UnexpectedEndOfNumber: 'Unexpected end of number.',
  InvalidUnicode: 'Invalid Unicode sequence in string.',
  InvalidEscapeCharacter: 'Invalid escape character in string.',
  InvalidCharacter: 'Control characters in strings must be escaped.',
};

function jsonProblems(text: string, comments: boolean): RawProblem[] {
  const source = comments ? 'JSONC' : 'JSON';
  const found: RawProblem[] = [];
  const objectKeys: Set<string>[] = [];
  let depth = 0;
  let rootDone = false;
  const add = (severity: SyntaxDiagnosticSeverity, code: string, message: string, offset: number, length: number) => {
    found.push({ severity, code, message, source, offset, length });
  };
  const closeValue = () => { if (depth === 0) rootDone = true; };
  const visitor: JSONVisitor = {
    onObjectBegin: () => { depth += 1; objectKeys.push(new Set()); },
    onObjectEnd: () => { depth -= 1; objectKeys.pop(); closeValue(); },
    onArrayBegin: () => { depth += 1; },
    onArrayEnd: () => { depth -= 1; closeValue(); },
    onLiteralValue: closeValue,
    onObjectProperty(property, offset, length) {
      const keys = objectKeys.at(-1);
      if (!keys) return;
      if (keys.has(property)) add('warning', 'DuplicateKey', 'Duplicate object key.', offset, length);
      else keys.add(property);
    },
    onError(error, offset, length) {
      let code: string = printParseErrorCode(error);
      const trailingComma = trailingCommaBefore(text, code, offset);
      if (trailingComma !== null) {
        add('error', 'TrailingComma', 'Trailing comma.', trailingComma, 1);
        return;
      }
      // Anything after the root value, such as a stray word, is one problem.
      if (rootDone && depth === 0 && code === 'InvalidSymbol') code = 'EndOfFileExpected';
      add('error', code, JSON_MESSAGES[code] ?? 'Syntax error.', offset, length);
    },
  };
  visit(text, visitor, { disallowComments: !comments, allowTrailingComma: comments, allowEmptyContent: true });
  return found;
}

/** Strict JSON reports `[1,]` as a missing value; name the stray comma instead. */
function trailingCommaBefore(text: string, code: string, offset: number): number | null {
  if (code !== 'PropertyNameExpected' && code !== 'ValueExpected') return null;
  const closing = text[offset];
  if (closing !== '}' && closing !== ']') return null;
  let index = offset - 1;
  while (index >= 0 && /\s/.test(text[index]!)) index -= 1;
  return text[index] === ',' ? index : null;
}

function yamlProblems(text: string): RawProblem[] {
  const found: RawProblem[] = [];
  const seen = new Set<string>();
  const add = (severity: SyntaxDiagnosticSeverity, problem: YAMLError) => {
    const [start, end] = problem.pos;
    // The parser can report one problem from more than one document pass.
    const key = `${severity}:${problem.code}:${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ severity, code: problem.code, message: yamlMessage(problem), source: 'YAML', offset: start, length: end - start });
  };
  let documents;
  try {
    documents = parseAllDocuments(text, { lineCounter: new LineCounter(), prettyErrors: false });
  } catch {
    return found;
  }
  for (const document of Array.isArray(documents) ? documents : [documents]) {
    for (const problem of document.errors) add('error', problem);
    for (const problem of document.warnings) add('warning', problem);
  }
  return found;
}

function yamlMessage(problem: YAMLError): string {
  let message = problem.message.split('\n')[0]!.trim();
  // The parser phrases this as `Missing closing "quote`.
  message = message.replace(/^Missing closing (["'])quote$/, 'Missing closing $1 quote');
  // `Unexpected scalar token in YAML stream: "c"` reads better as `Unexpected "c"`.
  message = message.replace(/^Unexpected [\w-]+ token in YAML stream: (.+)$/, 'Unexpected $1');
  message = message.replace(/^Unresolved tag: tag:yaml\.org,2002:/, 'Unresolved tag: !!');
  if (!message) message = 'Syntax error';
  message = message[0]!.toUpperCase() + message.slice(1);
  return /[.!?]$/.test(message) ? message : `${message}.`;
}
