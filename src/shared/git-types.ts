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
  /** Reachability from the locally known default branch; no network fetch. */
  baseState?: 'included' | 'outside' | 'unknown';
}

export interface CommitPage {
  commits: CommitInfo[];
  nextCursor: string | null;
  baseRef?: string | null;
}

/** A commit that changed one file, with how it changed it. */
export interface FileHistoryEntry {
  commit: CommitInfo;
  /** The file's path in this commit: its name then, which a later rename may have changed. */
  path: string;
  /** The name it had before, for the commit that renamed or copied it. */
  oldPath: string | null;
  /** How the commit changed it; null for a merge, which lists no change of its own. */
  kind: ChangeKind | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** A page of the commits that changed a file, newest first, following its renames. */
export interface FileHistoryPage {
  path: string;
  entries: FileHistoryEntry[];
  /** Opaque: where the next page starts. */
  nextCursor: string | null;
  /** The file has more commits than OpenTig lists; the rest are older than the last one listed. */
  limited: boolean;
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
  /** Configured remote and source branch, present in the manager snapshot. */
  remoteName?: string;
  remoteBranchName?: string;
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

/** Coding agents found working in a worktree, by display name. */
export interface WorktreeAgents {
  path: string;
  agents: string[];
}

/**
 * A linked worktree whose folder is still there, but whose `.git` no longer leads back to
 * this repository's entry for it. Git still lists it as usable, yet can neither use nor remove it.
 */
export type BrokenWorktreeLink =
  /**
   * Its `.git` file names a place that is gone, typically because the repository was moved,
   * or names none in Git's format. Repair link can reconnect it.
   */
  | {
    kind: 'unlinked';
    /** The folder its `.git` file names, as written there, or null when it names none. */
    pointsTo: string | null;
    /** That folder is on another drive than this repository, which may only be disconnected. */
    otherDrive?: boolean;
  }
  /**
   * Its `.git` leads to a place that exists and isn't this repository's entry for it: another
   * repository's worktree record (`worktree`, `owner` being that repository's Git folder), a
   * Git folder of its own such as a submodule's or a separate one (`repository`), or anything
   * else (`other`). Only this repository's entry is left over.
   */
  | { kind: 'taken'; by: 'worktree' | 'repository' | 'other'; owner: string };

/** A worktree row annotated with whether OpenTig currently has it open. */
export interface ManagedWorktree extends WorktreeInfo {
  current: boolean;
  /** Git lost track of this worktree, but its folder is still on disk. */
  leftoverFiles?: boolean;
  brokenLink?: BrokenWorktreeLink;
}

/**
 * Cheap enumeration for the refs manager: local and remote branches plus every
 * worktree of the repository. Deliberately runs no per-worktree status scan.
 */
export interface LocalRefsSnapshot {
  branches: BranchInfo[];
  worktrees: ManagedWorktree[];
  remotes: string[];
  /** Removals still running, and recent ones that failed or left something for the user to do. */
  worktreeRemovals?: WorktreeRemovalState[];
}

export interface WorktreeRemovalState {
  path: string;
  state: 'running' | 'partial' | 'failed';
  /** What happened, for whoever wasn't waiting when the removal ended. */
  message: string | null;
  finishedAt: string | null;
}

export interface RemoteBranchDetails extends CommitSummary {
  fullName: string;
  name: string;
  remote: string;
  branchName: string;
  localBranches: Array<{ name: string; fullName: string; worktreePath: string | null }>;
  defaultBranch: string | null;
  remoteState: 'current' | 'changed' | 'missing' | 'unchecked';
  /** Hash of the resolved destination and source ref; never exposes remote URLs. */
  destinationId: string;
  deletionBlockedReason: string | null;
}

export type RemoteBranchDeletionResult =
  | { status: 'deleted' }
  | { status: 'stale' | 'missing' | 'default' | 'destination-changed' }
  | { status: 'rejected'; message: string };

export type TrackingBranchCreationResult =
  | { status: 'created'; fullName: string }
  | { status: 'stale' | 'missing' | 'exists' };

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
  /** Git lost track of this worktree, but its folder is still on disk. */
  leftoverFiles?: boolean;
  /** It has initialized submodules, which Git removes only with force. */
  submodules?: boolean;
  /** Its link to the repository is broken, so no Git command ran inside it. */
  brokenLink?: BrokenWorktreeLink;
  /** Only with a broken link: the folder holds nothing but its `.git` file and empty folders. */
  onlyGitFile?: boolean;
  /**
   * Only with a broken link: cleaning up its entry loses nothing. The folder holds only its
   * `.git` file, HEAD is on a branch or tag, nothing is staged, and no operation is under way.
   */
  nothingLost?: boolean;
  /** Only with a broken link: its HEAD is a commit on no branch or tag, which cleaning up its entry leaves unreachable. */
  unreachableHead?: CommitSummary;
  /**
   * Git could not read its local changes, and why. Here and with a broken link, `conflictCount`
   * is 1 and the other counts 0, so a client that knows neither field never takes the worktree
   * for clean; a client that does reads these fields first.
   */
  unreadable?: string;
  /** False when the worktree is missing, prunable, bare, or its link is broken, so no status ran. */
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
  /** It has initialized submodules, which only a forced removal deletes. */
  | { status: 'submodules' }
  | { status: 'prunable'; reason: string }
  /** Its `.git` file doesn't lead back to this repository, so Git refuses even a forced removal. */
  | { status: 'broken-link' }
  /** Git could not read its local changes, so only a forced removal may delete them. */
  | { status: 'unreadable'; reason: string }
  | { status: 'bare' }
  | { status: 'missing' }
  /** The request ended before Git started, so nothing changed. */
  | { status: 'cancelled' };
