import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileVersion, FileVersionsResult } from '@shared/contracts';
import { diffHighlightKey, wholeDiffHighlightKey } from './highlight-cache-key';
import { buildDiffFileEntry } from './patch-utils';
import { WHOLE_FILE_MAX_LINES, WholeFileDiffs, wholeFileDiff } from './whole-file-diff';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function repository(): (...args: string[]) => string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'opentig-whole-file-'));
  roots.push(root);
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.invalid');
  return run;
}

/** Commits `before` as `name`, writes `after` over it, and returns what `git diff <args>` shows with both versions as Git holds them. */
function changed(name: string, before: string, after: string, args: string[] = [], setup?: (git: (...args: string[]) => string, root: string) => void) {
  const git = repository();
  const root = git('rev-parse', '--show-toplevel').trim();
  setup?.(git, root);
  writeFileSync(path.join(root, name), before);
  git('add', '-A');
  git('commit', '-q', '-m', 'Before');
  writeFileSync(path.join(root, name), after);
  const patch = git('diff', ...args, '--', name);
  const old: FileVersion = { content: before, oid: git('rev-parse', `:${name}`).trim() };
  return { patch, entry: buildDiffFileEntry(patch, 0), old, new: { content: after, oid: null } satisfies FileVersion, git, root };
}

const variables = (count: number) => Array.from({ length: count }, (_, index) => `  --color-chart-${index + 1}: var(--chart-${index + 1});\n`);
const css = (lines: string[]) => `:root {\n${lines.join('')}}\n`;

