import type { ImageFileResult } from '@shared/contracts';
import { IPC } from '@shared/contracts';
import { AI_CLIENT_TIMEOUT_MS } from '@shared/ai-timeouts';
import type { OpenTigRuntimeEvent } from '@shared/runtime-events';
import type { OpenTigServerApi } from '@shared/server-api';
import { OPEN_TIG_PROTOCOL_VERSION } from '@shared/server-protocol';
import { OpenTigWebSocketTransport } from './websocket-transport';

interface ServerClientOptions {
  transport?: OpenTigWebSocketTransport;
  httpOrigin?: string;
  fetch?: typeof fetch;
}

export interface OpenTigServerClient {
  api: OpenTigServerApi;
  transport: OpenTigWebSocketTransport;
}

/** Typed API facade over the sole domain transport. */
export function createOpenTigServerClient(options: ServerClientOptions = {}): OpenTigServerClient {
  const transport = options.transport ?? new OpenTigWebSocketTransport();
  const httpOrigin = options.httpOrigin ?? globalThis.location?.origin ?? 'http://127.0.0.1';
  const fetchRequest = options.fetch ?? fetch;
  const repositoryChanged = new Set<Parameters<OpenTigServerApi['events']['onRepositoryChanged']>[0]>();
  const activeRepositoryChanged = new Set<Parameters<OpenTigServerApi['events']['onActiveRepositoryChanged']>[0]>();
  const invoke = <Command extends Parameters<OpenTigWebSocketTransport['request']>[0]>(
    command: Command,
    ...args: Parameters<OpenTigServerApiMethod<Command>>
  ): ReturnType<OpenTigServerApiMethod<Command>> => transport.request(command, args) as ReturnType<OpenTigServerApiMethod<Command>>;

  const bootstrap: OpenTigServerApi['app']['bootstrap'] = async () => {
    const data = await transport.request(IPC.bootstrap, []);
    if (!data.server || data.server.protocolVersion !== OPEN_TIG_PROTOCOL_VERSION) {
      transport.markIncompatible();
      throw new Error('This OpenTig client is incompatible with the server.');
    }
    return data;
  };

  const api: OpenTigServerApi = {
    app: {
      bootstrap,
      capabilities: () => invoke(IPC.capabilities),
      setPreferences: (preferences) => invoke(IPC.preferences, preferences),
      setFilesTreeExpandedPaths: (repositoryId, expandedPaths) => invoke(IPC.filesTreeStateUpdate, repositoryId, expandedPaths),
      setOpenFilesState: (repositoryId, tabs, activePath, previewPath) => invoke(IPC.openFilesStateUpdate, repositoryId, tabs, activePath, previewPath),
    },
    projects: {
      create: (name) => invoke(IPC.projectCreate, name),
      rename: (projectId, name) => invoke(IPC.projectRename, projectId, name),
      remove: (projectId) => invoke(IPC.projectRemove, projectId),
      assign: (repositoryKey, projectId) => invoke(IPC.projectAssign, repositoryKey, projectId),
    },
    repository: {
      openPath: (path) => invoke(IPC.repositoryOpenPath, path),
      browseDirectories: (path) => path === undefined ? invoke(IPC.repositoryBrowseDirectories) : invoke(IPC.repositoryBrowseDirectories, path),
      openRecent: (id) => invoke(IPC.repositoryOpenRecent, id),
      relocateRecent: (id, path) => invoke(IPC.repositoryRelocateRecent, id, path),
      getStatus: (id, includeStats) => invoke(IPC.repositoryStatus, id, includeStats),
      getFiles: (id) => invoke(IPC.repositoryFiles, id),
      getDirectoryEntries: (id, path) => invoke(IPC.repositoryDirectoryEntries, id, path),
      readFile: (id, path, allowLarge) => invoke(IPC.repositoryReadFile, id, path, allowLarge),
      readImage: (id, path) => readImage(fetchRequest, httpOrigin, id, path),
      getFavicon: (id) => invoke(IPC.repositoryGetFavicon, id),
      writeFile: (id, path, content, expectedContent) => invoke(IPC.repositoryWriteFile, id, path, content, expectedContent),
      getAbsolutePath: (id, path) => invoke(IPC.repositoryAbsolutePath, id, path),
      copyEntries: (id, paths) => invoke(IPC.repositoryCopyEntries, id, paths),
      cutEntries: (id, paths) => invoke(IPC.repositoryCutEntries, id, paths),
      pasteEntries: (id, targetDirectory, sourcePaths, cutTransferId, imagePng) => invoke(IPC.repositoryPasteEntries, id, targetDirectory, sourcePaths, cutTransferId, imagePng),
      moveEntry: (id, path, targetDirectory) => invoke(IPC.repositoryMoveEntry, id, path, targetDirectory),
      moveEntries: (id, paths, targetDirectory) => invoke(IPC.repositoryMoveEntries, id, paths, targetDirectory),
      deleteEntry: (id, path) => invoke(IPC.repositoryDeleteEntry, id, path),
      deleteEntries: (id, paths) => invoke(IPC.repositoryDeleteEntries, id, paths),
      renameEntry: (id, path, newName) => invoke(IPC.repositoryRenameEntry, id, path, newName),
      createEntry: (id, targetDirectory, name, kind) => invoke(IPC.repositoryCreateEntry, id, targetDirectory, name, kind),
      search: (id, searchOptions) => invoke(IPC.repositorySearch, id, searchOptions),
      replaceSearch: (id, request) => invoke(IPC.repositoryReplaceSearch, id, request),
      fileHistoryState: (id) => invoke(IPC.repositoryFileHistoryState, id),
      undoFileOperation: (id) => invoke(IPC.repositoryUndoFileOperation, id),
      redoFileOperation: (id) => invoke(IPC.repositoryRedoFileOperation, id),
    },
    diff: {
      get: (request) => invoke(IPC.diffGet, request),
      getCommit: (repositoryId, oid) => invoke(IPC.diffCommit, repositoryId, oid),
      getCommitFile: (repositoryId, oid, path, oldPath) => invoke(IPC.diffCommitFile, repositoryId, oid, path, oldPath),
    },
    index: {
      stage: (repositoryId, paths) => invoke(IPC.indexStage, repositoryId, paths),
      unstage: (repositoryId, paths) => invoke(IPC.indexUnstage, repositoryId, paths),
      discard: (repositoryId, paths) => invoke(IPC.indexDiscard, repositoryId, paths),
      stageAll: (repositoryId) => invoke(IPC.indexStageAll, repositoryId),
      unstageAll: (repositoryId) => invoke(IPC.indexUnstageAll, repositoryId),
      prepareCommitGroup: (input) => invoke(IPC.indexPrepareCommitGroup, input),
      updateConflict: (repositoryId, path, content) => invoke(IPC.indexUpdateConflict, repositoryId, path, content),
      resolveConflict: (repositoryId, path, content) => invoke(IPC.indexResolveConflict, repositoryId, path, content),
    },
    commits: {
      create: (repositoryId, message) => invoke(IPC.commitCreate, repositoryId, message),
      undoLatest: (repositoryId, expectedOid) => invoke(IPC.commitUndoLatest, repositoryId, expectedOid),
      list: (repositoryId, cursor) => invoke(IPC.commitsList, repositoryId, cursor),
      files: (repositoryId, oid) => invoke(IPC.commitsFiles, repositoryId, oid),
    },
    refs: {
      listBranches: (repositoryId) => invoke(IPC.branchesList, repositoryId),
      switchBranch: (repositoryId, branch, moveChanges) => invoke(IPC.branchSwitch, repositoryId, branch, moveChanges),
      listWorktrees: (repositoryId) => invoke(IPC.worktreesList, repositoryId),
      selectWorktree: (repositoryId, path) => invoke(IPC.worktreeSelect, repositoryId, path),
      pull: (repositoryId) => invoke(IPC.refsPull, repositoryId),
      push: (repositoryId) => invoke(IPC.refsPush, repositoryId),
      fetch: (repositoryId) => invoke(IPC.refsFetch, repositoryId),
      localRefsSnapshot: (repositoryId) => invoke(IPC.localRefsSnapshot, repositoryId),
      branchDetails: (request) => invoke(IPC.branchDetails, request),
      worktreeDetails: (request) => invoke(IPC.worktreeDetails, request),
      deleteBranch: (request) => invoke(IPC.branchDelete, request),
      removeWorktree: (request) => invoke(IPC.worktreeRemove, request),
    },
    ai: {
      statuses: (forceRefresh) => invoke(IPC.aiStatuses, forceRefresh),
      generateCommitMessage: (input) => transport.request(IPC.aiGenerateCommitMessage, [input], { timeoutMs: AI_CLIENT_TIMEOUT_MS }),
      cancelGeneration: (requestId) => invoke(IPC.aiCancelGeneration, requestId),
      log: () => invoke(IPC.aiLog),
      clearLog: () => invoke(IPC.aiClearLog),
    },
    github: {
      status: (forceRefresh) => invoke(IPC.githubStatus, forceRefresh),
      repositoryInfo: (repositoryId) => invoke(IPC.githubRepositoryInfo, repositoryId),
      findPullRequestForBranch: (repositoryId, branchName) => invoke(IPC.githubPrForBranch, repositoryId, branchName),
      listPullRequests: (repositoryId, states) => invoke(IPC.githubPrList, repositoryId, states),
      getPullRequest: (repositoryId, number) => invoke(IPC.githubPrView, repositoryId, number),
      getPullRequestDiff: (repositoryId, number) => invoke(IPC.githubPrDiff, repositoryId, number),
      getPullRequestCommitDiff: (repositoryId, oid) => invoke(IPC.githubPrCommitDiff, repositoryId, oid),
      createPullRequest: (input) => invoke(IPC.githubPrCreate, input),
      generateDraft: (input) => transport.request(IPC.githubPrDraft, [input], { timeoutMs: AI_CLIENT_TIMEOUT_MS }),
      cancelDraft: (requestId) => invoke(IPC.githubPrDraftCancel, requestId),
    },
    diagnostics: {
      list: () => invoke(IPC.diagnosticsList),
      clear: () => invoke(IPC.diagnosticsClear),
      record: (entry) => invoke(IPC.diagnosticsRecord, entry),
    },
    events: {
      onRepositoryChanged: (callback) => subscribe(repositoryChanged, callback),
      onActiveRepositoryChanged: (callback) => subscribe(activeRepositoryChanged, callback),
    },
  };

  transport.onEvent((event) => publishRuntimeEvent(event, repositoryChanged, activeRepositoryChanged));
  transport.onReconnect(async () => {
    const data = await api.app.bootstrap();
    if (!data.activeRepository) return;
    for (const listener of activeRepositoryChanged) listener(data.activeRepository);
    for (const listener of repositoryChanged) listener(data.activeRepository.id, 'unknown');
  });

  return { api, transport };
}

