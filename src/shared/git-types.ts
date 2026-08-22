export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'type-changed';

export interface FileChange {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: ChangeKind;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
  submodule: string;
}

export interface RepositoryStatus {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  insertions: number;
  deletions: number;
  detached: boolean;
  unborn: boolean;
  operation: string | null;
  readOnly: boolean;
  changes: FileChange[];
  stagedCount: number;
  unstagedCount: number;
}

export type FileTreeEntry =
  | {
    path: string;
    name: string;
    type: 'file';
    ignored?: boolean;
    size: number;
    mtimeMs: number;
  }
  | {
    path: string;
    name: string;
    type: 'directory';
    ignored?: boolean;
    children: FileTreeEntry[];
  };

export type CommitUpstreamState = 'published' | 'local-only' | 'unknown';

export interface CommitInfo {
  oid: string;
  shortOid: string;
  subject: string;
  body: string;
  author: string;
  email: string;
  date: string;
  decorations: string[];
  parentOids: string[];
  parentCount: number;
  upstreamState: CommitUpstreamState;
  isHead: boolean;
}

export interface CommitPage {
  commits: CommitInfo[];
  nextCursor: string | null;
}

export interface CommitFile {
  path: string;
  oldPath: string | null;
  kind: ChangeKind;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface BranchInfo {
  name: string;
  fullName: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  worktreePath: string | null;
  oid: string;
  shortOid: string;
  subject: string;
  author: string;
  /** Committer date of the branch tip in strict ISO 8601, or '' when Git omits it. */
  date: string;
}

export interface WorktreeInfo {
  path: string;
  oid: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: string | null;
  prunable: string | null;
  /** Git always lists the main worktree first; linked worktrees follow. */
  main: boolean;
}

/** A worktree row annotated with whether OpenTig currently has it open. */
export interface ManagedWorktree extends WorktreeInfo {
  current: boolean;
}

/**
 * Cheap enumeration for the local refs manager: local branches plus every
 * worktree of the repository. Deliberately runs no per-worktree status scan.
 */
export interface LocalRefsSnapshot {
  branches: BranchInfo[];
  worktrees: ManagedWorktree[];
}

/**
 * Why a local branch can or cannot be deleted with Git's non-forced path.
 * `unknown` means the promised comparison ref did not resolve locally, so
 * OpenTig refuses to guess instead of offering deletion.
 */
export type BranchDeletionState = 'safe' | 'current' | 'checked-out' | 'unmerged' | 'unknown';

/** Which ref the merged check compared the branch against. */
export type BranchComparisonKind = 'upstream' | 'head' | 'none';

export interface CommitSummary {
  oid: string;
  shortOid: string;
  subject: string;
  author: string;
  date: string;
}

export interface BranchDetails {
  fullName: string;
  name: string;
  oid: string;
  shortOid: string;
  subject: string;
  author: string;
  date: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Set when another worktree has this branch checked out. */
  worktreePath: string | null;
  deletion: BranchDeletionState;
  comparisonKind: BranchComparisonKind;
  /** Display label of the ref the merged check used, e.g. `origin/main`. */
  comparisonBase: string | null;
  /** Commits reachable from the branch but not from the comparison base. */
  uniqueCommits: number;
}

export interface WorktreeDetails {
  path: string;
  oid: string;
  branch: string | null;
  main: boolean;
  current: boolean;
  detached: boolean;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
  /** False when the worktree is missing, prunable, or bare, so no status ran. */
  available: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  operation: string | null;
  readOnly: boolean;
  lastCommit: CommitSummary | null;
}

export type BranchDeletionResult =
  | { status: 'deleted'; fullName: string; name: string; oid: string }
  /** The branch moved between the renderer's snapshot and the write lock. */
  | { status: 'stale' }
  | { status: 'current' }
  | { status: 'checked-out'; worktreePath: string }
  | { status: 'unmerged'; comparisonBase: string; uniqueCommits: number }
  | { status: 'unknown'; comparisonBase: string | null }
  | { status: 'missing' };

/**
 * Every reason Git's non-forced `worktree remove` is refused. The successful
 * variant lives in `contracts.ts` instead, because it also reports the updated
 * recent-repository list that removing the directory invalidates.
 */
export type WorktreeRemovalBlocked =
  /** The worktree's HEAD moved between the renderer's snapshot and the write lock. */
  | { status: 'stale' }
  | { status: 'main' }
  | { status: 'current' }
  | { status: 'dirty'; stagedCount: number; unstagedCount: number; untrackedCount: number; conflictCount: number; operation: string | null }
  | { status: 'locked'; reason: string }
  | { status: 'prunable'; reason: string }
  | { status: 'bare' }
  | { status: 'missing' };