describe('whole-file diffs', () => {
  it('keeps the patch’s hunks and lines, and adds the files up to them, for a hunk deep inside a block', () => {
    const lines = variables(100);
    const after = [...lines.slice(0, 61), '  --color-extra-1: var(--extra-1);\n', '  --color-extra-2: var(--extra-2);\n', ...lines.slice(61)];
    const { entry, old, new: next } = changed('chart.css', css(lines), css(after));
    expect(entry.fileDiff.hunks[0]!.additionStart).toBeGreaterThan(50);
    const whole = wholeFileDiff(entry.fileDiff, { old, new: next })!;
    expect(whole).not.toBeNull();
    expect(whole.isPartial).toBe(false);
    // Up to the end of the hunk, three lines of context past the two added: as many lines as the patch counted.
    expect(whole.additionLines).toHaveLength(67);
    expect(whole.deletionLines).toHaveLength(65);
    expect(whole.additionLines[0]).toBe(':root {\n');
    expect(whole.hunks.at(-1)!.collapsedBefore).toBe(59);
    expect(whole.unifiedLineCount).toBe(entry.fileDiff.unifiedLineCount);
    expect(whole.hunks.map((hunk) => [hunk.deletionStart, hunk.additionStart, hunk.hunkContent.length]))
      .toEqual(entry.fileDiff.hunks.map((hunk) => [hunk.deletionStart, hunk.additionStart, hunk.hunkContent.length]));
    // The patch alone was left as it was, for whatever else shows it.
    expect(entry.fileDiff.isPartial).toBe(true);
  });

  it('reads a rename’s old file on the old side', () => {
    const lines = variables(30);
    const git = repository();
    const root = git('rev-parse', '--show-toplevel').trim();
    writeFileSync(path.join(root, 'a.css'), css(lines));
    git('add', '-A');
    git('commit', '-q', '-m', 'Before');
    git('mv', 'a.css', 'b.css');
    writeFileSync(path.join(root, 'b.css'), css([...lines.slice(0, 20), '  --x: 1;\n', ...lines.slice(20)]));
    git('add', '-A');
    const patch = git('diff', '--cached', '-M');
    const entry = buildDiffFileEntry(patch, 0);
    expect(entry.changeType).toBe('rename-changed');
    const versions = { old: { content: css(lines), oid: null }, new: { content: css([...lines.slice(0, 20), '  --x: 1;\n', ...lines.slice(20)]), oid: null } };
    const hunk = entry.fileDiff.hunks[0]!;
    expect(wholeFileDiff(entry.fileDiff, versions)?.deletionLines).toEqual(versions.old.content.split(/(?<=\n)/).slice(0, hunk.deletionStart - 1 + hunk.deletionCount));
  });

  it('accepts a file with no newline at its end only when the patch says so', () => {
    const { entry, old, new: next } = changed('a.txt', 'one\ntwo\nthree\n', 'one\ntwo\nfour');
    expect(wholeFileDiff(entry.fileDiff, { old, new: next })).not.toBeNull();
    expect(wholeFileDiff(entry.fileDiff, { old, new: { content: 'one\ntwo\nfour\n', oid: null } })).toBeNull();
  });

  it('keeps the patch when the files are not the ones it compares', () => {
    const lines = variables(40);
    const after = css([...lines.slice(0, 30), '  --x: 1;\n', ...lines.slice(30)]);
    const { entry, old, new: next } = changed('a.css', css(lines), after);
    // Another version of the old file: its blob is not the one the patch names.
    expect(wholeFileDiff(entry.fileDiff, { old: { ...old, oid: 'f'.repeat(40) }, new: next })).toBeNull();
    // A line moved within what the patch shows, with no blob to tell.
    expect(wholeFileDiff(entry.fileDiff, { old: { content: css(lines).replace('chart-29:', 'chart-29 :'), oid: null }, new: next })).toBeNull();
    // A line added above the hunk shifts every line of it.
    expect(wholeFileDiff(entry.fileDiff, { old: { content: `/* */\n${css(lines)}`, oid: null }, new: { content: `/* */\n${after}`, oid: null } })).toBeNull();
    expect(wholeFileDiff(entry.fileDiff, { old: null, new: next })).toBeNull();
  });

  it('keeps the patch when Git shows other text than the files hold: line endings, ignored whitespace, a text conversion', () => {
    const lines = variables(20).map((line) => line.replace('\n', '\r\n'));
    const crlf = changed('a.css', css(lines), css([...lines.slice(0, 10), '  --x: 1;\r\n', ...lines.slice(10)]), [], (git, root) => {
      writeFileSync(path.join(root, '.gitattributes'), '*.css text eol=lf\n');
    });
    // The index holds the file with LF, which the patch shows; the working tree has CRLF.
    expect(crlf.patch).not.toContain('\r');
    expect(wholeFileDiff(crlf.entry.fileDiff, { old: { content: crlf.git('show', ':a.css'), oid: crlf.old.oid }, new: crlf.new })).toBeNull();

    const spaced = changed('b.css', css(variables(20)), css(variables(20).map((line, index) => index === 9 ? line.replace('  ', '    ') : index === 10 ? '  --x: 1;\n' : line)), ['-w']);
    expect(spaced.patch).toContain('--x: 1;');
    expect(wholeFileDiff(spaced.entry.fileDiff, { old: spaced.old, new: spaced.new })).toBeNull();

    const converted = changed('c.css', css(variables(20)), css([...variables(20).slice(0, 10), '  --x: 1;\n', ...variables(20).slice(10)]), [], (git, root) => {
      writeFileSync(path.join(root, '.gitattributes'), '*.css diff=upper\n');
      git('config', 'diff.upper.textconv', 'tr a-z A-Z <');
    });
    expect(converted.patch).toContain('--X: 1;');
    expect(wholeFileDiff(converted.entry.fileDiff, { old: converted.old, new: converted.new })).toBeNull();
  });

  it('leaves added and deleted files, whose patch is the whole file, and files past the line limit as they are', () => {
    const added = buildDiffFileEntry('diff --git a/a.txt b/a.txt\nnew file mode 100644\nindex 0000000..7898192\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+a\n', 0);
    expect(wholeFileDiff(added.fileDiff, { old: null, new: { content: 'a\n', oid: null } })).toBeNull();
    // What counts is what is kept, up to the last hunk.
    const many = 'x\n'.repeat(WHOLE_FILE_MAX_LINES / 2);
    const within = changed('big.txt', many, `${many.slice(2)}y\n`);
    expect(wholeFileDiff(within.entry.fileDiff, { old: within.old, new: within.new })).not.toBeNull();
    const past = changed('big.txt', `${many}x\n`, `${many}y\n`);
    expect(wholeFileDiff(past.entry.fileDiff, { old: past.old, new: past.new })).toBeNull();
    const early = changed('big.txt', `${many}x\n`, `y\n${many}`);
    expect(wholeFileDiff(early.entry.fileDiff, { old: early.old, new: early.new })).not.toBeNull();
  });

  it('highlights the whole files under a key of their own, never the patch’s', () => {
    const { entry, old, new: next } = changed('a.css', css(variables(10)), css(variables(11)));
    const whole = wholeFileDiff(entry.fileDiff, { old, new: next })!;
    expect(whole.cacheKey).not.toBe(entry.fileDiff.cacheKey);
    expect(whole.cacheKey).toBe(wholeDiffHighlightKey(entry.fileDiff.cacheKey!, old.content, next.content));
    // The files past the last hunk add nothing to what is shown, nor to the key.
    expect(wholeFileDiff(entry.fileDiff, { old: { ...old, content: `${old.content}/* tail */\n` }, new: { ...next, content: `${next.content}/* tail */\n` } })!.cacheKey).toBe(whole.cacheKey);
    expect(wholeDiffHighlightKey('k', 'a', 'b')).not.toBe(wholeDiffHighlightKey('k', 'a', 'c'));
    expect(wholeDiffHighlightKey('k', 'a', 'b')).not.toBe(wholeDiffHighlightKey('k', 'ab', ''));
    expect(wholeDiffHighlightKey(diffHighlightKey('p', 'css'), '', '')).not.toBe(diffHighlightKey('p', 'css'));
  });
});

