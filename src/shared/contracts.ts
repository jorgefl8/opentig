import type { SerializedOperationError } from './errors';
import type { BranchDeletionResult, BranchDetails, BranchInfo, CommitFile, CommitPage, FileTreeEntry, LocalRefsSnapshot, RepositoryStatus, WorktreeDetails, WorktreeInfo, WorktreeRemovalBlocked } from './git-types';
import type { RasterImageMime } from './image-types';
import type { RepositoryChangeScope } from './repository-change';
import type { AiLogEntry } from './ai-log';
import type { FilesTreeState } from './files-tree-state';
import type { OpenFileTab, OpenFilesState } from './open-files-state';
import type { SearchOptions, SearchReplaceRequest, SearchReplaceResult, SearchResult } from './search';
import type { ShortcutOverrides } from './shortcuts';

export interface RepositoryInfo {
  id: string;
  name: string;
  repositoryName: string;
  path: string;
  commonDir: string;
}

export interface RecentRepository {
  id: string;
  name: string;
  repositoryName: string;
  path: string;
  commonDir: string;
  lastOpenedAt: string;
}

export type DiffKind = 'staged' | 'unstaged' | 'commit';

export interface DiffRequest {
  repositoryId: string;
  path: string;
  kind: Exclude<DiffKind, 'commit'>;
}

export interface DiffResult {
  patch: string;
  path: string;
  binary: boolean;
  truncated: boolean;
  lineCount: number;
}

export interface FileResult {
  path: string;
  content: string;
  binary: boolean;
  tooLarge: boolean;
  size: number;
  mtimeMs: number;
}

export type ImageFileResult =
  | {
      status: 'ready';
      path: string;
      mimeType: RasterImageMime;
      data: Uint8Array;
      size: number;
      mtimeMs: number;
    }
  | {
      status: 'too-large';
      path: string;
      mimeType: RasterImageMime;
      size: number;
      mtimeMs: number;
      limit: number;
    }
  | {
      status: 'unsupported';
      path: string;
      size: number;
      mtimeMs: number;
    };

export interface GitResult {
  ok: true;
}

export type DeleteEntryResult = { deleted: true } | { deleted: false };

export interface CopyEntriesResult {
  copied: number;
  paths: string[];
}

export interface CutEntriesResult {
  cut: number;
  paths: string[];
  transferId: string;
}

export type PasteEntriesResult =
  | { status: 'pasted'; source: 'files' | 'image' | 'cut'; created: string[] }
  | { status: 'empty'; created: [] };

export type MoveEntryResult =
  | { status: 'moved'; from: string; to: string }
  | { status: 'noop'; path: string }
  | { status: 'conflict'; path: string };

export interface FileHistoryPathChange { from: string; to: string }

export interface MoveEntriesResult {
  moved: FileHistoryPathChange[];
  conflicts: string[];
}

export interface RepositoryProject {
  id: string;
  name: string;
  repositoryKeys: string[];
}

export interface RepositoryOrganization {
  repositoryProjects: RepositoryProject[];
  recentRepositories: RecentRepository[];
}

export interface FileHistoryState {
  canUndo: boolean;
  undoLabel: string | null;
  canRedo: boolean;
  redoLabel: string | null;
}

export type FileHistoryResult =
  | { status: 'applied'; direction: 'undo' | 'redo'; label: string; pathChanges: FileHistoryPathChange[]; removedPaths: string[]; restoredPaths: string[]; state: FileHistoryState }
  | { status: 'empty'; state: FileHistoryState }
  | { status: 'conflict'; label: string; message: string; state: FileHistoryState }
  | { status: 'system-trash'; label: string; paths: string[]; state: FileHistoryState };

export type RenameEntryResult =
  | { status: 'renamed'; from: string; to: string }
  | { status: 'noop'; path: string }
  | { status: 'conflict'; path: string };

export type CreateEntryResult =
  | { status: 'created'; path: string; kind: 'file' | 'directory' }
  | { status: 'conflict'; path: string };

