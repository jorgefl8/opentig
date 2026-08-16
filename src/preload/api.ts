import type { IpcRenderer } from 'electron';
import type { IpcResult, JustGitApi } from '../shared/contracts';
import { IPC } from '../shared/contracts';
import type { RepositoryChangeScope } from '../shared/repository-change';

export function createApi(ipcRenderer: IpcRenderer, setZoomFactor: (factor: number) => void): JustGitApi {
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const result = await ipcRenderer.invoke(channel, ...args) as IpcResult<T>;
    if (result.ok) return result.value;
    const error = new Error(result.error.message) as Error & { detail?: typeof result.error };
    error.detail = result.error;
    throw error;
  };
  return {
    app: {
      bootstrap: () => invoke(IPC.bootstrap),
      setPreferences: (preferences) => invoke(IPC.preferences, preferences),
      setFilesTreeExpandedPaths: (repositoryId, expandedPaths) => invoke(IPC.filesTreeStateUpdate, repositoryId, expandedPaths),
      setOpenFilesState: (repositoryId, tabs, activePath, previewPath) => invoke(IPC.openFilesStateUpdate, repositoryId, tabs, activePath, previewPath),
      setZoomFactor: (factor) => setZoomFactor(Math.max(0.8, Math.min(1.3, Number(factor) || 1))),
      setTitleBarTheme: (dark) => invoke(IPC.titleBarTheme, dark),
    },
    projects: {
      create: (name) => invoke(IPC.projectCreate, name),
      rename: (projectId, name) => invoke(IPC.projectRename, projectId, name),
      remove: (projectId) => invoke(IPC.projectRemove, projectId),
      assign: (repositoryKey, projectId) => invoke(IPC.projectAssign, repositoryKey, projectId),
    },
    clipboard: {
      readText: () => invoke(IPC.clipboardReadText),
      writeText: (text) => invoke(IPC.clipboardWriteText, text),
    },
    shell: {
      openExternal: (url) => invoke(IPC.shellOpenExternal, url),
    },
    repository: {
      select: () => invoke(IPC.repositorySelect),
      openRecent: (id) => invoke(IPC.repositoryOpenRecent, id),
      getStatus: (id) => invoke(IPC.repositoryStatus, id),
      getFiles: (id) => invoke(IPC.repositoryFiles, id),
      getDirectoryEntries: (id, path) => invoke(IPC.repositoryDirectoryEntries, id, path),
      readFile: (id, path, allowLarge) => invoke(IPC.repositoryReadFile, id, path, allowLarge),
      readImage: (id, path) => invoke(IPC.repositoryReadImage, id, path),
      writeFile: (id, path, content, expectedContent) => invoke(IPC.repositoryWriteFile, id, path, content, expectedContent),
      getAbsolutePath: (id, path) => invoke(IPC.repositoryAbsolutePath, id, path),
      copyEntries: (id, paths) => invoke(IPC.repositoryCopyEntries, id, paths),
      cutEntries: (id, paths) => invoke(IPC.repositoryCutEntries, id, paths),
      pasteEntries: (id, targetDirectory) => invoke(IPC.repositoryPasteEntries, id, targetDirectory),
      moveEntry: (id, path, targetDirectory) => invoke(IPC.repositoryMoveEntry, id, path, targetDirectory),
      moveEntries: (id, paths, targetDirectory) => invoke(IPC.repositoryMoveEntries, id, paths, targetDirectory),
      deleteEntry: (id, path) => invoke(IPC.repositoryDeleteEntry, id, path),
      deleteEntries: (id, paths) => invoke(IPC.repositoryDeleteEntries, id, paths),
      revealEntry: (id, path) => invoke(IPC.repositoryRevealEntry, id, path),
      renameEntry: (id, path, newName) => invoke(IPC.repositoryRenameEntry, id, path, newName),
      createEntry: (id, targetDirectory, name, kind) => invoke(IPC.repositoryCreateEntry, id, targetDirectory, name, kind),
      search: (id, options) => invoke(IPC.repositorySearch, id, options),
      replaceSearch: (id, request) => invoke(IPC.repositoryReplaceSearch, id, request),
      fileHistoryState: (id) => invoke(IPC.repositoryFileHistoryState, id),
      undoFileOperation: (id) => invoke(IPC.repositoryUndoFileOperation, id),
      redoFileOperation: (id) => invoke(IPC.repositoryRedoFileOperation, id),
    },
    diff: {
      get: (request) => invoke(IPC.diffGet, request),
      getCommit: (id, oid) => invoke(IPC.diffCommit, id, oid),
      getCommitFile: (id, oid, path, oldPath) => invoke(IPC.diffCommitFile, id, oid, path, oldPath),
    },
    index: {
      stage: (id, paths) => invoke(IPC.indexStage, id, paths),
      unstage: (id, paths) => invoke(IPC.indexUnstage, id, paths),
      discard: (id, paths) => invoke(IPC.indexDiscard, id, paths),
      stageAll: (id) => invoke(IPC.indexStageAll, id),
      unstageAll: (id) => invoke(IPC.indexUnstageAll, id),
      prepareCommitGroup: (input) => invoke(IPC.indexPrepareCommitGroup, input),
      updateConflict: (id, path, content) => invoke(IPC.indexUpdateConflict, id, path, content),
      resolveConflict: (id, path, content) => invoke(IPC.indexResolveConflict, id, path, content),
    },
    commits: {
      create: (id, message) => invoke(IPC.commitCreate, id, message),
      undoLatest: (id, expectedOid) => invoke(IPC.commitUndoLatest, id, expectedOid),
      list: (id, cursor) => invoke(IPC.commitsList, id, cursor),
      files: (id, oid) => invoke(IPC.commitsFiles, id, oid),
    },
    refs: {
      listBranches: (id) => invoke(IPC.branchesList, id),
      switchBranch: (id, branch) => invoke(IPC.branchSwitch, id, branch),
      listWorktrees: (id) => invoke(IPC.worktreesList, id),
      selectWorktree: (id, path) => invoke(IPC.worktreeSelect, id, path),
      pull: (id) => invoke(IPC.refsPull, id),
      push: (id) => invoke(IPC.refsPush, id),
      localRefsSnapshot: (id) => invoke(IPC.localRefsSnapshot, id),
      branchDetails: (request) => invoke(IPC.branchDetails, request),
      worktreeDetails: (request) => invoke(IPC.worktreeDetails, request),
      deleteBranch: (request) => invoke(IPC.branchDelete, request),
      removeWorktree: (request) => invoke(IPC.worktreeRemove, request),
    },
    ai: {
      statuses: (forceRefresh) => invoke(IPC.aiStatuses, forceRefresh),
      generateCommitMessage: (input) => invoke(IPC.aiGenerateCommitMessage, input),
      cancelGeneration: (requestId) => invoke(IPC.aiCancelGeneration, requestId),
      log: () => invoke(IPC.aiLog),
      clearLog: () => invoke(IPC.aiClearLog),
    },
    github: {
      status: (forceRefresh) => invoke(IPC.githubStatus, forceRefresh),
      repositoryInfo: (id) => invoke(IPC.githubRepositoryInfo, id),
      findPullRequestForBranch: (id, branchName) => invoke(IPC.githubPrForBranch, id, branchName),
      listPullRequests: (id, states) => invoke(IPC.githubPrList, id, states),
      getPullRequest: (id, number) => invoke(IPC.githubPrView, id, number),
      getPullRequestDiff: (id, number) => invoke(IPC.githubPrDiff, id, number),
      getPullRequestCommitDiff: (id, oid) => invoke(IPC.githubPrCommitDiff, id, oid),
      createPullRequest: (input) => invoke(IPC.githubPrCreate, input),
      generateDraft: (input) => invoke(IPC.githubPrDraft, input),
      cancelDraft: (requestId) => invoke(IPC.githubPrDraftCancel, requestId),
    },
    events: {
      onRepositoryChanged: (callback) => {
        const listener = (
          _event: unknown,
          repositoryId: string,
          scope: RepositoryChangeScope,
        ) => callback(repositoryId, scope);
        ipcRenderer.on(IPC.repositoryChanged, listener);
        return () => { ipcRenderer.removeListener(IPC.repositoryChanged, listener); };
      },
    },
  };
}
