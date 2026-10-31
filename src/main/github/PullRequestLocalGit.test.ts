import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitProcess } from '../git/GitProcess';
import { git, repositoryWithUpstream } from '../git/test-support/repository-fixtures';
import { OPEN_TIG_MAX_SERVER_MESSAGE_BYTES } from '../../shared/server-protocol';
import { PullRequestLocalGit, diffResult } from './PullRequestLocalGit';

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** Publishes a PR head only as GitHub does: under refs/pull/<n>/head on the remote. */
async function remotePullRequest(fixture: { root: string; remote: string }, files: number) {
  const author = path.join(fixture.root, 'pr-author');
  await git(fixture.root, ['clone', '-q', fixture.remote, author]);
  await git(author, ['config', 'user.name', 'Contributor']);
  await git(author, ['config', 'user.email', 'contributor@example.com']);
  const base = await git(author, ['rev-parse', 'HEAD']);
  await git(author, ['switch', '-q', '-c', 'feature']);
  await mkdir(path.join(author, 'many'));
  for (let index = 0; index < files; index++) await writeFile(path.join(author, 'many', `file-${index}.txt`), `${index}\n`);
  await git(author, ['add', '.']);
  await git(author, ['commit', '-q', '-m', 'Add many files']);
  await writeFile(path.join(author, 'committed.txt'), 'changed\n');
  await git(author, ['commit', '-q', '-am', 'Change committed file']);
  const head = await git(author, ['rev-parse', 'HEAD']);
  await git(author, ['push', '-q', 'origin', `HEAD:refs/pull/7/head`]);
  return { baseOid: base, headOid: head, number: 7 };
}

describe('PullRequestLocalGit', () => {
  it('downloads a PR head that no branch references and diffs every file without moving refs', async () => {
    const fixture = await repositoryWithUpstream();
    const range = await remotePullRequest(fixture, 320);
    const local = new PullRequestLocalGit(new GitProcess());
    const refsBefore = await git(fixture.work, ['for-each-ref']);

    expect(await local.ensureRange(fixture.work, 'origin', range)).toBe(true);
    expect(await git(fixture.work, ['for-each-ref'])).toBe(refsBefore);

    const diff = await local.rangeDiff(fixture.work, range);
    expect(diff.truncated).toBe(false);
    expect(diff.patch.match(/^diff --git /gm)).toHaveLength(321);
    expect(diff.patch).toContain('-base\n+changed\n');

    const commits = await local.commits(fixture.work, range);
    expect(commits.map(commit => commit.messageHeadline)).toEqual(['Add many files', 'Change committed file']);
    expect(commits[1]).toMatchObject({ oid: range.headOid, author: 'Contributor', authorAvatarUrl: null });

    const commit = await local.commitDiff(fixture.work, range.headOid);
    expect(commit?.patch.match(/^diff --git /gm)).toHaveLength(1);
  });

  it('also downloads a base that moved after the PR branched, comparing from their merge base', async () => {
    const fixture = await repositoryWithUpstream();
    const range = await remotePullRequest(fixture, 1);
    const author = path.join(fixture.root, 'pr-author');
    await git(author, ['switch', '-q', 'main']);
    await writeFile(path.join(author, 'base-only.txt'), 'base moved\n');
    await git(author, ['add', '.']);
    await git(author, ['commit', '-q', '-m', 'Move base']);
    await git(author, ['push', '-q', 'origin', 'main']);
    const moved = { ...range, baseOid: await git(author, ['rev-parse', 'HEAD']) };
    const local = new PullRequestLocalGit(new GitProcess());

    expect(await local.ensureRange(fixture.work, 'origin', moved)).toBe(true);
    const diff = await local.rangeDiff(fixture.work, moved);
    expect(diff.patch).not.toContain('base-only.txt');
    expect(diff.patch.match(/^diff --git /gm)).toHaveLength(2);
  });

  it('keeps a diff above the transport limit to complete files that fit one response', async () => {
    const fixture = await repositoryWithUpstream();
    const baseOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await mkdir(path.join(fixture.work, 'large'));
    const content = `${'x'.repeat(100)}\n`.repeat(60);
    for (let index = 0; index < 731; index++) await writeFile(path.join(fixture.work, 'large', `file-${index}.txt`), content);
    await git(fixture.work, ['add', '.']);
    await git(fixture.work, ['commit', '-q', '-m', 'Add a large change']);
    const headOid = await git(fixture.work, ['rev-parse', 'HEAD']);

    const diff = await new PullRequestLocalGit(new GitProcess()).rangeDiff(fixture.work, { number: 7, baseOid, headOid });

    expect(diff.truncated).toBe(true);
    expect(jsonBytes(diff)).toBeLessThan(OPEN_TIG_MAX_SERVER_MESSAGE_BYTES);
    const sections = diff.patch.split(/^diff --git /m).slice(1);
    expect(sections.length).toBeGreaterThan(100);
    expect(sections.length).toBeLessThan(731);
    for (const section of sections) expect(section.trimEnd().endsWith('x')).toBe(true);
  });

  it('accounts for escaping when deciding what fits', () => {
    const small = 'diff --git a/one b/one\nsmall\n';
    // Three million quotes are under the limit as text and over it once escaped.
    const escaped = `diff --git a/two b/two\n${'"'.repeat(3_000_000)}\n`;
    expect(diffResult('pull/7', small + escaped, false)).toMatchObject({ truncated: true, patch: small });
    expect(diffResult('pull/7', escaped, false)).toMatchObject({ truncated: true, patch: '' });
  });

  it('does not let one huge file hide the files after it', () => {
    const huge = `diff --git a/bundle b/bundle\n${'x'.repeat(5_000_000)}\n`;
    const small = 'diff --git a/one b/one\nsmall\n';
    expect(diffResult('pull/7', huge + small, false)).toMatchObject({ truncated: true, patch: small });
  });

  it('leaves a diff within the limit untouched', () => {
    const patch = 'diff --git a/one b/one\n+"quoted"\n';
    expect(diffResult('pull/7', patch, false)).toEqual({ patch, path: 'pull/7', binary: false, truncated: false, lineCount: 3 });
  });

  it('says why downloading the commits failed', async () => {
    const fixture = await repositoryWithUpstream();
    const failures: string[] = [];
    const range = { number: 99, baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40) };
    expect(await new PullRequestLocalGit(new GitProcess()).ensureRange(fixture.work, 'origin', range, (message) => failures.push(message))).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeTruthy();
  });

  it('reports unavailable commits instead of failing so GitHub can be used', async () => {
    const fixture = await repositoryWithUpstream();
    const local = new PullRequestLocalGit(new GitProcess());
    const range = { number: 99, baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40) };
    expect(await local.ensureRange(fixture.work, 'origin', range)).toBe(false);
    expect(await local.ensureRange(fixture.work, 'origin', { ...range, headOid: 'not-an-oid' })).toBe(false);
    expect(await local.commitDiff(fixture.work, 'c'.repeat(40))).toBeNull();
  });
});