type OpenTigServerApiMethod<Command extends Parameters<OpenTigWebSocketTransport['request']>[0]> =
  (...args: import('@shared/protocol').OpenTigServerCommandMap[Command]['args']) =>
    Promise<import('@shared/protocol').OpenTigServerCommandMap[Command]['result']>;

function subscribe<Listener>(listeners: Set<Listener>, listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publishRuntimeEvent(
  event: OpenTigRuntimeEvent,
  repositoryChanged: ReadonlySet<Parameters<OpenTigServerApi['events']['onRepositoryChanged']>[0]>,
  activeRepositoryChanged: ReadonlySet<Parameters<OpenTigServerApi['events']['onActiveRepositoryChanged']>[0]>,
): void {
  if (event.type === 'repository.changed') {
    for (const listener of repositoryChanged) listener(event.repositoryId, event.scope);
  } else {
    for (const listener of activeRepositoryChanged) listener(event.repository);
  }
}

async function readImage(
  fetchRequest: typeof fetch,
  origin: string,
  repositoryId: string,
  path: string,
): Promise<ImageFileResult> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = new URL(`/api/image/${encodeURIComponent(repositoryId)}/${encodedPath}`, origin);
  const response = await fetchRequest(url, { credentials: 'include' });
  if (response.status === 413 || response.status === 415) return response.json() as Promise<ImageFileResult>;
  if (!response.ok) throw new Error(response.status === 401 ? 'Authentication required.' : 'Could not load image preview.');
  const mimeType = response.headers.get('content-type');
  if (!mimeType?.startsWith('image/')) throw new Error('Server returned an invalid image preview.');
  const data = new Uint8Array(await response.arrayBuffer());
  return {
    status: 'ready',
    path,
    mimeType: mimeType as Extract<ImageFileResult, { status: 'ready' }>['mimeType'],
    data,
    size: Number(response.headers.get('content-length') ?? data.byteLength),
    mtimeMs: Number(response.headers.get('x-opentig-mtime-ms') ?? 0),
  };
}