export interface DeleteEntriesResult {
  deleted: number;
  recovery?: 'undo' | 'system-trash';
}

export type WriteFileResult =
  | { status: 'saved'; path: string; size: number; mtimeMs: number }
  | { status: 'conflict' };

export interface CommitResult extends GitResult {
  oid: string;
}

export type UndoLatestCommitResult =
  | { status: 'success'; undoneOid: string; newHeadOid: string; message: string; stagedCount: number }
  | { status: 'stale-head' }
  | { status: 'no-upstream' }
  | { status: 'not-local' }
  | { status: 'blocked-operation'; operation: string }
  | { status: 'unsupported-merge' }
  | { status: 'unsupported-root' };

export type PullResult =
  | { status: 'success'; commits: number; restoredLocalChanges: boolean; rebased: boolean; localCommits: number }
  | { status: 'up-to-date' }
  | { status: 'blocked-conflicts'; files: string[] }
  | { status: 'blocked-operation'; operation: string }
  | { status: 'no-upstream' }
  | { status: 'diverged'; ahead: number; behind: number }
  | { status: 'rebase-conflict'; files: string[] }
  | { status: 'stash-conflict'; files: string[]; stashOid: string; updated: boolean }
  | { status: 'restore-failed'; stashOid: string; updated: boolean; recoveredChanges: boolean };

export type FetchResult =
  | { status: 'success'; ahead: number; behind: number }
  | { status: 'failed'; message: string };

export type PushResult =
  | { status: 'success'; commits: number }
  | { status: 'up-to-date' }
  | { status: 'blocked-conflicts'; files: string[] }
  | { status: 'blocked-operation'; operation: string }
  | { status: 'no-upstream' }
  | { status: 'diverged'; ahead: number; behind: number }
  | { status: 'rejected'; reason: 'authentication' | 'remote-changed' | 'hook' | 'network' | 'configuration' | 'unknown'; message: string };

export interface BranchDetailsRequest {
  repositoryId: string;
  fullName: string;
}

export interface WorktreeDetailsRequest {
  repositoryId: string;
  path: string;
}

export interface DeleteBranchRequest {
  repositoryId: string;
  fullName: string;
  /** The tip the renderer saw; a moved branch is refused rather than deleted. */
  expectedOid: string;
  /** Explicitly permits deleting a branch whose merge state is unsafe or unknown. */
  force: boolean;
}

export interface RemoveWorktreeRequest {
  repositoryId: string;
  path: string;
  /** The HEAD the renderer saw; a moved worktree is refused rather than removed. */
  expectedOid: string;
  /** Explicitly permits permanent loss of uncommitted work in this worktree. */
  force: boolean;
  /** Also force-deletes the checked-out local branch after removing the worktree. */
  deleteBranch: boolean;
}

/**
 * Removing a worktree deletes its directory and invalidates only that
 * directory's recent entries. Its branch is deleted only by explicit request.
 */
export type WorktreeRemovalResult =
  | { status: 'removed'; path: string; branch: string | null; recentRepositories: RecentRepository[] }
  | WorktreeRemovalBlocked;

export type ThemePreference = 'system' | 'light' | 'dark';
export type DiffViewPreference = 'unified' | 'split';
export type ChangesLayoutPreference = 'tree' | 'list';
export type AiHarnessId = 'codex' | 'claude' | 'opencode';
export type AiAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown';
export type AiAvailability = 'ready' | 'warning' | 'error';

export interface AiModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface AiHarnessStatus {
  id: AiHarnessId;
  label: string;
  availability: AiAvailability;
  installed: boolean;
  authStatus: AiAuthStatus;
  version?: string;
  message?: string;
  models: AiModelOption[];
  checkedAt: string;
}

export interface GenerateCommitMessageInput {
  repositoryId: string;
  harness: AiHarnessId;
  model: string;
  requestId: string;
}

