import { lstat } from 'node:fs/promises';
import { clipboard, dialog, ipcMain, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import type { DiffRequest, IpcResult, Preferences } from '../../shared/contracts';
import { IPC } from '../../shared/contracts';
import { GitOperationError, serializeError } from '../../shared/errors';
import type { FileService } from '../files/FileService';
import type { FileOperationHistory } from '../files/FileOperationHistory';
import type { RepositoryWatcher } from '../files/RepositoryWatcher';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import type { RepositoryService } from '../git/RepositoryService';
import type { SearchService } from '../git/SearchService';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { CommitMessageService } from '../ai/CommitMessageService';
import type { AiLogStore } from '../persistence/AiLogStore';
import type { PullRequestDraftService } from '../ai/PullRequestDraftService';
import type { GitHubService } from '../github/GitHubService';
import { readClipboardFilePaths } from '../files/ClipboardFileTransfer';
import { applyWindowTitleBarTheme } from '../window/WindowTitleBar';
import { aiString, booleanArg, branchDetailsArg, createPullRequestArg, deleteBranchArg, filesTreeStateArg, generateCommitMessageArg, generatePullRequestDraftArg, nullableProjectIdArg, oidArg, openFilesStateArg, pathsArg, prepareCommitGroupArg, prNumberArg, projectIdArg, projectNameArg, pullRequestStatesArg, removeWorktreeArg, repositoryKeyArg, searchOptionsArg, searchReplaceArg, stringArg, textArg, worktreeDetailsArg } from './validators';

interface Services {
  window: BrowserWindow;
  settings: SettingsStore;
  repositories: RepositoryService;
  search: SearchService;
  files: FileService;
  fileHistory: FileOperationHistory;
  operations: GitRepositoryOperations;
  watcher: RepositoryWatcher;
  ai: CommitMessageService;
  aiLog: AiLogStore;
  github: GitHubService;
  prDrafts: PullRequestDraftService;
  onPreferencesChanged?: (preferences: Preferences) => void;
}

export function registerHandlers(services: Services): () => void {
  const channels: string[] = [];
  let pendingCutPaths: string[] | null = null;
  const handle = <T>(channel: string, operation: string, handler: (...args: unknown[]) => Promise<T> | T) => {
    channels.push(channel);
    ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
      try { return { ok: true, value: await handler(...args) }; }
      catch (error) { return { ok: false, error: serializeError(error, operation) }; }
    });
  };

  handle(IPC.bootstrap, 'bootstrap', async () => {
    const activeRepository = await services.repositories.restore();
    if (activeRepository) services.watcher.start(activeRepository);
    return {
      recentRepositories: services.repositories.recents(),
      repositoryProjects: services.settings.repositoryProjects,
      filesTreeStates: services.settings.filesTreeStates,
      openFilesStates: services.settings.openFilesStates,
      activeRepository,
      preferences: services.settings.preferences,
      performanceAutomation: process.env.JUSTGIT_PERF_AUTOMATION === '1',
    };
  });
  handle(IPC.preferences, 'preferences', async (partial) => {
    const preferences = await services.settings.setPreferences((partial ?? {}) as Partial<Preferences>);
    services.onPreferencesChanged?.(preferences);
    return preferences;
  });
  handle(IPC.titleBarTheme, 'title-bar-theme', (dark) => {
    applyWindowTitleBarTheme(services.window, booleanArg(dark, 'title-bar-theme'));
  });
  handle(IPC.filesTreeStateUpdate, 'files-tree-state', (repositoryId, expandedPaths) => {
    const state = filesTreeStateArg(repositoryId, expandedPaths, 'files-tree-state');
    services.settings.setFilesTreeExpandedPaths(state.repositoryId, state.expandedPaths);
  });
  handle(IPC.openFilesStateUpdate, 'open-files-state', (repositoryId, tabs, activePath, previewPath) => {
    const state = openFilesStateArg(repositoryId, tabs, activePath, previewPath, 'open-files-state');
    services.settings.setOpenFilesState(state.repositoryId, state.tabs, state.activePath, state.previewPath);
  });
  handle(IPC.projectCreate, 'project-create', (name) => services.settings.createRepositoryProject(projectNameArg(name, 'project-create')));
  handle(IPC.projectRename, 'project-rename', (projectId, name) => services.settings.renameRepositoryProject(projectIdArg(projectId, 'project-rename'), projectNameArg(name, 'project-rename')));
  handle(IPC.projectRemove, 'project-remove', (projectId) => services.settings.removeRepositoryProject(projectIdArg(projectId, 'project-remove')));
  handle(IPC.projectAssign, 'project-assign', (repositoryKey, projectId) => services.settings.assignRepositoryProject(repositoryKeyArg(repositoryKey, 'project-assign'), nullableProjectIdArg(projectId, 'project-assign')));
  handle(IPC.clipboardReadText, 'clipboard-read-text', () => clipboard.readText());
  handle(IPC.clipboardWriteText, 'clipboard-write-text', (text) => {
    pendingCutPaths = null;
    clipboard.writeText(textArg(text, 'clipboard-write-text', 8 * 1024 * 1024));
  });
  handle(IPC.shellOpenExternal, 'open-external', async (url) => {
    const value = stringArg(url, 'open-external', 2_048);
    let parsed: URL;
    try { parsed = new URL(value); } catch {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'open-external', message: 'Invalid URL.' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'mailto:') {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'open-external', message: 'Only web or mail links can be opened.' });
    }
    await shell.openExternal(parsed.toString());
  });
  handle(IPC.repositorySelect, 'select-repository', async () => {
    const selection = await dialog.showOpenDialog(services.window, { properties: ['openDirectory'], title: 'Open Git repository' });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const repository = await services.repositories.openPath(selection.filePaths[0]);
    pendingCutPaths = null;
    services.watcher.start(repository);
    return repository;
  });
  handle(IPC.repositoryOpenRecent, 'open-recent', async (id) => {
    const repositoryId = stringArg(id, 'open-recent', 64);
    let repository;
    try {
      repository = await services.repositories.openRecent(repositoryId);
    } catch (error) {
      const recent = services.repositories.recent(repositoryId);
      if (!recent) throw error;
      const prompt = await dialog.showMessageBox(services.window, {
        type: 'warning',
        title: 'Repository unavailable',
        message: `JustGit could not open ${recent.repositoryName}.`,
        detail: `${recent.path}\n\nIf the repository moved, locate its new folder. Its project assignment, open tabs, and expanded folders will be preserved.`,
        buttons: ['Locate repository', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (prompt.response !== 0) return null;
      const selection = await dialog.showOpenDialog(services.window, {
        properties: ['openDirectory'],
        title: `Locate ${recent.repositoryName}`,
      });
      if (selection.canceled || !selection.filePaths[0]) return null;
      repository = await services.repositories.relocateRecent(repositoryId, selection.filePaths[0]);
    }
    pendingCutPaths = null;
    services.watcher.start(repository);
    return repository;
  });
  handle(IPC.repositoryStatus, 'status', (id, includeStats) => services.repositories.status(
    stringArg(id, 'status', 64),
    includeStats === undefined ? true : booleanArg(includeStats, 'status'),
  ));
  handle(IPC.repositoryFiles, 'files', (id) => services.files.list(stringArg(id, 'files', 64)));
  handle(IPC.repositorySearch, 'search', (id, options) => services.search.search(
    stringArg(id, 'search', 64),
    searchOptionsArg(options, 'search'),
  ));
  handle(IPC.repositoryDirectoryEntries, 'directory-entries', (id, directoryPath) => services.files.listDirectory(
    stringArg(id, 'directory-entries', 64),
    stringArg(directoryPath, 'directory-entries'),
  ));
  handle(IPC.repositoryReadFile, 'read-file', (id, filePath, allowLarge) => services.files.read(stringArg(id, 'read-file', 64), stringArg(filePath, 'read-file'), allowLarge === true));
  handle(IPC.repositoryReadImage, 'read-image', (id, filePath) => services.files.readImage(
    stringArg(id, 'read-image', 64),
    stringArg(filePath, 'read-image'),
  ));
  handle(IPC.repositoryWriteFile, 'write-file', (id, filePath, content, expectedContent) => services.files.write(
    stringArg(id, 'write-file', 64),
    stringArg(filePath, 'write-file'),
    textArg(content, 'write-file', 8 * 1024 * 1024),
    textArg(expectedContent, 'write-file', 8 * 1024 * 1024),
  ));
  handle(IPC.repositoryAbsolutePath, 'absolute-path', async (id, filePath) => {
    const repositoryId = stringArg(id, 'absolute-path', 64);
    const relativePath = stringArg(filePath, 'absolute-path');
    const target = services.repositories.resolvePath(repositoryId, relativePath);
    await lstat(target);
    return target;
  });
  handle(IPC.repositoryCopyEntries, 'copy-entries', async (id, rawPaths) => {
    const repositoryId = stringArg(id, 'copy-entries', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(rawPaths, 'copy-entries'));
    const absolutePaths = validPaths.map((filePath) => services.repositories.resolvePath(repositoryId, filePath));
    await Promise.all(absolutePaths.map((filePath) => lstat(filePath)));
    pendingCutPaths = null;
    clipboard.writeText(absolutePaths.join('\r\n'));
    return { copied: absolutePaths.length };
  });
  handle(IPC.repositoryCutEntries, 'cut-entries', async (id, rawPaths) => {
    const repositoryId = stringArg(id, 'cut-entries', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(rawPaths, 'cut-entries'));
    const absolutePaths = validPaths.map((filePath) => services.repositories.resolvePath(repositoryId, filePath));
    await Promise.all(absolutePaths.map((filePath) => lstat(filePath)));
    pendingCutPaths = absolutePaths;
    clipboard.writeText(absolutePaths.join('\r\n'));
    return { cut: absolutePaths.length };
  });
  handle(IPC.repositoryPasteEntries, 'paste-entries', async (id, targetDirectory) => {
    const repositoryId = stringArg(id, 'paste-entries', 64);
    const destination = textArg(targetDirectory, 'paste-entries', 32_768);
    return services.fileHistory.serialize(repositoryId, async () => {
      const filePaths = await readClipboardFilePaths(clipboard);
      if (filePaths.length > 0) {
        if (pendingCutPaths && samePathSelection(filePaths, pendingCutPaths)) {
          const sources = [...pendingCutPaths];
          const repository = services.repositories.get(repositoryId);
          const created = await services.files.movePaths(repositoryId, sources, destination);
          pendingCutPaths = null;
          const pairs = created.map((to, index) => ({ from: sources[index]!.slice(repository.path.length + 1).replace(/\\/g, '/'), to }));
          services.fileHistory.recordMove(repositoryId, created.length === 1 ? 'Move item' : `Move ${created.length} items`, pairs);
          return { status: 'pasted', source: 'cut', created } as const;
        }
        pendingCutPaths = null;
        const created = await services.files.pastePaths(repositoryId, filePaths, destination);
        services.fileHistory.recordPaste(repositoryId, { label: created.length === 1 ? 'Paste item' : `Paste ${created.length} items`, created, sources: created.map((to, index) => ({ source: filePaths[index]!, destination: to })) });
        return { status: 'pasted', source: 'files', created } as const;
      }
      pendingCutPaths = null;
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const created = await services.files.pasteImage(repositoryId, destination, image.toPNG());
        const snapshot = await services.files.snapshot(repositoryId, created, 50_000_000);
        services.fileHistory.recordPaste(repositoryId, { label: 'Paste image', created: [created], ...(snapshot ? { snapshots: [snapshot] } : {}), image: true });
        return { status: 'pasted', source: 'image', created: [created] } as const;
      }
      return { status: 'empty', created: [] } as const;
    });
  });
  handle(IPC.repositoryMoveEntry, 'move-entry', async (id, filePath, targetDirectory) => {
    const repositoryId = stringArg(id, 'move-entry', 64);
    return services.fileHistory.serialize(repositoryId, async () => {
      const result = await services.files.move(repositoryId, stringArg(filePath, 'move-entry'), textArg(targetDirectory, 'move-entry', 32_768));
      if (result.status === 'moved') services.fileHistory.recordMove(repositoryId, 'Move item', [{ from: result.from, to: result.to }]);
      return result;
    });
  });
  handle(IPC.repositoryMoveEntries, 'move-entries', async (id, rawPaths, targetDirectory) => {
    const repositoryId = stringArg(id, 'move-entries', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(rawPaths, 'move-entries'));
    return services.fileHistory.serialize(repositoryId, async () => {
      const result = await services.files.moveEntries(repositoryId, validPaths, textArg(targetDirectory, 'move-entries', 32_768));
      services.fileHistory.recordMove(repositoryId, result.moved.length === 1 ? 'Move item' : `Move ${result.moved.length} items`, result.moved);
      return result;
    });
  });
  handle(IPC.repositoryDeleteEntry, 'delete-entry', async (id, filePath) => {
    const repositoryId = stringArg(id, 'delete-entry', 64);
    const relativePath = stringArg(filePath, 'delete-entry');
    const target = services.repositories.resolvePath(repositoryId, relativePath);
    const metadata = await lstat(target);
    const isDirectory = metadata.isDirectory();
    const confirmation = await dialog.showMessageBox(services.window, {
      type: 'warning',
      title: isDirectory ? 'Delete folder' : 'Delete file',
      message: `Move this ${isDirectory ? 'folder' : 'file'} to the Recycle Bin?`,
      detail: relativePath,
      buttons: ['Move to Recycle Bin', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return { deleted: false } as const;
    return services.fileHistory.serialize(repositoryId, async () => {
      const prepared = await services.fileHistory.prepareDelete(repositoryId, [relativePath]);
      await shell.trashItem(target);
      services.fileHistory.recordDelete(repositoryId, prepared, [relativePath]);
      return { deleted: true } as const;
    });
  });
  handle(IPC.repositoryDeleteEntries, 'delete-entries', async (id, rawPaths) => {
    const repositoryId = stringArg(id, 'delete-entries', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(rawPaths, 'delete-entries'));
    if (validPaths.length === 0) return { deleted: 0 } as const;
    const targets = validPaths.map((filePath) => services.repositories.resolvePath(repositoryId, filePath));
    const count = validPaths.length;
    const confirmation = await dialog.showMessageBox(services.window, {
      type: 'warning',
      title: count === 1 ? 'Delete item' : `Delete ${count} items`,
      message: count === 1 ? 'Move this item to the Recycle Bin?' : `Move ${count} items to the Recycle Bin?`,
      detail: validPaths.join('\n'),
      buttons: ['Move to Recycle Bin', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return { deleted: 0 } as const;
    return services.fileHistory.serialize(repositoryId, async () => {
      const prepared = await services.fileHistory.prepareDelete(repositoryId, validPaths);
      const deletedPaths: string[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]!;
        // A selection can include both a folder and files inside it; the folder is
        // trashed first, so skip any target that no longer exists.
        try { await lstat(target); } catch { continue; }
        try { await shell.trashItem(target); }
        catch (error) {
          if (deletedPaths.length) services.fileHistory.recordDelete(repositoryId, prepared, deletedPaths);
          throw error;
        }
        deletedPaths.push(validPaths[index]!);
      }
      if (deletedPaths.length === 0) return { deleted: 0 } as const;
      const recovery = services.fileHistory.recordDelete(repositoryId, prepared, deletedPaths);
      return { deleted: deletedPaths.length, recovery } as const;
    });
  });
  handle(IPC.repositoryRevealEntry, 'reveal-entry', async (id, filePath) => {
    const repositoryId = stringArg(id, 'reveal-entry', 64);
    const relativePath = stringArg(filePath, 'reveal-entry');
    const target = services.repositories.resolvePath(repositoryId, relativePath);
    await lstat(target);
    shell.showItemInFolder(target);
  });
  handle(IPC.repositoryRenameEntry, 'rename-entry', async (id, filePath, newName) => {
    const repositoryId = stringArg(id, 'rename-entry', 64);
    return services.fileHistory.serialize(repositoryId, async () => {
      const result = await services.files.rename(repositoryId, stringArg(filePath, 'rename-entry'), stringArg(newName, 'rename-entry', 255));
      if (result.status === 'renamed') services.fileHistory.recordMove(repositoryId, 'Rename item', [{ from: result.from, to: result.to }], 'rename');
      return result;
    });
  });
  handle(IPC.repositoryCreateEntry, 'create-entry', async (id, targetDirectory, name, kind) => {
    if (kind !== 'file' && kind !== 'directory') {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'create-entry', message: 'Invalid entry type.' });
    }
    const repositoryId = stringArg(id, 'create-entry', 64);
    return services.fileHistory.serialize(repositoryId, async () => {
      const result = await services.files.create(
      repositoryId,
      textArg(targetDirectory, 'create-entry', 32_768),
      stringArg(name, 'create-entry', 255),
      kind,
      );
      if (result.status === 'created') services.fileHistory.recordCreate(repositoryId, result.kind === 'directory' ? 'Create folder' : 'Create file', [{ path: result.path, kind: result.kind }]);
      return result;
    });
  });
  handle(IPC.repositoryFileHistoryState, 'file-history-state', (id) => services.fileHistory.state(stringArg(id, 'file-history-state', 64)));
  handle(IPC.repositoryUndoFileOperation, 'undo-file-operation', (id) => services.fileHistory.undo(stringArg(id, 'undo-file-operation', 64)));
  handle(IPC.repositoryRedoFileOperation, 'redo-file-operation', (id) => services.fileHistory.redo(stringArg(id, 'redo-file-operation', 64)));
  handle(IPC.diffGet, 'diff', (raw) => {
    const request = raw as Partial<DiffRequest>;
    return services.operations.diff({
      repositoryId: stringArg(request.repositoryId, 'diff', 64),
      path: stringArg(request.path, 'diff'),
      kind: request.kind === 'staged' ? 'staged' : 'unstaged',
    });
  });
  handle(IPC.diffCommit, 'commit-diff', (id, oid) => services.operations.commitDiff(stringArg(id, 'commit-diff', 64), stringArg(oid, 'commit-diff', 128)));
  handle(IPC.diffCommitFile, 'commit-file-diff', (id, oid, filePath, oldPath) => services.operations.commitFileDiff(
    stringArg(id, 'commit-file-diff', 64),
    stringArg(oid, 'commit-file-diff', 128),
    stringArg(filePath, 'commit-file-diff'),
    oldPath === undefined ? undefined : stringArg(oldPath, 'commit-file-diff'),
  ));
  handle(IPC.indexStage, 'stage', (id, paths) => services.operations.stage(stringArg(id, 'stage', 64), pathsArg(paths, 'stage')));
  handle(IPC.indexUnstage, 'unstage', (id, paths) => services.operations.unstage(stringArg(id, 'unstage', 64), pathsArg(paths, 'unstage')));
  handle(IPC.indexDiscard, 'discard', async (id, paths) => {
    const repositoryId = stringArg(id, 'discard', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(paths, 'discard'));
    const selected = new Set(validPaths);
    const status = await services.repositories.status(repositoryId, false);
    const untracked = status.changes.filter((change) => selected.has(change.path) && change.kind === 'untracked').map((change) => change.path);
    const tracked = validPaths.filter((filePath) => !untracked.includes(filePath));
    const confirmation = await dialog.showMessageBox(services.window, {
      type: 'warning',
      title: 'Discard changes',
      message: `Discard changes to ${validPaths.length === 1 ? 'this file' : `these ${validPaths.length} files`}?`,
      detail: untracked.length > 0
        ? 'Untracked files will be moved to the Recycle Bin. Other local changes will be lost.'
        : 'The selected local changes will be lost.',
      buttons: ['Discard', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return { ok: true };
    await services.operations.discard(repositoryId, tracked);
    for (const filePath of untracked) await shell.trashItem(services.repositories.resolvePath(repositoryId, filePath));
    return { ok: true };
  });
  handle(IPC.indexStageAll, 'stage-all', (id) => services.operations.stageAll(stringArg(id, 'stage-all', 64)));
  handle(IPC.indexUnstageAll, 'unstage-all', (id) => services.operations.unstageAll(stringArg(id, 'unstage-all', 64)));
  handle(IPC.indexPrepareCommitGroup, 'prepare-commit-group', (input) => services.operations.prepareCommitGroup(prepareCommitGroupArg(input, 'prepare-commit-group')));
  handle(IPC.indexResolveConflict, 'resolve-conflict', (id, filePath, content) => services.operations.resolveConflict(
    stringArg(id, 'resolve-conflict', 64),
    stringArg(filePath, 'resolve-conflict'),
    textArg(content, 'resolve-conflict', 8 * 1024 * 1024),
  ));
  handle(IPC.indexUpdateConflict, 'update-conflict', async (id, filePath, content) => services.operations.updateConflict(
    stringArg(id, 'update-conflict', 64),
    stringArg(filePath, 'update-conflict'),
    textArg(content, 'update-conflict', 8 * 1024 * 1024),
  ));
  handle(IPC.commitCreate, 'commit', (id, message) => services.operations.createCommit(stringArg(id, 'commit', 64), stringArg(message, 'commit', 100_000)));
  handle(IPC.commitUndoLatest, 'undo-latest-commit', (id, expectedOid) => services.operations.undoLatestCommit(
    stringArg(id, 'undo-latest-commit', 64),
    oidArg(expectedOid, 'undo-latest-commit'),
  ));
  handle(IPC.commitsList, 'history', (id, cursor) => services.operations.listCommits(stringArg(id, 'history', 64), cursor === undefined ? undefined : stringArg(cursor, 'history', 128)));
  handle(IPC.commitsFiles, 'commit-files', (id, oid) => services.operations.commitFiles(stringArg(id, 'commit-files', 64), stringArg(oid, 'commit-files', 128)));
  handle(IPC.branchesList, 'branches', (id) => services.operations.branches(stringArg(id, 'branches', 64)));
  handle(IPC.branchSwitch, 'switch-branch', (id, branch) => services.operations.switchBranch(stringArg(id, 'switch-branch', 64), stringArg(branch, 'switch-branch', 512)));
  handle(IPC.worktreesList, 'worktrees', (id) => services.operations.worktrees(stringArg(id, 'worktrees', 64)));
  handle(IPC.worktreeSelect, 'select-worktree', async (id, targetPath) => {
    const repository = await services.operations.selectWorktree(stringArg(id, 'select-worktree', 64), stringArg(targetPath, 'select-worktree'));
    services.watcher.start(repository); return repository;
  });
  handle(IPC.localRefsSnapshot, 'local-refs-snapshot', (id) => services.operations.localRefsSnapshot(stringArg(id, 'local-refs-snapshot', 64)));
  handle(IPC.branchDetails, 'branch-details', (request) => {
    const { repositoryId, fullName } = branchDetailsArg(request, 'branch-details');
    return services.operations.branchDetails(repositoryId, fullName);
  });
  handle(IPC.worktreeDetails, 'worktree-details', (request) => {
    const { repositoryId, path } = worktreeDetailsArg(request, 'worktree-details');
    return services.operations.worktreeDetails(repositoryId, path);
  });
  handle(IPC.branchDelete, 'delete-branch', (request) => {
    const { repositoryId, fullName, expectedOid, force } = deleteBranchArg(request, 'delete-branch');
    return services.operations.deleteLocalBranch(repositoryId, fullName, expectedOid, force);
  });
  handle(IPC.worktreeRemove, 'remove-worktree', (request) => {
    const { repositoryId, path, expectedOid, force, deleteBranch } = removeWorktreeArg(request, 'remove-worktree');
    return services.operations.removeWorktree(repositoryId, path, expectedOid, force, deleteBranch);
  });
  handle(IPC.refsPull, 'pull', (id) => services.operations.pull(stringArg(id, 'pull', 64)));
  handle(IPC.refsPush, 'push', (id) => services.operations.push(stringArg(id, 'push', 64)));
  handle(IPC.refsFetch, 'fetch', (id) => services.operations.fetch(stringArg(id, 'fetch', 64)));
  handle(IPC.aiStatuses, 'ai-statuses', (forceRefresh) => services.ai.statuses(booleanArg(forceRefresh, 'ai-statuses')));
  handle(IPC.aiGenerateCommitMessage, 'ai-generate-commit-message', (input) => services.ai.generate(generateCommitMessageArg(input)));
  handle(IPC.aiLog, 'ai-log', () => services.aiLog.list());
  handle(IPC.aiClearLog, 'ai-clear-log', () => services.aiLog.clear());
  handle(IPC.aiCancelGeneration, 'ai-cancel-generation', (requestId) => {
    services.ai.cancel(aiString(requestId, 'ai-cancel-generation', 100, true));
  });
  handle(IPC.githubStatus, 'gh-status', (forceRefresh) => services.github.status(booleanArg(forceRefresh, 'gh-status')));
  handle(IPC.githubRepositoryInfo, 'gh-repository-info', (id) => services.github.repositoryInfo(stringArg(id, 'gh-repository-info', 64)));
  handle(IPC.githubPrForBranch, 'gh-pr-for-branch', (id, branchName) => services.github.findPullRequestForBranch(
    stringArg(id, 'gh-pr-for-branch', 64),
    stringArg(branchName, 'gh-pr-for-branch', 512),
  ));
  handle(IPC.repositoryReplaceSearch, 'replace-search', (id, request) => {
    const repositoryId = stringArg(id, 'replace-search', 64);
    const input = searchReplaceArg(request, 'replace-search');
    return services.fileHistory.serialize(repositoryId, () => services.search.replace(repositoryId, input));
  });
  handle(IPC.githubPrList, 'gh-pr-list', (id, states) => services.github.listPullRequests(
    stringArg(id, 'gh-pr-list', 64),
    pullRequestStatesArg(states, 'gh-pr-list'),
  ));
  handle(IPC.githubPrView, 'gh-pr-view', (id, prNumber) => services.github.getPullRequest(stringArg(id, 'gh-pr-view', 64), prNumberArg(prNumber, 'gh-pr-view')));
  handle(IPC.githubPrDiff, 'gh-pr-diff', (id, prNumber) => services.github.getPullRequestDiff(stringArg(id, 'gh-pr-diff', 64), prNumberArg(prNumber, 'gh-pr-diff')));
  handle(IPC.githubPrCommitDiff, 'gh-pr-commit-diff', (id, oid) => services.github.getPullRequestCommitDiff(stringArg(id, 'gh-pr-commit-diff', 64), oidArg(oid, 'gh-pr-commit-diff')));
  handle(IPC.githubPrCreate, 'gh-pr-create', (input) => services.github.createPullRequest(createPullRequestArg(input)));
  handle(IPC.githubPrDraft, 'ai-pr-draft', (input) => services.prDrafts.generate(generatePullRequestDraftArg(input)));
  handle(IPC.githubPrDraftCancel, 'ai-pr-draft-cancel', (requestId) => {
    services.prDrafts.cancel(aiString(requestId, 'ai-pr-draft-cancel', 100, true));
  });

  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}

function samePathSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const normalize = (value: string) => process.platform === 'win32'
    ? value.replace(/[\\/]+$/, '').toLocaleLowerCase()
    : value.replace(/[\\/]+$/, '');
  return left.every((value, index) => normalize(value) === normalize(right[index]!));
}
