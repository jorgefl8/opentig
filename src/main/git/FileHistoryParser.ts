import type { ChangeKind } from '../../shared/git-types';

const FIELD = '\x1f';
const RECORD = '\x1e';
const STATUS_KINDS: Record<string, ChangeKind> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed', U: 'conflicted',
};

/** Only each commit's hash: `-z` ends it with a NUL, and the file's `--raw` and `--numstat` entries follow. */
export const FILE_HISTORY_WALK_FORMAT = `${RECORD}%H${FIELD}`;

export interface FileHistoryChange {
  oid: string;
  path: string;
  oldPath: string | null;
  kind: ChangeKind | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Reads `git log --follow --raw --numstat -z --format=FILE_HISTORY_WALK_FORMAT -- <path>`: each commit
 * with the path the file had in it. Going back past a rename, the file has its older name; a merge,
 * which lists no change of its own, keeps the name of the commit after it.
 */
export function parseFileHistoryWalk(output: string, path: string): FileHistoryChange[] {
  const changes: FileHistoryChange[] = [];
  let currentPath = path;
  for (const record of output.split(new RegExp(`${RECORD}(?=[0-9a-f]{40,64}${FIELD})`))) {
    const separator = record.indexOf(FIELD);
    const oid = separator < 0 ? '' : record.slice(0, separator);
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) continue;
    const change = parseChange(record.slice(separator + 1).split('\0').map((token) => token.replace(/^\n+/, '')));
    const entryPath = change.path ?? currentPath;
    changes.push({ oid, path: entryPath, oldPath: change.oldPath, kind: change.kind, additions: change.additions, deletions: change.deletions, binary: change.binary });
    // Older commits knew the file by the name it had before a rename or a copy.
    currentPath = change.oldPath ?? entryPath;
  }
  return changes;
}

function parseChange(tokens: string[]): Omit<FileHistoryChange, 'oid' | 'path'> & { path: string | null } {
  const change = { path: null as string | null, oldPath: null as string | null, kind: null as ChangeKind | null, additions: 0, deletions: 0, binary: false };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token) continue;
    if (token.startsWith(':')) {
      // `:<modes> <oids> <status>`, then the path, or the old and new paths of a rename or copy.
      const status = token.split(' ').at(-1) ?? '';
      const pair = /^[RC]\d*$/.test(status);
      if (change.kind === null) {
        change.kind = STATUS_KINDS[status[0] ?? ''] ?? null;
        change.oldPath = pair ? tokens[index + 1] ?? null : null;
        change.path = (pair ? tokens[index + 2] : tokens[index + 1]) ?? null;
      }
      index += pair ? 2 : 1;
      continue;
    }
    const stat = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(token);
    if (!stat) continue;
    change.binary = stat[1] === '-' || stat[2] === '-';
    change.additions = stat[1] === '-' ? 0 : Number(stat[1]);
    change.deletions = stat[2] === '-' ? 0 : Number(stat[2]);
    // A rename's numstat names both paths in the next two tokens.
    if (!stat[3]) index += 2;
  }
  return change;
}
