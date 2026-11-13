import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LineBlameResult } from '../../shared/line-blame';
import { LINE_BLAME_MAX_BYTES } from '../../shared/line-blame';
import { git, standaloneRepository } from './test-support/repository-fixtures';

async function commitAs(work: string, author: string, date: string, message: string) {
  const email = `${author.split(' ')[0]!.toLowerCase()}@example.com`;
  await git(work, ['add', '.']);
  await git(work, ['-c', `user.name=${author}`, '-c', `user.email=${email}`, 'commit', '-m', message, '--date', date]);
}

function describeLines(result: LineBlameResult) {
  if (result.status !== 'ready') throw new Error(`Expected blame, got ${result.status}`);
  return result.lines.map((line) => {
    const commit = result.commits[line.commit]!;
    return commit.uncommitted ? 'uncommitted' : `${commit.authorName}: ${commit.summary}`;
  });
}

describe('GitRepositoryOperations line blame', () => {
  it('attributes saved lines and unsaved draft lines to the commits that last changed them', async () => {
    const fixture = await standaloneRepository();
    await mkdir(path.join(fixture.work, 'src'));
    const file = path.join(fixture.work, 'src', 'totals.ts');
    await writeFile(file, 'export function total(items) {\n  let sum = 0;\n  return sum;\n}\n');
    await commitAs(fixture.work, 'Ada Lovelace', '2026-01-02T10:00:00Z', 'Add totals');
    await writeFile(file, 'export function total(items) {\n  let sum = 0;\n  return Math.round(sum);\n}\n');
    await commitAs(fixture.work, 'Grace Hopper', '2026-05-01T09:30:00Z', 'Fix rounding in totals');

    const saved = await fixture.operations.lineBlame(fixture.repositoryId, 'src/totals.ts');
    expect(describeLines(saved)).toEqual([
      'Ada Lovelace: Add totals',
      'Ada Lovelace: Add totals',
      'Grace Hopper: Fix rounding in totals',
      'Ada Lovelace: Add totals',
    ]);
    if (saved.status !== 'ready') throw new Error('unreachable');
    const grace = saved.commits[saved.lines[2]!.commit]!;
    expect(grace).toMatchObject({ authorEmail: 'grace@example.com', authoredAt: '2026-05-01T09:30:00.000Z' });
    // A blamed commit opens in the commit viewer without being listed first.
    await expect(fixture.operations.commitFiles(fixture.repositoryId, grace.oid)).resolves.toMatchObject([{ path: 'src/totals.ts' }]);

    // An edit on disk and an unsaved line added in the editor are both not committed.
    await writeFile(file, '// totals\nexport function total(items) {\n  let sum = 0;\n  return Math.round(sum);\n}\n');
    const draft = '// totals\nexport function total(items) {\n  let sum = 0;\n  for (const item of items) sum += item;\n  return Math.round(sum);\n}\n';
    expect(describeLines(await fixture.operations.lineBlame(fixture.repositoryId, 'src/totals.ts', draft))).toEqual([
      'uncommitted',
      'Ada Lovelace: Add totals',
      'Ada Lovelace: Add totals',
      'uncommitted',
      'Grace Hopper: Fix rounding in totals',
      'Ada Lovelace: Add totals',
    ]);
  });

  it('reuses a cached blame until HEAD or the text changes', async () => {
    const fixture = await standaloneRepository();
    const run = vi.spyOn(fixture.gitProcess, 'run');
    const blames = () => run.mock.calls.filter(([, args]) => args.includes('blame')).length;
    await fixture.operations.lineBlame(fixture.repositoryId, 'file.txt');
    await fixture.operations.lineBlame(fixture.repositoryId, 'file.txt');
    expect(blames()).toBe(1);
    await fixture.operations.lineBlame(fixture.repositoryId, 'file.txt', 'content\nmore\n');
    expect(blames()).toBe(2);
    await writeFile(path.join(fixture.work, 'file.txt'), 'changed\n');
    await commitAs(fixture.work, 'Ada Lovelace', '2026-02-01T00:00:00Z', 'Change file');
    expect(describeLines(await fixture.operations.lineBlame(fixture.repositoryId, 'file.txt'))).toEqual(['Ada Lovelace: Change file']);
    expect(blames()).toBe(3);
  });

  it('skips untracked, staged-only, binary, and oversized files', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'new.txt'), 'new\n');
    expect(await fixture.operations.lineBlame(fixture.repositoryId, 'new.txt')).toEqual({ status: 'untracked' });
    await git(fixture.work, ['add', 'new.txt']);
    expect(await fixture.operations.lineBlame(fixture.repositoryId, 'new.txt')).toEqual({ status: 'untracked' });
    await writeFile(path.join(fixture.work, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    await commitAs(fixture.work, 'Ada Lovelace', '2026-02-01T00:00:00Z', 'Add binary');
    expect(await fixture.operations.lineBlame(fixture.repositoryId, 'image.bin')).toEqual({ status: 'binary' });
    expect(await fixture.operations.lineBlame(fixture.repositoryId, 'file.txt', 'x'.repeat(LINE_BLAME_MAX_BYTES + 1)))
      .toEqual({ status: 'too-large', limitBytes: LINE_BLAME_MAX_BYTES });
    await expect(fixture.operations.lineBlame(fixture.repositoryId, '../outside.txt')).rejects.toThrow(/outside the worktree/);
  });
});
