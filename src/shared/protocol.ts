import { IPC } from './contracts';
import type { OpenTigServerApi } from './server-api';
import { AI_SERVER_TIMEOUT_MS } from './ai-timeouts';

const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const CONTENT_MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const FILE_WRITE_MAX_REQUEST_BYTES = 17 * 1024 * 1024;
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export type OpenTigServerCommandName = (typeof IPC)[keyof typeof IPC];

type ApiMethodPath<Api> = {
  [Group in Extract<keyof Api, string>]: {
    [Method in Extract<keyof Api[Group], string>]:
      Api[Group][Method] extends (...args: never[]) => unknown ? `${Group}.${Method}` : never;
  }[Extract<keyof Api[Group], string>];
}[Extract<keyof Api, string>];

type OpenTigServerCommandApi = Omit<OpenTigServerApi, 'events'>;

export type OpenTigServerMethodPath = ApiMethodPath<OpenTigServerCommandApi>;

export interface OpenTigServerCommandDefinition {
  command: OpenTigServerCommandName;
  operation: string;
  mutation: boolean;
  maxRequestBytes: number;
  timeoutMs: number;
}

/**
 * Single ownership map for server methods and their current wire commands.
 * Tuple arguments and results are derived below from OpenTigServerApi.
 */
export const OPEN_TIG_SERVER_COMMANDS = {
  'app.bootstrap': command(IPC.bootstrap, 'bootstrap', false),
  'app.capabilities': command(IPC.capabilities, 'capabilities', false),
  'app.setPreferences': command(IPC.preferences, 'preferences', true),
  'app.setFilesTreeExpandedPaths': command(IPC.filesTreeStateUpdate, 'files-tree-state', true),
  'app.setOpenFilesState': command(IPC.openFilesStateUpdate, 'open-files-state', true),

  'projects.create': command(IPC.projectCreate, 'project-create', true),
  'projects.rename': command(IPC.projectRename, 'project-rename', true),
  'projects.remove': command(IPC.projectRemove, 'project-remove', true),
  'projects.assign': command(IPC.projectAssign, 'project-assign', true),

  'repository.openPath': command(IPC.repositoryOpenPath, 'open-path', true),
  'repository.browseDirectories': command(IPC.repositoryBrowseDirectories, 'browse-directories', false),
  'repository.openRecent': command(IPC.repositoryOpenRecent, 'open-recent', true),
  'repository.relocateRecent': command(IPC.repositoryRelocateRecent, 'relocate-recent', true),
  'repository.getStatus': command(IPC.repositoryStatus, 'status', false),
  'repository.getFiles': command(IPC.repositoryFiles, 'files', false),
  'repository.getDirectoryEntries': command(IPC.repositoryDirectoryEntries, 'directory-entries', false),
  'repository.readFile': command(IPC.repositoryReadFile, 'read-file', false),
  'repository.readImage': command(IPC.repositoryReadImage, 'read-image', false),
  'repository.getFavicon': command(IPC.repositoryGetFavicon, 'favicon', false),
  'repository.writeFile': command(IPC.repositoryWriteFile, 'write-file', true, { maxRequestBytes: FILE_WRITE_MAX_REQUEST_BYTES }),
  'repository.getAbsolutePath': command(IPC.repositoryAbsolutePath, 'absolute-path', false),
  'repository.copyEntries': command(IPC.repositoryCopyEntries, 'copy-entries', true),
  'repository.cutEntries': command(IPC.repositoryCutEntries, 'cut-entries', true),
  'repository.pasteEntries': command(IPC.repositoryPasteEntries, 'paste-entries', true, { maxRequestBytes: 66 * 1024 * 1024 }),
  'repository.moveEntry': command(IPC.repositoryMoveEntry, 'move-entry', true),
  'repository.moveEntries': command(IPC.repositoryMoveEntries, 'move-entries', true),
  'repository.deleteEntry': command(IPC.repositoryDeleteEntry, 'delete-entry', true),
  'repository.deleteEntries': command(IPC.repositoryDeleteEntries, 'delete-entries', true),
  'repository.renameEntry': command(IPC.repositoryRenameEntry, 'rename-entry', true),
  'repository.createEntry': command(IPC.repositoryCreateEntry, 'create-entry', true),
  'repository.search': command(IPC.repositorySearch, 'search', false),
  'repository.replaceSearch': command(IPC.repositoryReplaceSearch, 'replace-search', true),
  'repository.fileHistoryState': command(IPC.repositoryFileHistoryState, 'file-history-state', false),
  'repository.undoFileOperation': command(IPC.repositoryUndoFileOperation, 'undo-file-operation', true),
  'repository.redoFileOperation': command(IPC.repositoryRedoFileOperation, 'redo-file-operation', true),

  'diff.get': command(IPC.diffGet, 'diff', false),
  'diff.getCommit': command(IPC.diffCommit, 'commit-diff', false),
  'diff.getCommitFile': command(IPC.diffCommitFile, 'commit-file-diff', false),

  'index.stage': command(IPC.indexStage, 'stage', true),
  'index.unstage': command(IPC.indexUnstage, 'unstage', true),
  'index.discard': command(IPC.indexDiscard, 'discard', true),
  'index.stageAll': command(IPC.indexStageAll, 'stage-all', true),
  'index.unstageAll': command(IPC.indexUnstageAll, 'unstage-all', true),
  'index.prepareCommitGroup': command(IPC.indexPrepareCommitGroup, 'prepare-commit-group', true),
  'index.updateConflict': command(IPC.indexUpdateConflict, 'update-conflict', true, { maxRequestBytes: CONTENT_MAX_REQUEST_BYTES }),
  'index.resolveConflict': command(IPC.indexResolveConflict, 'resolve-conflict', true, { maxRequestBytes: CONTENT_MAX_REQUEST_BYTES }),

  'commits.create': command(IPC.commitCreate, 'commit', true),
  'commits.undoLatest': command(IPC.commitUndoLatest, 'undo-latest-commit', true),
  'commits.list': command(IPC.commitsList, 'history', false),
  'commits.files': command(IPC.commitsFiles, 'commit-files', false),

  'refs.listBranches': command(IPC.branchesList, 'branches', false),
  'refs.switchBranch': command(IPC.branchSwitch, 'switch-branch', true),
  'refs.listWorktrees': command(IPC.worktreesList, 'worktrees', false),
  'refs.selectWorktree': command(IPC.worktreeSelect, 'select-worktree', true),
  'refs.pull': command(IPC.refsPull, 'pull', true),
  'refs.push': command(IPC.refsPush, 'push', true),
  'refs.fetch': command(IPC.refsFetch, 'fetch', true),
  'refs.localRefsSnapshot': command(IPC.localRefsSnapshot, 'local-refs-snapshot', false),
  'refs.branchDetails': command(IPC.branchDetails, 'branch-details', false),
  'refs.worktreeDetails': command(IPC.worktreeDetails, 'worktree-details', false),
  'refs.deleteBranch': command(IPC.branchDelete, 'delete-branch', true),
  'refs.removeWorktree': command(IPC.worktreeRemove, 'remove-worktree', true),

  'ai.statuses': command(IPC.aiStatuses, 'ai-statuses', false),
  'ai.generateCommitMessage': command(IPC.aiGenerateCommitMessage, 'ai-generate-commit-message', true, { timeoutMs: AI_SERVER_TIMEOUT_MS }),
  'ai.log': command(IPC.aiLog, 'ai-log', false),
  'ai.clearLog': command(IPC.aiClearLog, 'ai-clear-log', true),
  'ai.cancelGeneration': command(IPC.aiCancelGeneration, 'ai-cancel-generation', true),

  'github.status': command(IPC.githubStatus, 'gh-status', false),
  'github.repositoryInfo': command(IPC.githubRepositoryInfo, 'gh-repository-info', false),
  'github.findPullRequestForBranch': command(IPC.githubPrForBranch, 'gh-pr-for-branch', false),
  'github.listPullRequests': command(IPC.githubPrList, 'gh-pr-list', false),
  'github.getPullRequest': command(IPC.githubPrView, 'gh-pr-view', false),
  'github.getPullRequestDiff': command(IPC.githubPrDiff, 'gh-pr-diff', false),
  'github.getPullRequestCommitDiff': command(IPC.githubPrCommitDiff, 'gh-pr-commit-diff', false),
  'github.createPullRequest': command(IPC.githubPrCreate, 'gh-pr-create', true),
  'github.generateDraft': command(IPC.githubPrDraft, 'ai-pr-draft', true, { timeoutMs: AI_SERVER_TIMEOUT_MS }),
  'github.cancelDraft': command(IPC.githubPrDraftCancel, 'ai-pr-draft-cancel', true),

  'diagnostics.list': command(IPC.diagnosticsList, 'diagnostics-list', false),
  'diagnostics.clear': command(IPC.diagnosticsClear, 'diagnostics-clear', true),
  'diagnostics.record': command(IPC.diagnosticsRecord, 'diagnostics-record', true),
} as const satisfies Record<OpenTigServerMethodPath, OpenTigServerCommandDefinition>;

type ApiMethodAtPath<Api, Path extends string> = Path extends `${infer Group}.${infer Method}`
  ? Group extends keyof Api
    ? Method extends keyof Api[Group]
      ? Extract<Api[Group][Method], (...args: never[]) => unknown>
      : never
    : never
  : never;

type CommandContract<Method> = Method extends (...args: infer Args) => infer Result
  ? { args: Args; result: Awaited<Result> }
  : never;

/** Typed tuple arguments and result for each server wire command. */
export type OpenTigServerCommandMap = {
  [Path in OpenTigServerMethodPath as (typeof OPEN_TIG_SERVER_COMMANDS)[Path]['command']]:
    CommandContract<ApiMethodAtPath<OpenTigServerCommandApi, Path>>;
};

function command<Name extends OpenTigServerCommandName>(
  commandName: Name,
  operation: string,
  mutation: boolean,
  options: { maxRequestBytes?: number; timeoutMs?: number } = {},
): OpenTigServerCommandDefinition & { command: Name } {
  return {
    command: commandName,
    operation,
    mutation,
    maxRequestBytes: options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  };
}
