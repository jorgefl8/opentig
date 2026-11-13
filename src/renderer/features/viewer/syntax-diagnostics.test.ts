import { describe, expect, it } from 'vitest';
import { analyzeSyntax, syntaxDiagnosticsLanguage, type SyntaxDiagnostic } from './syntax-diagnostics';

function summary(diagnostics: SyntaxDiagnostic[]) {
  return diagnostics.map(({ severity, message, start, end }) => ({
    severity, message, from: [start.line, start.character], to: [end.line, end.character],
  }));
}

describe('syntax diagnostics language', () => {
  it.each([
    ['config/settings.json', 'json'],
    ['package.json', 'json'],
    ['tsconfig.json', 'jsonc'],
    ['tsconfig.build.json', 'jsonc'],
    ['.vscode/settings.json', 'jsonc'],
    ['data/config.jsonc', 'jsonc'],
    ['.github/workflows/ci.yml', 'yaml'],
    ['deploy/values.YAML', 'yaml'],
    ['notes.md', null],
    ['data/events.jsonl', null],
    ['config.json5', null],
  ] as const)('%s → %s', (path, language) => {
    expect(syntaxDiagnosticsLanguage(path)).toBe(language);
  });
});

describe('JSON diagnostics', () => {
  it('reports nothing for valid or empty JSON', () => {
    expect(analyzeSyntax('{\n  "name": "sample",\n  "tags": [1, 2]\n}\n', 'json').diagnostics).toEqual([]);
    expect(analyzeSyntax('', 'json').diagnostics).toEqual([]);
    expect(analyzeSyntax('  \n', 'json').diagnostics).toEqual([]);
  });

  it('marks a stray word after the root value as the end of the file', () => {
    const { diagnostics } = analyzeSyntax('{\n  "a": 1\n}\nassa\n', 'json');
    expect(summary(diagnostics)).toEqual([
      { severity: 'error', message: 'End of file expected.', from: [3, 0], to: [3, 4] },
    ]);
    expect(diagnostics[0]).toMatchObject({ source: 'JSON', code: 'EndOfFileExpected' });
  });

  it('maps parser errors to short messages on the right line', () => {
    expect(summary(analyzeSyntax('{\n  "a" 1\n}', 'json').diagnostics)).toEqual([
      { severity: 'error', message: 'Colon expected.', from: [1, 6], to: [1, 7] },
    ]);
    expect(summary(analyzeSyntax('{\n  "a": 1\n  "b": 2\n}', 'json').diagnostics)).toEqual([
      { severity: 'error', message: 'Comma expected.', from: [2, 2], to: [2, 5] },
    ]);
  });

  it('puts a problem found at the end of the file on the last line with text', () => {
    expect(summary(analyzeSyntax('{\n  "a": 1\n\n', 'json').diagnostics)).toEqual([
      { severity: 'error', message: 'Closing brace expected.', from: [1, 7], to: [1, 8] },
    ]);
  });

  it('counts columns per line with Windows line endings', () => {
    expect(summary(analyzeSyntax('{\r\n  "a": tru\r\n}\r\n', 'json').diagnostics)[0]).toMatchObject({ from: [1, 7] });
  });

  it('rejects comments and names trailing commas once in strict JSON', () => {
    expect(summary(analyzeSyntax('{\n  // note\n  "a": 1,\n}\n', 'json').diagnostics)).toEqual([
      { severity: 'error', message: 'Comments are not permitted in JSON.', from: [1, 2], to: [1, 9] },
      { severity: 'error', message: 'Trailing comma.', from: [2, 8], to: [2, 9] },
    ]);
    expect(summary(analyzeSyntax('[1, 2,]', 'json').diagnostics)).toEqual([
      { severity: 'error', message: 'Trailing comma.', from: [0, 5], to: [0, 6] },
    ]);
  });

  it('warns about duplicate keys within one object only', () => {
    const { diagnostics } = analyzeSyntax('{\n  "a": 1,\n  "b": { "a": 2 },\n  "a": 3\n}', 'json');
    expect(summary(diagnostics)).toEqual([
      { severity: 'warning', message: 'Duplicate object key.', from: [3, 2], to: [3, 5] },
    ]);
  });
});

describe('JSON with comments diagnostics', () => {
  it('accepts comments and trailing commas', () => {
    const text = '{\n  // Compiler options\n  "compilerOptions": {\n    "strict": true, /* keep */\n  },\n}\n';
    expect(analyzeSyntax(text, 'jsonc').diagnostics).toEqual([]);
  });

  it('still reports real syntax errors', () => {
    const { diagnostics } = analyzeSyntax('{\n  // ok\n  "a": [1, 2\n}\n', 'jsonc');
    expect(summary(diagnostics)).toEqual([
      { severity: 'error', message: 'Closing bracket expected.', from: [3, 0], to: [3, 1] },
    ]);
    expect(diagnostics[0]!.source).toBe('JSONC');
  });
});

describe('YAML diagnostics', () => {
  it('reports nothing for valid YAML, including several documents', () => {
    expect(analyzeSyntax('name: CI\non:\n  push:\n    branches: [main]\n', 'yaml').diagnostics).toEqual([]);
    expect(analyzeSyntax('a: 1\n---\n- b\n', 'yaml').diagnostics).toEqual([]);
  });

  it('reports errors with their line', () => {
    expect(summary(analyzeSyntax('name: CI\nname: Build\n', 'yaml').diagnostics)).toEqual([
      { severity: 'error', message: 'Map keys must be unique.', from: [1, 0], to: [1, 1] },
    ]);
    expect(summary(analyzeSyntax('jobs:\n\t- build\n', 'yaml').diagnostics)).toEqual([
      { severity: 'error', message: 'Tabs are not allowed as indentation.', from: [1, 0], to: [1, 1] },
    ]);
  });

  it('rewords parser messages that read awkwardly', () => {
    expect(summary(analyzeSyntax('title: "unterminated\n', 'yaml').diagnostics)).toEqual([
      { severity: 'error', message: 'Missing closing " quote.', from: [0, 19], to: [0, 20] },
    ]);
    expect(analyzeSyntax('- a\nb: c\n', 'yaml').diagnostics.map((item) => item.message)).toContain('Unexpected "c".');
  });

  it('reports warnings separately from errors', () => {
    expect(summary(analyzeSyntax('value: !!weird 1\n', 'yaml').diagnostics)).toEqual([
      { severity: 'warning', message: 'Unresolved tag: !!weird.', from: [0, 7], to: [0, 14] },
    ]);
  });
});

describe('limits', () => {
  it('ignores files in other languages', () => {
    expect(analyzeSyntax('not json', null)).toEqual({ diagnostics: [], omitted: 0, skipped: false });
  });

  it('skips text over the size limit', () => {
    expect(analyzeSyntax('{"a": }', 'json', { maxChars: 4 })).toEqual({ diagnostics: [], omitted: 0, skipped: true });
  });

  it('keeps the first problems in document order and counts the rest', () => {
    const text = `{\n${Array.from({ length: 8 }, () => '  "a": 1,').join('\n')}\n  "b": 2\n}`;
    const result = analyzeSyntax(text, 'json', { maxResults: 3 });
    expect(result.diagnostics.map((item) => item.start.line)).toEqual([2, 3, 4]);
    expect(result.omitted).toBe(4);
  });
});
