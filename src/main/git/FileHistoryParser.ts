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

/** How long the parse runs before letting the server's other work through. */
const SLICE_MS = 8;

/** The NUL-ended tokens of Git's output, read as they are needed rather than all at once. */
class Tokens {
  private position = 0;
  private readonly ahead: string[] = [];

  /** `complete` is false when the output was cut short: its last token may be part of one. */
  constructor(private readonly text: string, private readonly complete: boolean) {}

  peek(offset = 0): string | undefined {
    while (this.ahead.length <= offset) {
      if (this.position > this.text.length) return undefined;
      const end = this.text.indexOf('\0', this.position);
      if (end < 0) {
        const rest = this.text.slice(this.position);
        this.position = this.text.length + 1;
        if (!this.complete) return undefined;
        this.ahead.push(rest);
      } else {
        this.ahead.push(this.text.slice(this.position, end));
        this.position = end + 1;
      }
    }
    return this.ahead[offset];
  }

  take(count: number): void {
    this.ahead.splice(0, count);
  }
}

export interface FileHistoryWalk {
  records: FileHistoryRecord[];
  /** The commit that created the file under the name followed was reached: nothing older is its history. */
  ended: boolean;
  /** The output was cut short: the commits after the last one read are unknown. */
  cut: boolean;
}

/**
 * Reads `git log --follow --raw --numstat -z --format=FILE_HISTORY_WALK_FORMAT -- <path>` by its
 * structure: each commit's hash, then its `--raw` entries, each followed by one path, or two for a
 * rename or copy, then as many `--numstat` entries. Paths are taken by their place, never searched,
 * so nothing in a file name can look like another commit.
 *
 * Each commit's change is the one of the file being followed: `path`, then, going back past a
 * rename or a copy, the name it had before. A commit whose entries are all of other paths changed
 * nothing of the file. A merge, which lists no change of its own, keeps the name of the commit
 * after it. The file's history ends at the commit that created it under the name followed: what
 * Git lists past it, such as the history of a folder the path once was, is not read.
 *
 * `truncated` says the output was cut at a size limit: its last, partial commit is dropped and the
 * walk is marked `cut`. The parse yields to the server's other work every `SLICE_MS`.
 */
export async function parseFileHistoryWalk(output: string, path: string, options: { truncated?: boolean; signal?: AbortSignal } = {}): Promise<FileHistoryWalk> {
  const tokens = new Tokens(output, !options.truncated);
  const records: FileHistoryRecord[] = [];
  let currentPath = path;
  let sliceStart = performance.now();
  const unreadable = () => new Error('Git listed a file history OpenTig could not read.');
  // Structural tokens may start with the newline Git writes before a commit's entries; paths are kept as they are.
  const structural = (offset: number) => tokens.peek(offset)?.replace(/^\n+/, '');
  for (;;) {
    if (performance.now() - sliceStart > SLICE_MS) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('The history is no longer needed.');
      sliceStart = performance.now();
    }
    const header = structural(0);
    if (header === undefined || (header === '' && tokens.peek(1) === undefined)) return { records, ended: false, cut: Boolean(options.truncated) };
    const match = new RegExp(`^${RECORD}([0-9a-f]{40,64})${FIELD}$`, 'i').exec(header);
    if (!match) throw unreadable();
    // A commit is read whole before it counts: one the output cut short is dropped.
    let at = 1;
    const raw: RawEntry[] = [];
    let incomplete = false;
    while (structural(at)?.startsWith(':')) {
      const status = structural(at)!.split(' ').at(-1) ?? '';
      const pair = /^[RC]\d*$/.test(status);
      const first = tokens.peek(at + 1);
      const second = pair ? tokens.peek(at + 2) : undefined;
      if (first === undefined || (pair && second === undefined)) { incomplete = true; break; }
      raw.push({ kind: STATUS_KINDS[status[0] ?? ''] ?? null, path: pair ? second! : first, oldPath: pair ? first : null });
      at += pair ? 3 : 2;
    }
    const stats: StatEntry[] = [];
    while (!incomplete && stats.length < raw.length) {
      const token = structural(at);
      if (token === undefined) { incomplete = true; break; }
      const stat = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(token);
      if (!stat) break;
      const binary = stat[1] === '-' || stat[2] === '-';
      const counts = { additions: stat[1] === '-' ? 0 : Number(stat[1]), deletions: stat[2] === '-' ? 0 : Number(stat[2]), binary };
      // A rename's numstat names both paths in the next two tokens.
      if (stat[3] === '') {
        const renamed = tokens.peek(at + 2);
        if (renamed === undefined) { incomplete = true; break; }
        stats.push({ path: renamed, ...counts });
        at += 3;
      } else {
        stats.push({ path: stat[3]!, ...counts });
        at += 1;
      }
    }
    if (incomplete || (options.truncated && tokens.peek(at) === undefined)) {
      if (!options.truncated) throw unreadable();
      return { records, ended: false, cut: true };
    }
    tokens.take(at);
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
    if (entry.kind === 'added') return { records, ended: true, cut: false };
    // Older commits knew the file by the name it had before a rename or a copy.
    currentPath = entry.oldPath ?? entry.path;
  }
}
