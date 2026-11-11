/** The commit that last changed one or more lines of a blamed file. */
export interface LineBlameCommit {
  /** Full object id, or forty zeros for lines that are not committed yet. */
  oid: string;
  /** True for lines that differ from HEAD: uncommitted or unsaved edits. */
  uncommitted: boolean;
  authorName: string;
  authorEmail: string;
  /** Author date as an ISO 8601 string. */
  authoredAt: string;
  /** The commit's subject line. */
  summary: string;
}

/** Who last changed one line. `commit` indexes `LineBlameResult.commits`. */
export interface LineBlameLine {
  commit: number;
  /** One-based line number in that commit's version of the file. */
  originalLine: number;
}

export type LineBlameResult =
  /** `lines[i]` describes line `i + 1` of the blamed text. */
  | { status: 'ready'; commits: LineBlameCommit[]; lines: LineBlameLine[] }
  /** Not in HEAD yet: untracked, only staged, or a repository without commits. */
  | { status: 'untracked' }
  | { status: 'binary' }
  | { status: 'too-large'; limitBytes: number };

/** Larger files are not blamed: Git's cost grows with both size and history. */
export const LINE_BLAME_MAX_BYTES = 1024 * 1024;

export const UNCOMMITTED_OID = '0'.repeat(40);