export interface CommitPlanItem {
  subject: string;
  body: string;
  message: string;
  reason: string;
  paths: string[];
  /**
   * Fingerprint of this group's own working-tree contents. It is independent of
   * the index and of HEAD, so committing one group never invalidates the others
   * and every commit in the plan keeps its staleness check.
   */
  fingerprint: string;
}

export interface CommitSplitProposal {
  rationale: string;
  commits: CommitPlanItem[];
}

export interface GeneratedCommitMessage {
  subject: string;
  body: string;
  message: string;
  harness: AiHarnessId;
  model: string;
  contextWasTruncated: boolean;
  proposal: CommitSplitProposal | null;
  /** Why no split could be offered, when that was a system decision. */
  splitBlockedReason: string | null;
}

export interface PrepareCommitGroupInput {
  repositoryId: string;
  paths: string[];
  expectedStagedPaths: string[];
  /** `CommitPlanItem.fingerprint` of the group being prepared. */
  expectedFingerprint: string;
}

export interface GitHubRepositoryInfo {
  isGitHub: boolean;
  nameWithOwner: string | null;
}

export type GhAvailability = 'ready' | 'error';

export interface GhCliStatus {
  installed: boolean;
  availability: GhAvailability;
  authStatus: AiAuthStatus;
  version?: string;
  message?: string;
  checkedAt: string;
}

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type PullRequestCheckState = 'PASSING' | 'FAILING' | 'PENDING' | 'NONE';

export interface PullRequestLabel {
  name: string;
  color: string;
}

export interface PullRequestCommit {
  oid: string;
  messageHeadline: string;
  authoredAt: string;
  author: string;
  authorAvatarUrl: string | null;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: PullRequestState;
  isDraft: boolean;
  author: string;
  authorAvatarUrl: string | null;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  url: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  checksState: PullRequestCheckState;
}

export interface PullRequestDetails extends PullRequestSummary {
  body: string;
  changedFiles: number;
  labels: PullRequestLabel[];
  commits: PullRequestCommit[];
}

export interface CreatePullRequestInput {
  repositoryId: string;
  title: string;
  body: string;
  base: string;
  draft: boolean;
}

export interface CreatePullRequestResult {
  url: string;
  number: number | null;
}

export interface GeneratePullRequestDraftInput {
  repositoryId: string;
  base: string;
  harness: AiHarnessId;
  model: string;
  requestId: string;
}

export interface GeneratedPullRequestDraft {
  title: string;
  body: string;
  harness: AiHarnessId;
  model: string;
  contextWasTruncated: boolean;
}

export interface Preferences {
  theme: ThemePreference;
  diffView: DiffViewPreference;
  changesLayout: ChangesLayoutPreference;
  wrapLines: boolean;
  sidebarWidth: number;
  showDotEnvFiles: boolean;
  uiZoom: number;
  commitMessageHarness: AiHarnessId;
  commitMessageModels: Partial<Record<AiHarnessId, string>>;
  shortcutOverrides: ShortcutOverrides;
  doubleControlShortcutEnabled: boolean;
  /** Seconds between background `git fetch` checks. `0` disables periodic fetch. */
  remoteFetchIntervalSeconds: number;
}

export type OpenTigRuntimeMode = 'desktop' | 'headless';
export type OpenTigPlatform = 'win32' | 'darwin' | 'linux' | 'other';

/** Serializable runtime and host capabilities exposed by the server boundary. */
export interface OpenTigCapabilities {
  runtimeMode: OpenTigRuntimeMode;
  platform: OpenTigPlatform;
  systemTrash: boolean;
  nativePicker: boolean;
  fileClipboard: boolean;
  revealInFileManager: boolean;
  githubCli: GhCliStatus;
  aiProviders: AiHarnessStatus[];
}

export interface BootstrapData {
  recentRepositories: RecentRepository[];
  repositoryProjects: RepositoryProject[];
  filesTreeStates: FilesTreeState[];
  openFilesStates: OpenFilesState[];
  activeRepository: RepositoryInfo | null;
  preferences: Preferences;
  performanceAutomation: boolean;
}