describe('what one document reads whole', () => {
  const lines = variables(40);
  const fixture = changed('a.css', css(lines), css([...lines.slice(0, 30), '  --x: 1;\n', ...lines.slice(30)]));
  const ready = (): FileVersionsResult => ({ status: 'ready', old: fixture.old, new: fixture.new });
  const size = fixture.old.content.length + fixture.new.content.length;

  it('stays within its limit, asks for no more than is left, and gives back what a file held when its patch changes', async () => {
    const store = new WholeFileDiffs(size * 2);
    const asked: number[] = [];
    const read = async (_signal: AbortSignal, maxBytes: number) => { asked.push(maxBytes); return ready(); };
    const signal = new AbortController().signal;
    expect(await store.load('one', fixture.entry.fileDiff, read, signal)).not.toBeNull();
    expect(await store.load('two', fixture.entry.fileDiff, read, signal)).not.toBeNull();
    expect(asked).toEqual([size * 2, size]);
    // Nothing is left for a third file, which is not even asked for, nor remembered as unreadable.
    expect(await store.load('three', fixture.entry.fileDiff, read, signal)).toBeNull();
    expect(asked).toHaveLength(2);
    expect(store.kept('three', fixture.entry.fileDiff)).toBeUndefined();

    // The first file's patch changed, and its new one could not be read whole: what it held is the third's.
    const other = buildDiffFileEntry(fixture.patch.replace('--x: 1;', '--y: 1;'), 0);
    expect(await store.load('one', other.fileDiff, async () => ({ status: 'unavailable' }), signal)).toBeNull();
    expect(store.kept('one', fixture.entry.fileDiff)).toBeUndefined();
    expect(await store.load('three', fixture.entry.fileDiff, read, signal)).not.toBeNull();
    expect(asked).toEqual([size * 2, size, size]);
  });

  it('remembers a file that cannot be read whole, and hands out copies of one that was', async () => {
    const store = new WholeFileDiffs();
    let reads = 0;
    const signal = new AbortController().signal;
    expect(await store.load('a', fixture.entry.fileDiff, async () => { reads++; return { status: 'unavailable' }; }, signal)).toBeNull();
    expect(await store.load('a', fixture.entry.fileDiff, async () => { reads++; return ready(); }, signal)).toBeNull();
    expect(reads).toBe(1);
    expect(store.kept('a', fixture.entry.fileDiff)).toBeNull();

    await store.load('b', fixture.entry.fileDiff, async () => ready(), signal);
    const first = store.kept('b', fixture.entry.fileDiff)!;
    expect(first.isPartial).toBe(false);
    expect(store.kept('b', fixture.entry.fileDiff)).not.toBe(first);
  });

  it('measures what is left when a file’s turn to be read comes, and lets a refusal for want of room be asked again', async () => {
    // Reads that honor what they may bring, with about a megabyte past the last hunk of each version.
    const tail = '/* */\n'.repeat(90_000);
    const big = (): FileVersionsResult => ({ status: 'ready', old: { ...fixture.old, content: fixture.old.content + tail }, new: { ...fixture.new, content: fixture.new.content + tail } });
    const read = (versions: () => FileVersionsResult) => async (_signal: AbortSignal, maxBytes: number): Promise<FileVersionsResult> => {
      const result = versions();
      return result.status === 'ready' && result.old!.content.length + result.new!.content.length > maxBytes ? { status: 'unavailable' } : result;
    };
    const signal = new AbortController().signal;
    const small = new WholeFileDiffs();
    // Unfolding many small files at once: each waits for the reads before it and fits in what they left.
    const loads = await Promise.all(Array.from({ length: 10 }, (_, index) => small.load(`small-${index}`, fixture.entry.fileDiff, read(ready), signal)));
    expect(loads.every((diff) => diff !== null)).toBe(true);

    const store = new WholeFileDiffs();
    const bigLoads = await Promise.all(['a', 'b', 'c', 'd'].map((key) => store.load(key, fixture.entry.fileDiff, read(big), signal)));
    expect(bigLoads.map((diff) => diff !== null)).toEqual([true, true, true, false]);
    // The last was refused only because the others hold what is left: it is not remembered as unreadable.
    expect(store.kept('d', fixture.entry.fileDiff)).toBeUndefined();
  });

  it('does not record a read that failed, so the file is read again when it unfolds again', async () => {
    const store = new WholeFileDiffs();
    const signal = new AbortController().signal;
    await expect(store.load('a', fixture.entry.fileDiff, async () => { throw new Error('offline'); }, signal)).rejects.toThrow('offline');
    expect(store.kept('a', fixture.entry.fileDiff)).toBeUndefined();
  });
});
