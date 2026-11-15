import type { ChangeKind } from '../../shared/git-types';

const FIELD = '\x1f';
const RECORD = '\x1e';
const STATUS_KINDS: Record<string, ChangeKind> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed', U: 'conflicted',
};

/** Only each commit's hash: `-z` ends it with a NUL, and the commit's `--raw` and `--numstat` entries follow. */
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

/** A commit the walk listed, and what it did to the file; null when it changed only other paths. */
export interface FileHistoryRecord {
  oid: string;
  change: FileHistoryChange | null;
}

interface RawEntry { kind: ChangeKind | null; path: string; oldPath: string | null }
interface StatEntry { path: string; additions: number; deletions: number; binary: boolean }

/**
 * Reads `git log --follow --raw --numstat -z --format=FILE_HISTORY_WALK_FORMAT -- <path>` by its
 * structure: each commit's hash, then its `--raw` entries, each followed by one path, or two for a
 * rename or copy, then as many `--numstat` entries. Paths are taken by their place, never searched,
 * so nothing in a file name can look like another commit.
 *
 * Each commit's change is the one of the file being followed: `path`, then, going back past a
 * rename or a copy, the name it had before. A commit whose entries are all of other paths, as when
 * the path was a folder, changed nothing of the file. A merge, which lists no change of its own,
 * keeps the name of the commit after it.
 */
export function parseFileHistoryWalk(output: string, path: string): FileHistoryRecord[] {
  const tokens = output.split('\0');
  const records: FileHistoryRecord[] = [];
  let currentPath = path;
  let at = 0;
  // Structural tokens may start with the newline Git writes before a commit's entries; paths are kept as they are.
  const structural = (index: number) => (tokens[index] ?? '').replace(/^\n+/, '');
  while (at < tokens.length) {
    const header = structural(at);
    if (header === '' && at === tokens.length - 1) break;
    const match = new RegExp(`^${RECORD}([0-9a-f]{40,64})${FIELD}$`, 'i').exec(header);
    if (!match) throw new Error('Git listed a file history OpenTig could not read.');
    at++;
    const raw: RawEntry[] = [];
    while (at < tokens.length && structural(at).startsWith(':')) {
      const status = structural(at).split(' ').at(-1) ?? '';
      const pair = /^[RC]\d*$/.test(status);
      const first = tokens[at + 1];
      const second = pair ? tokens[at + 2] : undefined;
      if (first === undefined || (pair && second === undefined)) throw new Error('Git listed a file history OpenTig could not read.');
      raw.push({ kind: STATUS_KINDS[status[0] ?? ''] ?? null, path: pair ? second! : first, oldPath: pair ? first : null });
      at += pair ? 3 : 2;
    }
    const stats: StatEntry[] = [];
    while (stats.length < raw.length && at < tokens.length) {
      const stat = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(structural(at));
      if (!stat) break;
      const binary = stat[1] === '-' || stat[2] === '-';
      const counts = { additions: stat[1] === '-' ? 0 : Number(stat[1]), deletions: stat[2] === '-' ? 0 : Number(stat[2]), binary };
      // A rename's numstat names both paths in the next two tokens.
      if (stat[3] === '') {
        stats.push({ path: tokens[at + 2] ?? '', ...counts });
        at += 3;
      } else {
        stats.push({ path: stat[3]!, ...counts });
        at += 1;
      }
    }
    const oid = match[1]!;
    if (!raw.length) {
      records.push({ oid, change: { oid, path: currentPath, oldPath: null, kind: null, additions: 0, deletions: 0, binary: false } });
      continue;
    }
    const entry = raw.find((item) => item.path === currentPath);
    if (!entry) {
      records.push({ oid, change: null });
      continue;
    }
    const stat = stats.find((item) => item.path === entry.path);
    records.push({ oid, change: { oid, path: entry.path, oldPath: entry.oldPath, kind: entry.kind, additions: stat?.additions ?? 0, deletions: stat?.deletions ?? 0, binary: stat?.binary ?? false } });
    // Older commits knew the file by the name it had before a rename or a copy.
    currentPath = entry.oldPath ?? entry.path;
  }
  return records;
}
