import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { DiffRequest, Preferences } from '../../shared/contracts';
import { IPC } from '../../shared/contracts';
import { GitOperationError } from '../../shared/errors';
import { OPEN_TIG_SERVER_COMMANDS, type OpenTigServerCommandDefinition } from '../../shared/protocol';
import { repositoryRootFromCommonDir } from '../../shared/repository-favicon';
import { readRepositoryFavicon } from '../files/RepositoryFavicon';
import { CommandRegistry, type CommandExecutionContext } from './CommandRegistry';
import type { OpenTigHost } from './OpenTigHost';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { aiString, booleanArg, branchDetailsArg, createPullRequestArg, deleteBranchArg, filesTreeStateArg, generateCommitMessageArg, generatePullRequestDraftArg, nullableProjectIdArg, oidArg, openFilesStateArg, pathsArg, prepareCommitGroupArg, prNumberArg, projectIdArg, projectNameArg, pullRequestStatesArg, removeWorktreeArg, repositoryKeyArg, searchOptionsArg, searchReplaceArg, stringArg, textArg, worktreeDetailsArg } from './validators';

export function registerServerCommands(
  registry: CommandRegistry,
  services: OpenTigRuntimeServices,
  host: OpenTigHost,
): void {
  const serverDefinitions = new Map<string, OpenTigServerCommandDefinition>(
    Object.values(OPEN_TIG_SERVER_COMMANDS).map((definition) => [definition.command, definition]),
  );
  const handleWithContext = <T>(
    channel: string,
    operation: string,
    handler: (context: CommandExecutionContext, ...args: unknown[]) => Promise<T> | T,
  ) => {
    const definition = serverDefinitions.get(channel);
    if (!definition) throw new Error(`Not a server command: ${channel}`);
    if (definition.operation !== operation) throw new Error(`Operation mismatch for ${channel}: ${operation}`);
    registry.registerHandler(definition, (context, args) => handler(context, ...args));
  };
  const handle = <T>(channel: string, operation: string, handler: (...args: unknown[]) => Promise<T> | T) => {
    handleWithContext(channel, operation, (_context, ...args) => handler(...args));
  };
  const openRepositoryPath = async (selectedPath: string, context: CommandExecutionContext) => {
    const repository = await openRuntimeRepositoryPath(services, selectedPath);
    fileClipboardState(context).pendingCut = null;
    return repository;
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
      performanceAutomation: process.env.OPENTIG_PERF_AUTOMATION === '1',
    };
  });
  handle(IPC.capabilities, 'capabilities', async () => {
    const [githubCli, aiProviders] = await Promise.all([
      services.github.status(),
      services.ai.statuses(),
    ]);
    return {
      runtimeMode: services.runtimeMode,
      platform: services.platform,
      systemTrash: services.trash.available,
      ...host.capabilities,
      githubCli,
      aiProviders,
    } as const;
  });
  handle(IPC.preferences, 'preferences', async (partial) => {
    const preferences = await services.settings.setPreferences((partial ?? {}) as Partial<Preferences>);
    host.preferencesChanged(preferences);
    return preferences;
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
  handleWithContext(IPC.repositoryOpenPath, 'open-path', (context, selectedPath) => openRepositoryPath(
    stringArg(selectedPath, 'open-path', 32_768), context,
  ));
  handleWithContext(IPC.repositoryOpenRecent, 'open-recent', async (context, id) => {
    const repositoryId = stringArg(id, 'open-recent', 64);
    const repository = await services.repositories.openRecent(repositoryId);
    fileClipboardState(context).pendingCut = null;
    services.watcher.start(repository);
    services.events.activeRepositoryChanged(repository);
    return repository;
  });
  handleWithContext(IPC.repositoryRelocateRecent, 'relocate-recent', async (context, id, selectedPath) => {
    const repository = await services.repositories.relocateRecent(
      stringArg(id, 'relocate-recent', 64),
      stringArg(selectedPath, 'relocate-recent', 32_768),
    );
    fileClipboardState(context).pendingCut = null;
    services.watcher.start(repository);
    services.events.activeRepositoryChanged(repository);
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
  handle(IPC.repositoryGetFavicon, 'favicon', (id) => {
    const repository = services.repositories.get(stringArg(id, 'favicon', 64));
    return readRepositoryFavicon(repositoryRootFromCommonDir(repository.commonDir));
  });
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
  handleWithContext(IPC.repositoryCopyEntries, 'copy-entries', async (context, id, rawPaths) => {
    const repositoryId = stringArg(id, 'copy-entries', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(rawPaths, 'copy-entries'));
    const absolutePaths = validPaths.map((filePath) => services.repositories.resolvePath(repositoryId, filePath));
    await Promise.all(absolutePaths.map((filePath) => lstat(filePath)));
    fileClipboardState(context).pendingCut = null;
    return { copied: absolutePaths.length, paths: absolutePaths };
  });
  handleWithContext(IPC.repositoryCutEntries, 'cut-entries', async (context, id, rawPaths) => {
    const repositoryId = stringArg(id, 'cut-entries', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(rawPaths, 'cut-entries'));
    const absolutePaths = validPaths.map((filePath) => services.repositories.resolvePath(repositoryId, filePath));
    await Promise.all(absolutePaths.map((filePath) => lstat(filePath)));
    const transferId = randomUUID();
    fileClipboardState(context).pendingCut = { paths: absolutePaths, transferId };
    return { cut: absolutePaths.length, paths: absolutePaths, transferId };
  });
  handleWithContext(IPC.repositoryPasteEntries, 'paste-entries', async (context, id, targetDirectory, rawSourcePaths, rawCutTransferId, rawImagePng) => {
    const repositoryId = stringArg(id, 'paste-entries', 64);
    const destination = textArg(targetDirectory, 'paste-entries', 32_768);
    const filePaths = pathsArg(rawSourcePaths, 'paste-entries');
    const cutTransferId = rawCutTransferId == null ? null : stringArg(rawCutTransferId, 'paste-entries', 64);
    const imagePng = clipboardImageArg(rawImagePng);
    return services.fileHistory.serialize(repositoryId, async () => {
      if (filePaths.length > 0) {
        const clipboardState = fileClipboardState(context);
        if (clipboardState.pendingCut?.transferId === cutTransferId && samePathSelection(filePaths, clipboardState.pendingCut.paths)) {
          const sources = [...clipboardState.pendingCut.paths];
          const repository = services.repositories.get(repositoryId);
          const created = await services.files.movePaths(repositoryId, sources, destination);
          clipboardState.pendingCut = null;
          const pairs = created.map((to, index) => ({ from: sources[index]!.slice(repository.path.length + 1).replace(/\\/g, '/'), to }));
          services.fileHistory.recordMove(repositoryId, created.length === 1 ? 'Move item' : `Move ${created.length} items`, pairs);
          return { status: 'pasted', source: 'cut', created } as const;
        }
        clipboardState.pendingCut = null;
        const created = await services.files.pastePaths(repositoryId, filePaths, destination);
        services.fileHistory.recordPaste(repositoryId, { label: created.length === 1 ? 'Paste item' : `Paste ${created.length} items`, created, sources: created.map((to, index) => ({ source: filePaths[index]!, destination: to })) });
        return { status: 'pasted', source: 'files', created } as const;
      }
      fileClipboardState(context).pendingCut = null;
      if (imagePng) {
        const created = await services.files.pasteImage(repositoryId, destination, imagePng);
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
    await lstat(target);
    return services.fileHistory.serialize(repositoryId, async () => {
      const prepared = await services.fileHistory.prepareDelete(repositoryId, [relativePath]);
      await services.trash.trashItem(target);
      services.fileHistory.recordDelete(repositoryId, prepared, [relativePath]);
      return { deleted: true } as const;
    });
  });
  handle(IPC.repositoryDeleteEntries, 'delete-entries', async (id, rawPaths) => {
    const repositoryId = stringArg(id, 'delete-entries', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(rawPaths, 'delete-entries'));
    if (validPaths.length === 0) return { deleted: 0 } as const;
    const targets = validPaths.map((filePath) => services.repositories.resolvePath(repositoryId, filePath));
    return services.fileHistory.serialize(repositoryId, async () => {
      const prepared = await services.fileHistory.prepareDelete(repositoryId, validPaths);
      const deletedPaths: string[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]!;
        // A selection can include both a folder and files inside it; the folder is
        // trashed first, so skip any target that no longer exists.
        try { await lstat(target); } catch { continue; }
        try { await services.trash.trashItem(target); }
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
    await services.operations.discard(repositoryId, tracked);
    for (const filePath of untracked) await services.trash.trashItem(services.repositories.resolvePath(repositoryId, filePath));
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
  handle(IPC.branchSwitch, 'switch-branch', (id, branch, moveChanges) => services.operations.switchBranch(
    stringArg(id, 'switch-branch', 64),
    stringArg(branch, 'switch-branch', 512),
    booleanArg(moveChanges, 'switch-branch'),
  ));
  handle(IPC.worktreesList, 'worktrees', (id) => services.operations.worktrees(stringArg(id, 'worktrees', 64)));
  handle(IPC.worktreeSelect, 'select-worktree', async (id, targetPath) => {
    const repository = await services.operations.selectWorktree(stringArg(id, 'select-worktree', 64), stringArg(targetPath, 'select-worktree'));
    services.watcher.start(repository);
    services.events.activeRepositoryChanged(repository);
    return repository;
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
  handleWithContext(IPC.aiGenerateCommitMessage, 'ai-generate-commit-message', (context, input) => (
    services.ai.generate(generateCommitMessageArg(input), context.signal)
  ));
  handle(IPC.aiLog, 'ai-log', () => services.aiLog.list());
  handle(IPC.aiClearLog, 'ai-clear-log', () => services.aiLog.clear());
  handle(IPC.diagnosticsList, 'diagnostics-list', () => services.problems.list());
  handle(IPC.diagnosticsClear, 'diagnostics-clear', () => services.problems.clear());
  handle(IPC.diagnosticsRecord, 'diagnostics-record', (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const input = entry as { operation?: unknown; message?: unknown; level?: unknown; code?: unknown; repositoryId?: unknown };
    if (typeof input.operation !== 'string' || typeof input.message !== 'string') return;
    services.problems.record({
      source: 'client',
      operation: input.operation,
      message: input.message,
      ...(typeof input.level === 'string' ? { level: input.level as 'error' | 'warn' } : {}),
      ...(typeof input.code === 'string' || input.code === null ? { code: input.code } : {}),
      ...(typeof input.repositoryId === 'string' || input.repositoryId === null ? { repositoryId: input.repositoryId } : {}),
    });
  });
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
  handleWithContext(IPC.githubPrDraft, 'ai-pr-draft', (context, input) => (
    services.prDrafts.generate(generatePullRequestDraftArg(input), context.signal)
  ));
  handle(IPC.githubPrDraftCancel, 'ai-pr-draft-cancel', (requestId) => {
    services.prDrafts.cancel(aiString(requestId, 'ai-pr-draft-cancel', 100, true));
  });

  const registered = new Set(registry.registeredCommands());
  for (const definition of serverDefinitions.values()) {
    if (!registered.has(definition.command)) throw new Error(`Missing server handler: ${definition.command}`);
  }
}

/** Shared repository-open lifecycle used by authenticated commands and CLI bootstrap. */
export async function openRuntimeRepositoryPath(services: OpenTigRuntimeServices, selectedPath: string) {
  const repository = await services.repositories.openPath(selectedPath);
  services.watcher.start(repository);
  services.events.activeRepositoryChanged(repository);
  return repository;
}

export const FILE_CLIPBOARD_SESSION_STATE = 'file-clipboard';
interface FileClipboardSessionState { pendingCut: { paths: string[]; transferId: string } | null }

function fileClipboardState(context: CommandExecutionContext): FileClipboardSessionState {
  return context.state(FILE_CLIPBOARD_SESSION_STATE, () => ({ pendingCut: null }));
}

function samePathSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const normalize = (value: string) => process.platform === 'win32'
    ? value.replace(/[\\/]+$/, '').toLocaleLowerCase()
    : value.replace(/[\\/]+$/, '');
  return left.every((value, index) => normalize(value) === normalize(right[index]!));
}

function clipboardImageArg(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-entries', message: 'Invalid clipboard image.' });
}
