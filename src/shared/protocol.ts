import { IPC } from './contracts';
import type { OpenTigServerApi } from './server-api';
import { AI_SERVER_TIMEOUT_MS } from './ai-timeouts';
import {
  CLIENT_TIMEOUT_MARGIN_MS,
  COMMIT_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  GITHUB_READ_TIMEOUT_MS,
  PULL_REQUEST_COMMITS_TIMEOUT_MS,
  PULL_REQUEST_CREATE_TIMEOUT_MS,
  PULL_REQUEST_DIFF_TIMEOUT_MS,
  PULL_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  REMOVE_WORKTREE_TIMEOUT_MS,
  SWITCH_BRANCH_TIMEOUT_MS,
} from './operation-timeouts';

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
  'app.gitStatus': command(IPC.gitStatus, 'git-status', false),
  'app.setGlobalGitIdentity': command(IPC.gitSetGlobalIdentity, 'git-identity-set', true),
  'app.completeOnboarding': command(IPC.completeOnboarding, 'complete-onboarding', true),
  'repository.clone': command(IPC.repositoryClone, 'clone-repository', true),
  'repository.cloneStatus': command(IPC.repositoryCloneStatus, 'clone-status', false),
  'repository.cancelClone': command(IPC.repositoryCancelClone, 'cancel-clone', true),
  'app.bootstrap': command(IPC.bootstrap, 'bootstrap', false),
  'app.capabilities': command(IPC.capabilities, 'capabilities', false),
  'app.setPreferences': command(IPC.preferences, 'preferences', true),
  'app.setFilesTreeExpandedPaths': command(IPC.filesTreeStateUpdate, 'files-tree-state', true),
  'app.setOpenFilesState': command(IPC.openFilesStateUpdate, 'open-files-state', true),

  'projects.create': command(IPC.projectCreate, 'project-create', true),
  'projects.rename': command(IPC.projectRename, 'project-rename', true),
  'projects.remove': command(IPC.projectRemove, 'project-remove', true),
  'projects.assign': command(IPC.projectAssign, 'project-assign', true),
  'projects.moveProject': command(IPC.projectMove, 'project-move', true),
  'projects.moveRepository': command(IPC.projectMoveRepository, 'project-move-repository', true),

  'repository.preparePath': command(IPC.repositoryPreparePath, 'prepare-path', false),
  'repository.completeSetup': command(IPC.repositoryCompleteSetup, 'complete-setup', true),
  'repository.openPath': command(IPC.repositoryOpenPath, 'open-path', true),
  'repository.browseDirectories': command(IPC.repositoryBrowseDirectories, 'browse-directories', false),
  'repository.openRecent': command(IPC.repositoryOpenRecent, 'open-recent', true),
  'repository.forget': command(IPC.repositoryForget, 'forget-repository', true),
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

  'commits.create': command(IPC.commitCreate, 'commit', true, { timeoutMs: COMMIT_TIMEOUT_MS }),
  'commits.authorship': command(IPC.commitAuthorship, 'commit-authorship-read', false),
  'commits.setAuthorship': command(IPC.commitSetAuthorship, 'commit-authorship-set', true),
  'commits.undoLatest': command(IPC.commitUndoLatest, 'undo-latest-commit', true),
  'commits.list': command(IPC.commitsList, 'history', false),
  'commits.files': command(IPC.commitsFiles, 'commit-files', false),

  'refs.listBranches': command(IPC.branchesList, 'branches', false),
  'refs.switchBranch': command(IPC.branchSwitch, 'switch-branch', true, { timeoutMs: SWITCH_BRANCH_TIMEOUT_MS }),
  'refs.listWorktrees': command(IPC.worktreesList, 'worktrees', false),
  'refs.selectWorktree': command(IPC.worktreeSelect, 'select-worktree', true),
  'refs.pull': command(IPC.refsPull, 'pull', true, { timeoutMs: PULL_TIMEOUT_MS }),
  'refs.pushContext': command(IPC.refsPushContext, 'push-context', false),
  'refs.push': command(IPC.refsPush, 'push', true, { timeoutMs: PUSH_TIMEOUT_MS }),
  'refs.fetch': command(IPC.refsFetch, 'fetch', true, { timeoutMs: FETCH_TIMEOUT_MS }),
  'refs.localRefsSnapshot': command(IPC.localRefsSnapshot, 'local-refs-snapshot', false),
  'refs.branchDetails': command(IPC.branchDetails, 'branch-details', false),
  'refs.remoteBranchDetails': command(IPC.remoteBranchDetails, 'remote-branch-details', false, { timeoutMs: 120_000 }),
  'refs.createTrackingBranch': command(IPC.trackingBranchCreate, 'create-tracking-branch', true),
  'refs.deleteRemoteBranch': command(IPC.remoteBranchDelete, 'delete-remote-branch', true, { timeoutMs: 180_000 }),
  'refs.fetchBranches': command(IPC.branchesFetch, 'fetch-branches', true, { timeoutMs: 180_000 }),
  'refs.worktreeDetails': command(IPC.worktreeDetails, 'worktree-details', false),
  'refs.deleteBranch': command(IPC.branchDelete, 'delete-branch', true),
  'refs.removeWorktree': command(IPC.worktreeRemove, 'remove-worktree', true, { timeoutMs: REMOVE_WORKTREE_TIMEOUT_MS }),

  'ai.repositoryInstructions': command(IPC.aiRepositoryInstructions, 'ai-repository-instructions', false),
  'ai.setRepositoryInstructions': command(IPC.aiSetRepositoryInstructions, 'ai-set-repository-instructions', true),
  'ai.statuses': command(IPC.aiStatuses, 'ai-statuses', false),
  'ai.generateCommitMessage': command(IPC.aiGenerateCommitMessage, 'ai-generate-commit-message', true, { timeoutMs: AI_SERVER_TIMEOUT_MS }),
  'ai.log': command(IPC.aiLog, 'ai-log', false),
  'ai.clearLog': command(IPC.aiClearLog, 'ai-clear-log', true),
  'ai.cancelGeneration': command(IPC.aiCancelGeneration, 'ai-cancel-generation', true),

  'github.accountsStatus': command(IPC.githubAccountsStatus, 'gh-accounts-status', false, { timeoutMs: 90_000 }),
  'github.repositoryAccount': command(IPC.githubRepositoryAccount, 'gh-repository-account', false, { timeoutMs: 60_000 }),
  'github.setDefaultAccount': command(IPC.githubSetDefaultAccount, 'gh-set-default-account', true),
  'github.setRepositoryAccount': command(IPC.githubSetRepositoryAccount, 'gh-set-repository-account', true),
  'github.status': command(IPC.githubStatus, 'gh-status', false),
  'github.repositoryInfo': command(IPC.githubRepositoryInfo, 'gh-repository-info', false),
  'github.findPullRequestForBranch': command(IPC.githubPrForBranch, 'gh-pr-for-branch', false, { timeoutMs: GITHUB_READ_TIMEOUT_MS }),
  'github.listPullRequests': command(IPC.githubPrList, 'gh-pr-list', false, { timeoutMs: GITHUB_READ_TIMEOUT_MS }),
  'github.getPullRequest': command(IPC.githubPrView, 'gh-pr-view', false, { timeoutMs: GITHUB_READ_TIMEOUT_MS }),
  'github.getPullRequestStack': command(IPC.githubPrStack, 'gh-pr-stack', false, { timeoutMs: GITHUB_READ_TIMEOUT_MS }),
  'github.getPullRequestDiff': command(IPC.githubPrDiff, 'gh-pr-diff', false, { timeoutMs: PULL_REQUEST_DIFF_TIMEOUT_MS }),
  'github.getPullRequestCommitDiff': command(IPC.githubPrCommitDiff, 'gh-pr-commit-diff', false, { timeoutMs: GITHUB_READ_TIMEOUT_MS }),
  'github.getPullRequestCommits': command(IPC.githubPrCommits, 'gh-pr-commits', false, { timeoutMs: PULL_REQUEST_COMMITS_TIMEOUT_MS }),
  'github.createPullRequest': command(IPC.githubPrCreate, 'gh-pr-create', true, { timeoutMs: PULL_REQUEST_CREATE_TIMEOUT_MS }),
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

const COMMANDS_BY_NAME: ReadonlyMap<string, OpenTigServerCommandDefinition> = new Map(
  Object.values(OPEN_TIG_SERVER_COMMANDS).map((definition) => [definition.command, definition]),
);

export function commandDefinition(command: string): OpenTigServerCommandDefinition | undefined {
  return COMMANDS_BY_NAME.get(command);
}

/** How long a client waits for a command that already reached the server. */
export function clientCommandTimeoutMs(command: string): number {
  return (commandDefinition(command)?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS) + CLIENT_TIMEOUT_MARGIN_MS;
}

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
