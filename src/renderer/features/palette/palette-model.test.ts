import { describe, expect, it } from 'vitest';
import { MAX_QUERY_LENGTH, highlightRange, matchScore, rankBy, readFileQuery, readInput, stepMode } from './palette-model';

describe('readInput', () => {
  it('switches tab on a sign typed into the empty field, and takes the sign out', () => {
    expect(readInput('>', 'files', '')).toEqual({ mode: 'commands', text: '' });
    expect(readInput('#24', 'files', '')).toEqual({ mode: 'pulls', text: '24' });
    expect(readInput('@main', 'commits', '')).toEqual({ mode: 'branches', text: 'main' });
    expect(readInput('~fix', 'files', '')).toEqual({ mode: 'commits', text: 'fix' });
    expect(readInput('!ci', 'files', '')).toEqual({ mode: 'runs', text: 'ci' });
    expect(readInput('*web', 'files', '')).toEqual({ mode: 'repositories', text: 'web' });
  });

  it('keeps a sign that follows other text, so editing never eats into what was typed', () => {
    expect(readInput('a#b', 'files', 'a')).toEqual({ mode: 'files', text: 'a#b' });
    expect(readInput('>pull', 'commands', '>pul')).toEqual({ mode: 'commands', text: '>pull' });
  });

  it('leaves anything else as text, whatever it looks like', () => {
    for (const hostile of ['$(rm -rf /)', '../../etc/passwd', '<img src=x onerror=alert(1)>', '.*(a+)+$', '\u0000\u202e', '%00', '`whoami`']) {
      expect(readInput(hostile, 'files', '')).toEqual({ mode: 'files', text: hostile });
    }
  });
});

describe('stepMode', () => {
  it('goes round the tabs both ways', () => {
    expect(stepMode('files', 1)).toBe('commands');
    expect(stepMode('files', -1)).toBe('repositories');
    expect(stepMode('repositories', 1)).toBe('files');
  });
});

describe('readFileQuery', () => {
  it('reads a line after the name, and a column after that', () => {
    expect(readFileQuery('filter:9')).toEqual({ name: 'filter', line: 9 });
    expect(readFileQuery(' src/app.ts:120:4 ')).toEqual({ name: 'src/app.ts', line: 120 });
  });

  it('keeps what is not a line number in the name', () => {
    expect(readFileQuery('C:\\notes')).toEqual({ name: 'C:\\notes', line: null });
    expect(readFileQuery('a:b')).toEqual({ name: 'a:b', line: null });
    expect(readFileQuery(':12')).toEqual({ name: ':12', line: null });
    expect(readFileQuery('name:')).toEqual({ name: 'name:', line: null });
    expect(readFileQuery('name:-3')).toEqual({ name: 'name:-3', line: null });
    // Too many digits to be a line: part of the name.
    expect(readFileQuery('name:12345678')).toEqual({ name: 'name:12345678', line: null });
  });

  it('opens on no line for line zero, and cuts a very long query before reading it', () => {
    expect(readFileQuery('name:0')).toEqual({ name: 'name', line: null });
    expect(readFileQuery('x'.repeat(10_000)).name).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('matching', () => {
  it('ranks the whole name, then its start, a word, anywhere, then letters in order', () => {
    const scores = ['pull', 'pull request', 'go pull', 'xpullx', 'p-u-l-l'].map((text) => matchScore(text, 'pull'));
    expect(scores).toEqual([...scores].sort((a, b) => a! - b!));
    expect(matchScore('push', 'pull')).toBeNull();
  });

  it('treats the query as plain text, never as a pattern', () => {
    expect(matchScore('a.b', '.*')).toBeNull();
    expect(matchScore('(a+)+', '(a+)+')).toBe(0);
    expect(rankBy(['[x]', 'x'], '[x]', (item) => [item], 10)).toEqual(['[x]']);
  });

  it('keeps the order things came in among equal matches, and the limit', () => {
    expect(rankBy(['b-fix', 'a-fix', 'c-fix'], 'fix', (item) => [item], 2)).toEqual(['b-fix', 'a-fix']);
    expect(rankBy(['one', 'two', 'three'], '', (item) => [item], 2)).toEqual(['one', 'two']);
  });

  it('ranks a match in the first field before one in a later field', () => {
    const items = [{ title: 'Rename the board', branch: 'feature/filter' }, { title: 'Filter tasks', branch: 'x' }];
    expect(rankBy(items, 'filter', (item) => [item.title, item.branch], 5).map((item) => item.title)).toEqual(['Filter tasks', 'Rename the board']);
  });

  it('marks where the query is, but not when lower case shifts the letters', () => {
    expect(highlightRange('Filter tasks', 'TASK')).toEqual([7, 11]);
    expect(highlightRange('İstanbul tasks', 'tasks')).toBeNull();
  });
});