/**
 * Compatibility facade exposed by the current preload bridge. Execution
 * ownership is defined by OpenTigServerApi and OpenTigDesktopApi.
 */
export interface OpenTigApi {
  app: {
    bootstrap(): Promise<BootstrapData>;
    capabilities(): Promise<OpenTigCapabilities>;
    setPreferences(preferences: Partial<Preferences>): Promise<Preferences>;
    setFilesTreeExpandedPaths(repositoryId: string, expandedPaths: string[]): Promise<void>;
    setOpenFilesState(repositoryId: string, tabs: OpenFileTab[], activePath: string | null, previewPath: string | null): Promise<void>;
    setZoomFactor(factor: number): void;
    setTitleBarTheme(dark: boolean): Promise<void>;
  };
  clipboard: {
    /** Native file paths exposed only in direct response to an explicit paste action. */
    readFilePaths(): Promise<string[]>;
    /** Native clipboard image used by Files paste when no file paths are present. */
    readImagePng(): Promise<Uint8Array | null>;
  };
  repository: {
    /** Native directory picker only; opening and Git validation stay server-owned. */
    select(title?: string): Promise<string | null>;
    /** Native moved-repository confirmation and directory picker. */
    selectRelocation(repositoryName: string, previousPath: string): Promise<string | null>;
    openPath(path: string): Promise<RepositoryInfo>;
    openRecent(id: string): Promise<RepositoryInfo>;
    relocateRecent(id: string, path: string): Promise<RepositoryInfo>;
    getStatus(id: string, includeStats?: boolean): Promise<RepositoryStatus>;
    getFiles(id: string): Promise<FileTreeEntry[]>;
    /** One level of a folder the tree left collapsed (ignored folders such as node_modules/). */
    getDirectoryEntries(id: string, path: string): Promise<FileTreeEntry[]>;
    readFile(id: string, path: string, allowLarge?: boolean): Promise<FileResult>;
    readImage(id: string, path: string): Promise<ImageFileResult>;
    writeFile(id: string, path: string, content: string, expectedContent: string): Promise<WriteFileResult>;
    getAbsolutePath(id: string, path: string): Promise<string>;
    copyEntries(id: string, paths: string[]): Promise<CopyEntriesResult>;
    cutEntries(id: string, paths: string[]): Promise<CutEntriesResult>;
    pasteEntries(id: string, targetDirectory: string, sourcePaths: string[], cutTransferId?: string | null, imagePng?: Uint8Array | null): Promise<PasteEntriesResult>;
    moveEntry(id: string, path: string, targetDirectory: string): Promise<MoveEntryResult>;
    moveEntries(id: string, paths: string[], targetDirectory: string): Promise<MoveEntriesResult>;
    deleteEntry(id: string, path: string): Promise<DeleteEntryResult>;
    deleteEntries(id: string, paths: string[]): Promise<DeleteEntriesResult>;
    revealEntry(id: string, path: string): Promise<void>;
    renameEntry(id: string, path: string, newName: string): Promise<RenameEntryResult>;
    createEntry(id: string, targetDirectory: string, name: string, kind: 'file' | 'directory'): Promise<CreateEntryResult>;
    /** Full-text search over the working tree, ignoring files Git ignores. */
    search(id: string, options: SearchOptions): Promise<SearchResult>;
    replaceSearch(id: string, request: SearchReplaceRequest): Promise<SearchReplaceResult>;
    fileHistoryState(id: string): Promise<FileHistoryState>;
    undoFileOperation(id: string): Promise<FileHistoryResult>;
    redoFileOperation(id: string): Promise<FileHistoryResult>;
  };
  diff: {
    get(request: DiffRequest): Promise<DiffResult>;
    getCommit(repositoryId: string, oid: string): Promise<DiffResult>;
    getCommitFile(repositoryId: string, oid: string, path: string, oldPath?: string): Promise<DiffResult>;
  };
  index: {
    stage(repositoryId: string, paths: string[]): Promise<GitResult>;
    unstage(repositoryId: string, paths: string[]): Promise<GitResult>;
    discard(repositoryId: string, paths: string[]): Promise<GitResult>;
    stageAll(repositoryId: string): Promise<GitResult>;
    unstageAll(repositoryId: string): Promise<GitResult>;
    prepareCommitGroup(input: PrepareCommitGroupInput): Promise<GitResult>;
    updateConflict(repositoryId: string, path: string, content: string): Promise<GitResult>;
    resolveConflict(repositoryId: string, path: string, content: string): Promise<GitResult>;
  };
  commits: {
    create(repositoryId: string, message: string): Promise<CommitResult>;
    undoLatest(repositoryId: string, expectedOid: string): Promise<UndoLatestCommitResult>;
    list(repositoryId: string, cursor?: string): Promise<CommitPage>;
    files(repositoryId: string, oid: string): Promise<CommitFile[]>;
  };
  refs: {
    listBranches(repositoryId: string): Promise<BranchInfo[]>;
    switchBranch(repositoryId: string, branch: string): Promise<GitResult>;
    listWorktrees(repositoryId: string): Promise<WorktreeInfo[]>;
    selectWorktree(repositoryId: string, path: string): Promise<RepositoryInfo>;
    pull(repositoryId: string): Promise<PullResult>;
    push(repositoryId: string): Promise<PushResult>;
    /** Updates remote-tracking refs without merging or rebasing. */
    fetch(repositoryId: string): Promise<FetchResult>;
    /** Local branches plus every worktree; runs no per-worktree status scan. */
    localRefsSnapshot(repositoryId: string): Promise<LocalRefsSnapshot>;
    branchDetails(request: BranchDetailsRequest): Promise<BranchDetails>;
    worktreeDetails(request: WorktreeDetailsRequest): Promise<WorktreeDetails>;
    /** Deletes a branch safely unless the user explicitly confirmed force. */
    deleteBranch(request: DeleteBranchRequest): Promise<BranchDeletionResult>;
    /** Removes a worktree; dirty state and branch deletion require explicit confirmation. */
    removeWorktree(request: RemoveWorktreeRequest): Promise<WorktreeRemovalResult>;
  };
  ai: {
    statuses(forceRefresh?: boolean): Promise<AiHarnessStatus[]>;
    generateCommitMessage(input: GenerateCommitMessageInput): Promise<GeneratedCommitMessage>;
    /** Local diagnostic history of AI runs. Metadata only; never prompts. */
    log(): Promise<AiLogEntry[]>;
    clearLog(): Promise<void>;
    cancelGeneration(requestId: string): Promise<void>;
  };
  github: {
    status(forceRefresh?: boolean): Promise<GhCliStatus>;
    repositoryInfo(repositoryId: string): Promise<GitHubRepositoryInfo>;
    findPullRequestForBranch(repositoryId: string, branchName: string): Promise<PullRequestSummary | null>;
    listPullRequests(repositoryId: string, states: PullRequestState[]): Promise<PullRequestSummary[]>;
    getPullRequest(repositoryId: string, number: number): Promise<PullRequestDetails>;
    getPullRequestDiff(repositoryId: string, number: number): Promise<DiffResult>;
    getPullRequestCommitDiff(repositoryId: string, oid: string): Promise<DiffResult>;
    createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult>;
    generateDraft(input: GeneratePullRequestDraftInput): Promise<GeneratedPullRequestDraft>;
    cancelDraft(requestId: string): Promise<void>;
  };
  events: {
    onRepositoryChanged(callback: (repositoryId: string, scope: RepositoryChangeScope) => void): () => void;
  };
  projects: {
    create(name: string): Promise<RepositoryOrganization>;
    rename(projectId: string, name: string): Promise<RepositoryOrganization>;
    remove(projectId: string): Promise<RepositoryOrganization>;
    assign(repositoryKey: string, projectId: string | null): Promise<RepositoryOrganization>;
  };
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: SerializedOperationError };

