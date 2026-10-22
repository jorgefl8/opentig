import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitProcess } from '../git/GitProcess';
import { git, repositoryWithUpstream } from '../git/test-support/repository-fixtures';
import { PullRequestLocalGit } from './PullRequestLocalGit';

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

  it('reports unavailable commits instead of failing so GitHub can be used', async () => {
    const fixture = await repositoryWithUpstream();
    const local = new PullRequestLocalGit(new GitProcess());
    const range = { number: 99, baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40) };
    expect(await local.ensureRange(fixture.work, 'origin', range)).toBe(false);
    expect(await local.ensureRange(fixture.work, 'origin', { ...range, headOid: 'not-an-oid' })).toBe(false);
    expect(await local.commitDiff(fixture.work, 'c'.repeat(40))).toBeNull();
  });
});
