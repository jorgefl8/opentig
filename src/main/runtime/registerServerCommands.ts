import { CloneJobs } from '../git/RepositoryClone';
import type { RepositorySnapshotPart } from '../persistence/RepositorySnapshotStore';
import { setGlobalGitIdentity } from '../git/GitGlobalIdentity';
import { githubAccountSelectionSchema } from '../../shared/github-accounts';
import { commitAuthorshipInputSchema } from '../../shared/commit-authorship';
import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ClientAttachment, DiffRequest, Preferences, RepositoryInfo } from '../../shared/contracts';
import { IPC } from '../../shared/contracts';
import { aiExecutablePathsKey } from '../../shared/ai-status';
import { GitOperationError } from '../../shared/errors';
import { isRepositoryMutation, OPEN_TIG_SERVER_COMMANDS, type OpenTigServerCommandDefinition } from '../../shared/protocol';
import { repositoryRootFromCommonDir } from '../../shared/repository-favicon';
import { readRepositoryFavicon } from '../files/RepositoryFavicon';
import { browseServerDirectories } from '../files/ServerDirectoryBrowser';
import { planUntrackedTrash, readUntrackedTrashLayout, removeEmptyParents } from '../git/untracked-trash';
import { CommandRegistry, type CommandExecutionContext } from './CommandRegistry';
import type { OpenTigHost } from './OpenTigHost';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { aiString, booleanArg, branchDetailsArg, commentOnPullRequestArg, createPullRequestArg, createReleaseArg, deleteBranchArg, deleteDraftReleaseArg, deletePullRequestEntryArg, editPullRequestEntryArg, filesTreeStateArg, generateCommitMessageArg, generatePullRequestDraftArg, nullableProjectIdArg, oidArg, openFilesStateArg, prNumbersArg, pathsArg, prepareCommitGroupArg, prNumberArg, publishBranchArg, projectIdArg, projectNameArg, publishReleaseArg, pullRequestActionArg, pullRequestRangeArg, pullRequestStatesArg, reviewPullRequestArg, runWorkflowArg, updatePullRequestArg, workflowPathArg, githubIdArg, runPageArg, removeWorktreeArg, repositoryKeyArg, searchOptionsArg, searchReplaceArg, stringArg, tagNameArg, textArg, updateReleaseArg, worktreeDetailsArg } from './validators';
import { bootstrapRequestArg, createTrackingBranchArg, deleteRemoteBranchArg, orderingIndexArg } from './validators';

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
    registry.registerHandler(definition, async (context, args) => {
      // Include filesystem-only mutations, which do not pass through Git's write queue.
      const first = args[0];
      const repositoryId = typeof first === 'object' && first !== null && 'repositoryId' in first ? first.repositoryId : first;
      if (isRepositoryMutation(channel)) services.repositories.invalidateIfKnown(repositoryId);
      try { return await handler(context, ...args); }
      finally { if (isRepositoryMutation(channel)) services.repositories.invalidateIfKnown(repositoryId); }
    });
  };
  const handle = <T>(channel: string, operation: string, handler: (...args: unknown[]) => Promise<T> | T) => {
    handleWithContext(channel, operation, (_context, ...args) => handler(...args));
  };
  /** Saves what a read found as the repository's last known state (see `RepositorySnapshotStore`). */
  const remember = async <T>(repositoryId: string, part: RepositorySnapshotPart, read: Promise<T>): Promise<T> => {
    const value = await read;
    try { services.snapshots?.record(repositoryId, services.repositories.get(repositoryId).path, part, value); }
    catch { /* Saving is best effort; the read itself succeeded. */ }
    return value;
  };
  /**
   * What each connection cut, waiting to be pasted: one tab's cut is never another's, though the tabs
   * of one browser share a session. Kept while the connection is open; a caller without one keeps it
   * with its session.
   */
  const clipboards = new Map<string, FileClipboardSessionState>();
  const fileClipboardState = (context: CommandExecutionContext): FileClipboardSessionState => {
    const connectionId = context.connectionId;
    if (!connectionId) return context.state(FILE_CLIPBOARD_SESSION_STATE, () => ({ pendingCut: null }));
    let state = clipboards.get(connectionId);
    if (!state) {
      state = { pendingCut: null };
      // A request that outlived its connection keeps nothing.
      if (services.clients.isConnected(connectionId)) clipboards.set(connectionId, state);
    }
    return state;
  };
  /**
   * Runs an open for the client that asked: the repository becomes the one its connection has open,
   * and no other client's. Of two opens on one connection, the one asked for last wins.
   */
  const openForClient = async (context: CommandExecutionContext, open: () => Promise<RepositoryInfo>): Promise<RepositoryInfo & { attachment?: ClientAttachment }> => {
    const ticket = services.clients.beginOpen(context.connectionId);
    const repository = await open();
    fileClipboardState(context).pendingCut = null;
    const attachment = services.clients.attach(context.connectionId, repository, ticket, { afterAnswer: (task) => context.afterAnswer(task) });
    // Whether it took, and where the server has the connection (see `ClientAttachment`); older clients ignore it.
    return context.connectionId ? { ...repository, attachment } : repository;
  };
  const openRepositoryPath = (selectedPath: string, context: CommandExecutionContext) => openForClient(
    context, () => openRuntimeRepositoryPath(services, selectedPath),
  );

  handle(IPC.gitStatus, 'git-status', () => services.git.status());
  handle(IPC.completeOnboarding, 'complete-onboarding', () => services.settings.completeOnboarding());
  handle(IPC.gitSetGlobalIdentity, 'git-identity-set', (input) => setGlobalGitIdentity(services.git, input));
  // Resolved per clone: GitHub services are optional for this command set.
  const clones = new CloneJobs(services.git, (destination) => services.repositories.preparePath(destination), {
    run: async (cwd, url, task) => {
      const gitAccess = services.github?.gitAccess;
      return gitAccess ? gitAccess.withCloneCredentials(cwd, url, task) : { value: await task([], {}, null), adopted: null };
    },
    adopt: (repository, login) => services.github.accounts.setSelection(repository, { mode: 'account', host: 'github.com', login, detected: true },
      { login, previousLogin: services.github.accounts.defaultLogin() }),
  });
  handle(IPC.repositoryClone, 'clone-repository', (raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid clone request.');
    const value = raw as Record<string, unknown>;
    return clones.start({ url: stringArg(value.url, 'clone-repository', 4096), parentPath: stringArg(value.parentPath, 'clone-repository', 32768), folderName: stringArg(value.folderName, 'clone-repository', 150) });
  });
  handle(IPC.repositoryCloneStatus, 'clone-status', (id) => clones.get(stringArg(id, 'clone-status', 100)));
  handle(IPC.repositoryCancelClone, 'cancel-clone', (id) => clones.cancel(stringArg(id, 'cancel-clone', 100)));

  handleWithContext(IPC.bootstrap, 'bootstrap', async (context, request) => {
    const { repositoryId: requestedId } = bootstrapRequestArg(request);
    const ticket = services.clients.beginOpen(context.connectionId);
    // A client asks for the repository it was on, after a reload or a dropped connection: it opens
    // for this client only, and changes nothing saved. One this server does not know, or cannot open,
    // gives the repository opened last, as a client asking for none gets.
    // A repository relocated since the client last saw it is asked for by its old id.
    const wantedId = requestedId ? services.repositories.relocatedId(requestedId) : null;
    let activeRepository: RepositoryInfo | null = null;
    if (wantedId && context.connectionId && services.repositories.recent(wantedId)) {
      activeRepository = await services.repositories.openKnown(wantedId).catch(() => null);
    }
    activeRepository ??= await services.repositories.restore();
    const attachment = activeRepository ? services.clients.attach(context.connectionId, activeRepository, ticket, { afterAnswer: (task) => context.afterAnswer(task) }) : null;
    const unavailableRepositoryIds = await services.repositories.unavailableIds();
    const activeId = services.settings.activeRepositoryId;
    const missingId = [wantedId, activeId].find((id) => id && unavailableRepositoryIds.includes(id));
    // Last, with nothing awaited after it: no newer news of the watch can reach the client before this answer.
    const activeRepositoryWatch = activeRepository ? services.clients.watch(context.connectionId, activeRepository.id) : undefined;
    const relocatedRepositoryIds = services.repositories.relocatedIds();
    return {
      ...(attachment && context.connectionId ? { attachment } : {}),
      ...(Object.keys(relocatedRepositoryIds).length > 0 ? { relocatedRepositoryIds } : {}),
      unavailableRepositoryIds,
      unavailableActiveRepositoryId: !activeRepository && missingId ? missingId : null,
      onboardingVersion: services.settings.onboardingVersion,
      ...(activeRepositoryWatch ? { activeRepositoryWatch } : {}),
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
    const previousPaths = aiExecutablePathsKey(services.settings.preferences.aiExecutablePaths);
    const preferences = await services.settings.setPreferences((partial ?? {}) as Partial<Preferences>);
    if (previousPaths !== aiExecutablePathsKey(preferences.aiExecutablePaths)) services.ai.invalidateStatuses();
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
  handle(IPC.projectMove, 'project-move', (projectId, toIndex) => services.settings.moveRepositoryProject(projectIdArg(projectId, 'project-move'), orderingIndexArg(toIndex, 'project-move')));
  handle(IPC.projectMoveRepository, 'project-move-repository', (repositoryKey, toIndex) => services.settings.moveRepository(repositoryKeyArg(repositoryKey, 'project-move-repository'), orderingIndexArg(toIndex, 'project-move-repository')));
  handle(IPC.repositoryPreparePath, 'prepare-path', path => services.repositories.preparePath(stringArg(path, 'prepare-path', 32_768)));
  handleWithContext(IPC.repositoryCompleteSetup, 'complete-setup', async (context, id, revision) => {
    const repositoryId = stringArg(id, 'complete-setup', 64);
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'complete-setup', message: 'Invalid account revision.' });
    return openForClient(context, () => services.repositories.completeSetup(repositoryId, () => {
      if (revision !== services.github.accounts.revisionFor(services.repositories.get(repositoryId))) {
        throw new Error('The repository account changed. Reload setup and review it again.');
      }
    }));
  });
  handleWithContext(IPC.repositoryOpenPath, 'open-path', (context, selectedPath) => openRepositoryPath(
    stringArg(selectedPath, 'open-path', 32_768), context,
  ));
  handle(IPC.repositoryBrowseDirectories, 'browse-directories', (path) => browseServerDirectories(
    path === undefined ? undefined : stringArg(path, 'browse-directories', 32_768),
    services.git,
  ));
  handleWithContext(IPC.repositoryOpenRecent, 'open-recent', async (context, id) => {
    const repositoryId = stringArg(id, 'open-recent', 64);
    return openForClient(context, () => services.repositories.openRecent(repositoryId));
  });
  handleWithContext(IPC.repositoryForget, 'forget-repository', async (context, repositoryKey) => {
    const before = services.repositories.recents().map((item) => item.id);
    const organization = await services.repositories.forget(repositoryKeyArg(repositoryKey, 'forget-repository'));
    fileClipboardState(context).pendingCut = null;
    const remaining = new Set(services.repositories.recents().map((item) => item.id));
    services.clients.forget(before.filter((repositoryId) => !remaining.has(repositoryId)));
    services.snapshots?.forgetUnknown();
    return organization;
  });
  /** A repository moved and has a new id: every client on the old one follows it there. */
  const followRelocation = (previousId: string, repository: RepositoryInfo, except?: string) => {
    if (previousId === repository.id) return;
    services.clients.move([previousId], repository, { reason: 'relocated', recentRepositories: services.repositories.recents(), except });
    services.clients.forget([previousId]);
  };
  handleWithContext(IPC.repositoryRelocateRecent, 'relocate-recent', async (context, id, selectedPath) => {
    const repositoryId = stringArg(id, 'relocate-recent', 64);
    const selected = stringArg(selectedPath, 'relocate-recent', 32_768);
    const repository = await openForClient(context, () => services.repositories.relocateRecent(repositoryId, selected));
    followRelocation(repositoryId, repository, context.connectionId);
    return repository;
  });
  handle(IPC.repositoryUnavailableRecent, 'unavailable-recent', () => services.repositories.unavailableIds());
  handle(IPC.repositoryFindRelocations, 'find-relocations', (previousPath, selectedPath) => services.repositories.findRelocations(
    stringArg(previousPath, 'find-relocations', 32_768),
    stringArg(selectedPath, 'find-relocations', 32_768),
  ));
  handle(IPC.repositoryRelocateRecents, 'relocate-recents', async (raw) => {
    if (!Array.isArray(raw) || raw.length > 500) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'relocate-recents', message: 'Invalid relocation list.' });
    const result = await services.repositories.relocateMany(raw.map((entry: unknown) => {
      const value = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return { id: stringArg(value.id, 'relocate-recents', 64), path: stringArg(value.path, 'relocate-recents', 32_768) };
    }));
    for (const { previousId, repository } of result.relocated) followRelocation(previousId, repository);
    return result;
  });
  handle(IPC.repositoryStatus, 'status', (id, includeStats) => remember(stringArg(id, 'status', 64), 'status', services.repositories.status(
    stringArg(id, 'status', 64),
    includeStats === undefined ? true : booleanArg(includeStats, 'status'),
  )));
  handle(IPC.repositoryFiles, 'files', (id) => remember(stringArg(id, 'files', 64), 'files', services.files.list(stringArg(id, 'files', 64))));
  handle(IPC.repositorySnapshot, 'repository-snapshot', async (id) => {
    const repositoryId = stringArg(id, 'repository-snapshot', 64);
    if (!services.snapshots || !services.repositories.isKnown(repositoryId)) return null;
    return services.snapshots.get(repositoryId, services.repositories.get(repositoryId).path);
  });
  handle(IPC.repositorySearch, 'search', (id, options) => services.search.search(
    stringArg(id, 'search', 64),
    searchOptionsArg(options, 'search'),
  ));
  handle(IPC.repositoryDirectoryEntries, 'directory-entries', (id, directoryPath) => services.files.listDirectory(
    stringArg(id, 'directory-entries', 64),
    directoryPath === '' ? '' : stringArg(directoryPath, 'directory-entries'),
  ));
  // Reads a client may stop (see `cancel` in the WebSocket protocol) take the request's signal.
  handleWithContext(IPC.repositoryReadFile, 'read-file', async (context, id, filePath, allowLarge) => {
    const repositoryId = stringArg(id, 'read-file', 64);
    const relativePath = stringArg(filePath, 'read-file');
    // Asked before reading: a watch that started meanwhile may not have seen a change made before it.
    // A linked file is watched where the link is, not where its content is: its reads are never said to be covered.
    const covered = services.clients.covers(context.connectionId, repositoryId, relativePath);
    const watchId = covered && !(await services.files.isLinked(repositoryId, relativePath)) ? covered : null;
    return { ...await services.files.read(repositoryId, relativePath, allowLarge === true, context.signal), ...(watchId ? { watchId } : {}) };
  });
  handle(IPC.repositoryLineBlame, 'line-blame', (id, filePath, draft) => services.operations.lineBlame(
    stringArg(id, 'line-blame', 64),
    stringArg(filePath, 'line-blame'),
    draft === undefined || draft === null ? undefined : textArg(draft, 'line-blame', 8 * 1024 * 1024),
  ));
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
    fileClipboardState(context).pendingCut = { repositoryId, paths: absolutePaths, transferId };
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
        // A cut moves only within the repository it was made in; anywhere else it pastes a copy.
        if (clipboardState.pendingCut?.transferId === cutTransferId && clipboardState.pendingCut.repositoryId === repositoryId
          && samePathSelection(filePaths, clipboardState.pendingCut.paths)) {
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
  handleWithContext(IPC.diffGet, 'diff', async (context, raw) => {
    const request = raw as Partial<DiffRequest>;
    const repositoryId = stringArg(request.repositoryId, 'diff', 64);
    const diffPath = stringArg(request.path, 'diff');
    const watchId = services.clients.covers(context.connectionId, repositoryId, diffPath);
    return { ...await services.operations.diff({ repositoryId, path: diffPath, kind: request.kind === 'staged' ? 'staged' : 'unstaged' }, context.signal), ...(watchId ? { watchId } : {}) };
  });
  handleWithContext(IPC.diffCommit, 'commit-diff', (context, id, oid) => services.operations.commitDiff(stringArg(id, 'commit-diff', 64), stringArg(oid, 'commit-diff', 128), context.signal));
  handleWithContext(IPC.diffCommitFile, 'commit-file-diff', (context, id, oid, filePath, oldPath) => services.operations.commitFileDiff(
    stringArg(id, 'commit-file-diff', 64),
    stringArg(oid, 'commit-file-diff', 128),
    stringArg(filePath, 'commit-file-diff'),
    oldPath === undefined ? undefined : stringArg(oldPath, 'commit-file-diff'),
    context.signal,
  ));
  handle(IPC.indexStage, 'stage', (id, paths) => services.operations.stage(stringArg(id, 'stage', 64), pathsArg(paths, 'stage')));
  handle(IPC.indexUnstage, 'unstage', (id, paths) => services.operations.unstage(stringArg(id, 'unstage', 64), pathsArg(paths, 'unstage')));
  handle(IPC.indexDiscard, 'discard', async (id, paths) => {
    const repositoryId = stringArg(id, 'discard', 64);
    const validPaths = services.repositories.validatePaths(repositoryId, pathsArg(paths, 'discard'));
    const selected = new Set(validPaths);
    const status = await services.repositories.status(repositoryId, false);
    const allUntracked = status.changes.filter((change) => change.kind === 'untracked').map((change) => change.path);
    const untracked = allUntracked.filter((filePath) => selected.has(filePath));
    const untrackedSet = new Set(untracked);
    const tracked = validPaths.filter((filePath) => !untrackedSet.has(filePath));
    await services.operations.discard(repositoryId, tracked);
    if (untracked.length === 0) return { ok: true };
    const root = services.repositories.get(repositoryId).path;
    const plan = planUntrackedTrash({ selected: untracked, untracked: allUntracked, layout: await readUntrackedTrashLayout(services.git, root) });
    for (const target of plan.targets) await services.trash.trashItem(services.repositories.resolvePath(repositoryId, target));
    await removeEmptyParents(root, plan.targets);
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
  handle(IPC.commitAuthorship, 'commit-authorship-read', (id) => services.operations.getCommitAuthorship(stringArg(id, 'commit-authorship-read', 64)));
  handle(IPC.commitSetAuthorship, 'commit-authorship-set', async (id, input) => {
    const repositoryId = stringArg(id, 'commit-authorship-set', 64);
    const parsed = commitAuthorshipInputSchema.safeParse(input);
    if (!parsed.success) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'commit-authorship-set', message: 'Enter a valid name, email and reviewed identity.' });
    const result = await services.operations.setCommitAuthorship(repositoryId, parsed.data);
    const repository = services.repositories.get(repositoryId);
    const ids = new Set([repositoryId, ...services.repositories.recents().filter((item) => item.commonDir === repository.commonDir).map((item) => item.id)]);
    for (const siblingId of ids) services.events.repositoryChanged(siblingId, 'unknown');
    return result;
  });
  handle(IPC.commitUndoLatest, 'undo-latest-commit', (id, expectedOid) => services.operations.undoLatestCommit(
    stringArg(id, 'undo-latest-commit', 64),
    oidArg(expectedOid, 'undo-latest-commit'),
  ));
  handle(IPC.commitsList, 'history', (id, cursor) => services.operations.listCommits(stringArg(id, 'history', 64), cursor === undefined ? undefined : stringArg(cursor, 'history', 128)));
  handleWithContext(IPC.commitsFileHistory, 'file-history', (context, id, filePath, cursor) => services.operations.fileHistory(
    stringArg(id, 'file-history', 64),
    stringArg(filePath, 'file-history'),
    cursor === undefined ? undefined : stringArg(cursor, 'file-history', 160),
    context.signal,
  ));
  handleWithContext(IPC.commitsFiles, 'commit-files', (context, id, oid) => services.operations.commitFiles(stringArg(id, 'commit-files', 64), stringArg(oid, 'commit-files', 128), context.signal));
  handle(IPC.commitsRecognize, 'commit-recognize', (id, oid, localOnly) => services.operations.recognizeCommit(stringArg(id, 'commit-recognize', 64), stringArg(oid, 'commit-recognize', 128), { localOnly: localOnly === true }));
  handle(IPC.commitsCountAfter, 'commits-after', (id, oid) => services.operations.commitsAfter(stringArg(id, 'commits-after', 64), oidArg(oid, 'commits-after')));
  handle(IPC.branchesList, 'branches', (id) => remember(stringArg(id, 'branches', 64), 'branches', services.operations.branches(stringArg(id, 'branches', 64))));
  handle(IPC.branchSwitch, 'switch-branch', (id, branch, moveChanges, allowAgents) => services.operations.switchBranch(
    stringArg(id, 'switch-branch', 64),
    stringArg(branch, 'switch-branch', 512),
    booleanArg(moveChanges, 'switch-branch'),
    allowAgents === undefined ? false : booleanArg(allowAgents, 'switch-branch'),
  ));
  handle(IPC.worktreesList, 'worktrees', (id) => remember(stringArg(id, 'worktrees', 64), 'worktrees', services.operations.worktrees(stringArg(id, 'worktrees', 64))));
  handle(IPC.worktreeAgents, 'worktree-agents', (id) => services.operations.worktreeAgents(stringArg(id, 'worktree-agents', 64)));
  handleWithContext(IPC.worktreeSelect, 'select-worktree', (context, id, targetPath) => {
    const repositoryId = stringArg(id, 'select-worktree', 64);
    const target = stringArg(targetPath, 'select-worktree');
    return openForClient(context, () => services.operations.selectWorktree(repositoryId, target));
  });
  handle(IPC.localRefsSnapshot, 'local-refs-snapshot', (id) => services.operations.localRefsSnapshot(stringArg(id, 'local-refs-snapshot', 64)));
  handle(IPC.branchDetails, 'branch-details', (request) => {
    const { repositoryId, fullName } = branchDetailsArg(request, 'branch-details');
    return services.operations.branchDetails(repositoryId, fullName);
  });
  handle(IPC.remoteBranchDetails, 'remote-branch-details', (request) => {
    const { repositoryId, fullName } = branchDetailsArg(request, 'remote-branch-details');
    return services.operations.remoteBranchDetails(repositoryId, fullName);
  });
  handle(IPC.trackingBranchCreate, 'create-tracking-branch', (request) => services.operations.createTrackingBranch(createTrackingBranchArg(request)));
  handle(IPC.remoteBranchDelete, 'delete-remote-branch', (request) => services.operations.deleteRemoteBranch(deleteRemoteBranchArg(request)));
  handle(IPC.branchesFetch, 'fetch-branches', (id) => services.operations.fetchBranches(stringArg(id, 'fetch-branches', 64)));
  handle(IPC.worktreeDetails, 'worktree-details', (request) => {
    const { repositoryId, path } = worktreeDetailsArg(request, 'worktree-details');
    return services.operations.worktreeDetails(repositoryId, path);
  });
  handle(IPC.branchDelete, 'delete-branch', (request) => {
    const { repositoryId, fullName, expectedOid, force } = deleteBranchArg(request, 'delete-branch');
    return services.operations.deleteLocalBranch(repositoryId, fullName, expectedOid, force);
  });
  handleWithContext(IPC.worktreeRemove, 'remove-worktree', async (context, request) => {
    const { repositoryId, path, expectedOid, force, deleteBranch, cleanupOnly } = removeWorktreeArg(request, 'remove-worktree');
    const { commonDir } = services.repositories.get(repositoryId);
    const siblingIds = new Set([repositoryId, ...services.repositories.recents().filter((item) => item.commonDir === commonDir).map((item) => item.id)]);
    try {
      return await services.operations.removeWorktree(repositoryId, path, expectedOid, force, deleteBranch, { signal: context.signal, ...(cleanupOnly === undefined ? {} : { cleanupOnly }) });
    } finally {
      // The caller's own worktree is never removed. Another tab, window or device on the removed one moves to
      // the main worktree, or to the caller's when that is not saved, once the removal is over, so one that
      // opened it meanwhile is moved too, and no longer finds it among the saved repositories.
      const remaining = new Set(services.repositories.recents().map((item) => item.id));
      const removed = [...siblingIds].filter((siblingId) => !remaining.has(siblingId));
      if (removed.length > 0) {
        const main = services.settings.mainWorktree(commonDir);
        const target = main && remaining.has(main.id) ? services.repositories.get(main.id) : remaining.has(repositoryId) ? services.repositories.get(repositoryId) : null;
        if (target) services.clients.move(removed, target, { reason: 'removed', recentRepositories: services.repositories.recents(), except: context.connectionId });
        services.clients.forget(removed);
      }
      // Whoever asked may have stopped waiting long ago, and siblings list the same worktrees.
      for (const siblingId of siblingIds) services.events.repositoryChanged(siblingId, 'worktrees');
    }
  });
  handle(IPC.refsPull, 'pull', (id) => services.operations.pull(stringArg(id, 'pull', 64)));
  handle(IPC.refsPushContext, 'push-context', (id, remote) => services.operations.publicationContext(stringArg(id, 'push-context', 64), remote == null ? undefined : stringArg(remote, 'push-context', 512)));
  handle(IPC.refsPush, 'push', (id, publish, expected) => services.operations.push(stringArg(id, 'push', 64), publishBranchArg(publish), expected == null ? undefined : stringArg(expected, 'push', 64)));
  handle(IPC.refsFetch, 'fetch', (id) => services.operations.fetch(stringArg(id, 'fetch', 64)));
  handle(IPC.aiRepositoryInstructions, 'ai-repository-instructions', (id) => services.aiInstructions.status(stringArg(id, 'ai-repository-instructions', 64)));
  handle(IPC.aiSetRepositoryInstructions, 'ai-set-repository-instructions', async (id, enabled) => {
    const repositoryId = stringArg(id, 'ai-set-repository-instructions', 64);
    if (typeof enabled !== 'boolean') throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'ai-set-repository-instructions', message: 'Invalid instructions setting.' });
    const result = await services.aiInstructions.setEnabled(repositoryId, enabled);
    services.events.aiInstructionsChanged(services.repositories.get(repositoryId).commonDir);
    return result;
  });
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
  handle(IPC.githubAccountsStatus, 'gh-accounts-status', (forceRefresh) => services.github.accounts.status(booleanArg(forceRefresh, 'gh-accounts-status')));
  handle(IPC.githubSetDefaultAccount, 'gh-set-default-account', (login) => services.github.accounts.setDefaultAccount(stringArg(login, 'gh-set-default-account', 39)));
  handle(IPC.githubRepositoryAccount, 'gh-repository-account', (id, forceRefresh) => services.github.repositoryAccount(stringArg(id, 'gh-repository-account', 64), booleanArg(forceRefresh, 'gh-repository-account')));
  handle(IPC.githubSetRepositoryAccount, 'gh-set-repository-account', (id, selection, expectedRevision) => {
    const parsed = githubAccountSelectionSchema.safeParse(selection);
    if (expectedRevision !== undefined && (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'gh-set-repository-account', message: 'Invalid account revision.' });
    if (!parsed.success) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'gh-set-repository-account', message: 'Invalid GitHub account selection.' });
    return services.github.setRepositoryAccount(stringArg(id, 'gh-set-repository-account', 64), parsed.data, typeof expectedRevision === 'number' ? expectedRevision : undefined);
  });
  handle(IPC.githubStatus, 'gh-status', (forceRefresh) => services.github.status(booleanArg(forceRefresh, 'gh-status')));
  handle(IPC.githubRepositoryInfo, 'gh-repository-info', (id) => services.github.repositoryInfo(stringArg(id, 'gh-repository-info', 64)));
  handleWithContext(IPC.githubPrForBranch, 'gh-pr-for-branch', (context, id, branchName) => services.github.findPullRequestForBranch(
    stringArg(id, 'gh-pr-for-branch', 64),
    stringArg(branchName, 'gh-pr-for-branch', 512),
    context.kept,
  ));
  handle(IPC.repositoryReplaceSearch, 'replace-search', (id, request) => {
    const repositoryId = stringArg(id, 'replace-search', 64);
    const input = searchReplaceArg(request, 'replace-search');
    return services.fileHistory.serialize(repositoryId, () => services.search.replace(repositoryId, input));
  });
  handleWithContext(IPC.githubPrList, 'gh-pr-list', (context, id, states, fresh) => services.github.listPullRequests(
    stringArg(id, 'gh-pr-list', 64),
    pullRequestStatesArg(states, 'gh-pr-list'),
    fresh == null ? false : booleanArg(fresh, 'gh-pr-list'),
    context.kept,
  ));
  handleWithContext(IPC.githubPrView, 'gh-pr-view', (context, id, prNumber) => services.github.getPullRequest(stringArg(id, 'gh-pr-view', 64), prNumberArg(prNumber, 'gh-pr-view'), context.kept));
  handleWithContext(IPC.githubPrLiveState, 'gh-pr-live-state', (context, id, prNumber) => services.github.getPullRequestLiveState(stringArg(id, 'gh-pr-live-state', 64), prNumberArg(prNumber, 'gh-pr-live-state'), context.kept));
  handleWithContext(IPC.githubPrConversation, 'gh-pr-conversation', (context, id, prNumber) => services.github.getPullRequestConversation(stringArg(id, 'gh-pr-conversation', 64), prNumberArg(prNumber, 'gh-pr-conversation'), context.kept));
  handle(IPC.githubPrAction, 'gh-pr-action', (input) => services.github.runPullRequestAction(pullRequestActionArg(input)));
  handle(IPC.githubPrUpdate, 'gh-pr-update', (input) => services.github.updatePullRequest(updatePullRequestArg(input)));
  handle(IPC.githubPrComment, 'gh-pr-comment', (input) => services.github.commentOnPullRequest(commentOnPullRequestArg(input)));
  handle(IPC.githubPrReview, 'gh-pr-review', (input) => services.github.reviewPullRequest(reviewPullRequestArg(input)));
  handle(IPC.githubPrEntryEdit, 'gh-pr-entry-edit', (input) => services.github.editPullRequestEntry(editPullRequestEntryArg(input)));
  handle(IPC.githubPrEntryDelete, 'gh-pr-entry-delete', (input) => services.github.deletePullRequestEntry(deletePullRequestEntryArg(input)));
  handleWithContext(IPC.githubPrStack, 'gh-pr-stack', (context, id, prNumber) => services.github.getPullRequestStack(stringArg(id, 'gh-pr-stack', 64), prNumberArg(prNumber, 'gh-pr-stack'), context.kept));
  handleWithContext(IPC.githubPrListLineCounts, 'gh-pr-list-line-counts', (context, id, states) => services.github.listPullRequestLineCounts(
    stringArg(id, 'gh-pr-list-line-counts', 64),
    pullRequestStatesArg(states, 'gh-pr-list-line-counts'),
    context.kept,
  ));
  handleWithContext(IPC.githubPrListStacks, 'gh-pr-list-stacks', (context, id, numbers) => services.github.listPullRequestStacks(stringArg(id, 'gh-pr-list-stacks', 64), prNumbersArg(numbers, 'gh-pr-list-stacks'), context.kept));
  handle(IPC.githubPrDiff, 'gh-pr-diff', (id, prNumber, range) => services.github.getPullRequestDiff(stringArg(id, 'gh-pr-diff', 64), prNumberArg(prNumber, 'gh-pr-diff'), pullRequestRangeArg(range, 'gh-pr-diff')));
  handle(IPC.githubPrCommitDiff, 'gh-pr-commit-diff', (id, oid) => services.github.getPullRequestCommitDiff(stringArg(id, 'gh-pr-commit-diff', 64), oidArg(oid, 'gh-pr-commit-diff')));
  handle(IPC.githubPrCommits, 'gh-pr-commits', (id, prNumber) => services.github.getPullRequestCommits(stringArg(id, 'gh-pr-commits', 64), prNumberArg(prNumber, 'gh-pr-commits')));
  handle(IPC.githubPrCreate, 'gh-pr-create', (input) => services.github.createPullRequest(createPullRequestArg(input)));
  handleWithContext(IPC.githubPrDraft, 'ai-pr-draft', (context, input) => (
    services.prDrafts.generate(generatePullRequestDraftArg(input), context.signal)
  ));
  handleWithContext(IPC.githubReleaseList, 'gh-release-list', (context, id, fresh) => services.github.listReleases(stringArg(id, 'gh-release-list', 64), fresh == null ? false : booleanArg(fresh, 'gh-release-list'), context.kept));
  handle(IPC.githubReleaseView, 'gh-release-view', (id, tagName) => services.github.getRelease(stringArg(id, 'gh-release-view', 64), tagNameArg(tagName, 'gh-release-view')));
  handle(IPC.githubReleaseTag, 'gh-release-tag', (id, tagName) => services.github.checkReleaseTag(stringArg(id, 'gh-release-tag', 64), tagNameArg(tagName, 'gh-release-tag')));
  handle(IPC.githubReleaseCreate, 'gh-release-create', (input) => services.github.createRelease(createReleaseArg(input)));
  handle(IPC.githubReleaseUpdate, 'gh-release-update', (input) => services.github.updateRelease(updateReleaseArg(input)));
  handle(IPC.githubReleaseDelete, 'gh-release-delete', (input) => services.github.deleteDraftRelease(deleteDraftReleaseArg(input)));
  handle(IPC.githubReleasePublish, 'gh-release-publish', (input) => services.github.publishRelease(publishReleaseArg(input)));
  handle(IPC.githubWorkflowList, 'gh-workflow-list', (id) => services.github.listWorkflows(stringArg(id, 'gh-workflow-list', 64)));
  handle(IPC.githubWorkflowRunnable, 'gh-workflow-runnable', (id) => services.github.listRunnableWorkflows(stringArg(id, 'gh-workflow-runnable', 64)));
  handle(IPC.githubWorkflowTriggers, 'gh-workflow-triggers', (id, path, ref) => services.github.getWorkflowTriggers(stringArg(id, 'gh-workflow-triggers', 64), workflowPathArg(path, 'gh-workflow-triggers'), tagNameArg(ref, 'gh-workflow-triggers')));
  handle(IPC.githubWorkflowRun, 'gh-workflow-run', (input) => services.github.runWorkflow(runWorkflowArg(input)));
  handleWithContext(IPC.githubActionRunList, 'gh-action-run-list', (context, id, workflowId, page) => services.github.listActionRuns(
    stringArg(id, 'gh-action-run-list', 64),
    workflowId === null || workflowId === undefined ? null : githubIdArg(workflowId, 'gh-action-run-list'),
    page === undefined ? 1 : runPageArg(page, 'gh-action-run-list'),
    context.kept,
  ));
  handleWithContext(IPC.githubActionRunView, 'gh-action-run-view', (context, id, runId) => services.github.getActionRun(stringArg(id, 'gh-action-run-view', 64), githubIdArg(runId, 'gh-action-run-view'), context.kept));
  handleWithContext(IPC.githubActionJobLog, 'gh-action-job-log', (context, id, jobId) => services.github.getActionJobLog(stringArg(id, 'gh-action-job-log', 64), githubIdArg(jobId, 'gh-action-job-log'), context.signal));
  handle(IPC.githubPrDraftCancel, 'ai-pr-draft-cancel', (requestId) => {
    services.prDrafts.cancel(aiString(requestId, 'ai-pr-draft-cancel', 100, true));
  });

  // What the server keeps per connection lives as long as the connection.
  registry.setConnectionLifecycle({
    opened: (connectionId) => { services.clients.connect(connectionId); },
    closed: (connectionId) => {
      clipboards.delete(connectionId);
      services.clients.disconnect(connectionId);
    },
  });

  const registered = new Set(registry.registeredCommands());
  for (const definition of serverDefinitions.values()) {
    if (!registered.has(definition.command)) throw new Error(`Missing server handler: ${definition.command}`);
  }
}

/** Shared repository-open lifecycle used by authenticated commands and CLI bootstrap. */
export async function openRuntimeRepositoryPath(services: OpenTigRuntimeServices, selectedPath: string) {
  return services.repositories.openPath(selectedPath);
}

export const FILE_CLIPBOARD_SESSION_STATE = 'file-clipboard';
interface FileClipboardSessionState { pendingCut: { repositoryId: string; paths: string[]; transferId: string } | null }

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
