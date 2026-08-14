import type { BranchInfo } from '../../shared/git-types';

/**
 * NUL-delimited so subjects and author names keep spaces, quotes and Unicode
 * verbatim. Every field ends with `%00`, and Git separates records with a
 * newline that the parser trims off the next `%(refname)`.
 */
export const REF_FORMAT = '%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(worktreepath)%00%(objectname)%00%(objectname:short)%00%(subject)%00%(authorname)%00%(committerdate:iso-strict)%00';

const FIELDS_PER_REF = 11;

export function parseRefs(buffer: Buffer): BranchInfo[] {
  const values = buffer.toString('utf8').split('\0');
  const result: BranchInfo[] = [];
  for (let index = 0; index + FIELDS_PER_REF - 1 < values.length; index += FIELDS_PER_REF) {
    const fullName = (values[index] ?? '').trimStart();
    if (!fullName) continue;
    const track = values[index + 4] ?? '';
    const ahead = /ahead (\d+)/.exec(track)?.[1];
    const behind = /behind (\d+)/.exec(track)?.[1];
    result.push({
      fullName,
      name: values[index + 1] ?? fullName,
      current: (values[index + 2] ?? '').trim() === '*',
      remote: fullName.startsWith('refs/remotes/'),
      upstream: values[index + 3] || null,
      ahead: Number(ahead ?? 0),
      behind: Number(behind ?? 0),
      worktreePath: values[index + 5] || null,
      oid: values[index + 6] ?? '',
      shortOid: values[index + 7] ?? '',
      subject: values[index + 8] ?? '',
      author: values[index + 9] ?? '',
      date: values[index + 10] ?? '',
    });
  }
  return result;
}