export const IPC = {
  bootstrap: 'app:bootstrap', capabilities: 'app:capabilities', preferences: 'app:preferences', filesTreeStateUpdate: 'app:files-tree-state', openFilesStateUpdate: 'app:open-files-state', titleBarTheme: 'app:title-bar-theme', projectCreate: 'projects:create', projectRename: 'projects:rename', projectRemove: 'projects:remove', projectAssign: 'projects:assign', clipboardReadFilePaths: 'clipboard:read-file-paths', clipboardReadImagePng: 'clipboard:read-image-png', repositorySelect: 'repository:select', repositorySelectRelocation: 'repository:select-relocation',
  repositoryOpenPath: 'repository:open-path', repositoryOpenRecent: 'repository:open-recent', repositoryRelocateRecent: 'repository:relocate-recent', repositoryStatus: 'repository:status', repositoryFiles: 'repository:files', repositoryDirectoryEntries: 'repository:directory-entries',
  repositoryReadFile: 'repository:read-file', repositoryReadImage: 'repository:read-image', repositoryWriteFile: 'repository:write-file', repositoryAbsolutePath: 'repository:absolute-path',
  repositoryCopyEntries: 'repository:copy-entries', repositoryCutEntries: 'repository:cut-entries', repositoryPasteEntries: 'repository:paste-entries', repositoryMoveEntry: 'repository:move-entry', repositoryDeleteEntry: 'repository:delete-entry',
  repositoryMoveEntries: 'repository:move-entries', repositoryDeleteEntries: 'repository:delete-entries', repositoryRevealEntry: 'repository:reveal-entry', repositoryRenameEntry: 'repository:rename-entry', repositoryCreateEntry: 'repository:create-entry',
  repositoryFileHistoryState: 'repository:file-history-state', repositoryUndoFileOperation: 'repository:undo-file-operation', repositoryRedoFileOperation: 'repository:redo-file-operation',
  repositorySearch: 'repository:search', repositoryReplaceSearch: 'repository:replace-search',
  diffGet: 'diff:get', diffCommit: 'diff:commit', diffCommitFile: 'diff:commit-file', indexStage: 'index:stage',
  indexUnstage: 'index:unstage', indexDiscard: 'index:discard', indexStageAll: 'index:stage-all', indexUnstageAll: 'index:unstage-all', indexPrepareCommitGroup: 'index:prepare-commit-group', indexUpdateConflict: 'index:update-conflict', indexResolveConflict: 'index:resolve-conflict', commitCreate: 'commit:create', commitUndoLatest: 'commit:undo-latest',
  commitsList: 'commits:list', commitsFiles: 'commits:files', branchesList: 'refs:branches', branchSwitch: 'refs:switch', worktreesList: 'refs:worktrees',
  worktreeSelect: 'refs:select-worktree', refsPull: 'refs:pull', refsPush: 'refs:push', refsFetch: 'refs:fetch', repositoryChanged: 'repository:changed',
  localRefsSnapshot: 'refs:local-snapshot', branchDetails: 'refs:branch-details', worktreeDetails: 'refs:worktree-details',
  branchDelete: 'refs:delete-branch', worktreeRemove: 'refs:remove-worktree',
  aiStatuses: 'ai:statuses', aiGenerateCommitMessage: 'ai:generate-commit-message', aiCancelGeneration: 'ai:cancel-generation', aiLog: 'ai:log', aiClearLog: 'ai:clear-log',
  githubStatus: 'github:status', githubRepositoryInfo: 'github:repository-info', githubPrForBranch: 'github:pr-for-branch', githubPrList: 'github:pr-list', githubPrView: 'github:pr-view',
  githubPrDiff: 'github:pr-diff', githubPrCommitDiff: 'github:pr-commit-diff', githubPrCreate: 'github:pr-create', githubPrDraft: 'github:pr-draft', githubPrDraftCancel: 'github:pr-draft-cancel',
} as const;
