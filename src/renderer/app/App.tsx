import { appDisplayName } from '@/lib/app-identity';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconArrowLeft, IconGitCommit, IconFileArrowRight, IconFiles, IconGitCompare, IconGitPullRequest, IconHistory,
  IconLoader4, IconRestore, IconSearch, IconTrash,
} from '@tabler/icons-react';
import { Toaster, sileo } from 'sileo';
import type { BootstrapData, CommitSplitProposal, FileHistoryPathChange, FileHistoryState, GhCliStatus, GitHubRepositoryInfo, OpenTigCapabilities, Preferences, PullRequestState, PullRequestSummary, PullResult, PushResult, RecentRepository, RepositoryInfo, UndoLatestCommitResult } from '../../shared/contracts';
import { matchesCombo, resolveShortcuts, type ShortcutMap } from '../../shared/shortcuts';
import { ShortcutsProvider } from './ShortcutsContext';
import { Toolbar } from './Toolbar';
import { normalizeOpenFilesStates, type OpenFilesState } from '../../shared/open-files-state';
import { normalizeFilesTreeStates } from '../../shared/files-tree-state';
import { serializedErrorFromReason, type SerializedAiError } from '../../shared/errors';
import type { BranchInfo, CommitInfo, CommitPage, FileTreeEntry, RepositoryStatus, WorktreeInfo } from '../../shared/git-types';
import { normalizeRepositoryKey } from '../../shared/repository-projects';
import { DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS } from '../../shared/remote-fetch';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SplashScreen } from '@/components/SplashScreen';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChangesView } from '@/features/changes/ChangesView';
import { createDeleteAction, createDiscardAction, destructiveActionCopy, dispatchDestructiveAction, type DestructiveAction } from '@/features/files/destructive-action';
import { fileSnapshotFingerprint, pathContains, selectedFileChanged, snapshotPathPresence } from '@/features/files/file-tree';
import {
  activateTab, applyKeyboardAction, closeTab, dirtyTabs, dirtyTabsUnder, DRAFT_MEMORY_WARNING_BYTES, draftBytes,
  emptyFileSession, type FileSession, markTabsPresent, moveTab, type OpenMode, openTab, removeTabsUnder, renameTabPaths,
  restoreSession, serializeSession, setTabDirty, type TabKeyboardAction,
} from '@/features/files/open-files-model';
import { CommitComposer } from '@/features/commit/CommitComposer';
import { clearCommitFilesCache } from '@/features/history/commit-files-cache';
import { OpenRepositoryDialog } from '@/features/repositories/OpenRepositoryDialog';
import { Welcome } from '@/features/repositories/Welcome';
import { touchRecentRepositories, type RepositoryOption } from '@/features/repositories/repository-select-model';
import type { RuntimeFileDraft, ViewerSelection } from '@/features/viewer/Viewer';
import {
  mergeRefreshRequests, refreshOperationsForScope, shouldRefreshSearch, shouldRefreshViewer, type RefreshRequest,
} from './refresh-policy';
import { resolveWindowControlsInset } from './window-controls';
import { queryKeys, queryResourcesForScope } from '@/lib/query-client';
import { persistTheme } from '@/lib/boot-theme';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { opentig, serverClient } from '@/lib/opentig-api';
import { startupSplashDetail } from '@/lib/startup-splash';
import { conflictNotificationAction, conflictToastId } from '@/features/changes/conflict-notification';
import { fileCutTransferId, writeClipboardText, writeFileTransfer } from '@/lib/browser-capabilities';
import { projectPullBlockedCopy, projectPullSuccessCopy, projectPushBlockedCopy, projectPushSuccessCopy, pullSuccessCopy, repositorySyncLoadingToast, type ProjectSyncAction } from '@/features/repositories/project-sync';
import { aiModelLabel, harnessLabel } from '@/features/ai/harness-copy';
import { DesktopUpdateNotice } from '@/features/settings/UpdateSettings';
import type { SettingsSection } from '@/features/settings/SettingsDialog';

const Viewer = lazy(() => import('@/features/viewer/Viewer'));
const FilesView = lazy(() => import('@/features/files/FilesView').then((module) => ({ default: module.FilesView })));
const HistoryView = lazy(() => import('@/features/history/HistoryView').then((module) => ({ default: module.HistoryView })));
const SearchView = lazy(() => import('@/features/search/SearchView').then((module) => ({ default: module.SearchView })));
const PullRequestsView = lazy(() => import('@/features/pulls/PullRequestsView').then((module) => ({ default: module.PullRequestsView })));
const QuickOpenDialog = lazy(() => import('@/features/files/QuickOpenDialog').then((module) => ({ default: module.QuickOpenDialog })));
const CreatePullRequestDialog = lazy(() => import('@/features/pulls/CreatePullRequestDialog').then((module) => ({ default: module.CreatePullRequestDialog })));
const sidebarFallback = <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading…" /></div>;
const NO_OPEN_FILES_STATES: OpenFilesState[] = [];
type DirtyCloseChoice = 'save' | 'discard' | 'cancel';
const SIDEBAR_VIEWS = ['changes', 'files', 'history', 'prs', 'search'] as const;
type SidebarView = (typeof SIDEBAR_VIEWS)[number];
interface AppRefreshOptions {
  background?: boolean;
  scope?: RepositoryChangeScope;
}

/** Carries a non-success, non-rejected pull result through `sileo.promise()`'s single error path. */
class PullBlocked extends Error {
  constructor(readonly result: Exclude<PullResult, { status: 'success' } | { status: 'up-to-date' }>) {
    super(result.status);
  }
}

/** Carries a non-success, non-rejected push result through `sileo.promise()`'s single error path. */
class PushBlocked extends Error {
  constructor(readonly result: Exclude<PushResult, { status: 'success' } | { status: 'up-to-date' }>) {
    super(result.status);
  }
}

export default function App() {
  const appQueryClient = useQueryClient();
  const mobile = useMobileLayout();
  const [openRepositoryDialog, setOpenRepositoryDialog] = useState(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'viewer' | 'commit'>('list');
  const [mobileDiffView, setMobileDiffView] = useState<Preferences['diffView']>('unified');
  const mobileBackRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mobile && mobilePane !== 'list') mobileBackRef.current?.focus();
  }, [mobile, mobilePane]);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [capabilities, setCapabilities] = useState<OpenTigCapabilities | null>(null);
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [statusState, setStatus] = useState<RepositoryStatus | null>(null);
  const [filesState, setFiles] = useState<FileTreeEntry[] | null>(null);
  // A root snapshot intentionally omits the contents of collapsed ignored
  // folders. Keep a separate revision so a fresh snapshot can still invalidate
  // their lazy cache when that compact root representation is unchanged.
  const [filesSnapshotRevision, setFilesSnapshotRevision] = useState(0);
  const [fileHistoryState, setFileHistoryState] = useState<FileHistoryState>({ canUndo: false, undoLabel: null, canRedo: false, redoLabel: null });
  const [branchesState, setBranches] = useState<BranchInfo[]>([]);
  const [worktreesState, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [snapshotRepositoryId, setSnapshotRepositoryId] = useState<string | null>(null);
  const [view, setView] = useState<SidebarView>('changes');
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitProposal, setCommitProposal] = useState<CommitSplitProposal | null>(null);
  const [preparedCommitIndex, setPreparedCommitIndex] = useState<number | null>(null);
  const [completedCommitIndices, setCompletedCommitIndices] = useState<ReadonlySet<number>>(() => new Set());
  const [commitPlanCollapsed, setCommitPlanCollapsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [repositorySyncOperations, setRepositorySyncOperations] = useState<ReadonlyMap<string, ProjectSyncAction>>(() => new Map());

  const [refreshVersion, setRefreshVersion] = useState(0);
  const [searchRevision, setSearchRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [generating, setGenerating] = useState<string | null>(null);
  const [undoCommit, setUndoCommit] = useState<CommitInfo | null>(null);
  const [undoingCommit, setUndoingCommit] = useState(false);
  const [pullRequestStates, setPullRequestStates] = useState<PullRequestState[]>(['OPEN']);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // Open-file tabs, one session per worktree. Structural metadata only: the
  // draft text of a dirty tab lives in a ref-backed map, never in React state.
  const [fileSessions, setFileSessions] = useState<ReadonlyMap<string, FileSession>>(() => new Map());
  const [dirtyClosePath, setDirtyClosePath] = useState<string | null>(null);
  const [destructiveAction, setDestructiveAction] = useState<DestructiveAction | null>(null);
  const [blockedBranchSwitch, setBlockedBranchSwitch] = useState<{ ref: string; label: string; files: string[] } | null>(null);
  // Holding Ctrl reveals the section numbers, so the shortcut is discoverable
  // without a cheat sheet.
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const filesRef = useRef<FileTreeEntry[] | null>(null);
  const viewerSelectionRef = useRef<ViewerSelection>(null);
  // A path we just created/renamed/moved the viewer onto; it may be missing from
  // an in-flight (stale) file snapshot, so don't declare it deleted until it appears.
  const pendingViewerPathRef = useRef<string | null>(null);
  const generationRequest = useRef<{ id: string; repositoryId: string } | null>(null);
  const repositorySyncOperationsRef = useRef<Map<string, ProjectSyncAction>>(new Map());
  const busyRef = useRef<string | null>(null);
  const [filesTreeStates] = useState<Map<string, string[]>>(() => new Map());
  const repositoryRef = useRef<RepositoryInfo | null>(null);
  const fileSessionsRef = useRef<ReadonlyMap<string, FileSession>>(fileSessions);
  // Last payload sent per worktree, so pure activation bumps do not produce a server write.
  const persistedSessionsRef = useRef<Map<string, string>>(new Map());
  // Unsaved draft text, keyed by worktree then path. Deliberately a ref: an
  // editor keystroke must not rerender App or the toolbar.
  const fileDraftsRef = useRef<Map<string, Map<string, RuntimeFileDraft>>>(new Map());
  const draftBytesRef = useRef(0);
  const draftWarningShownRef = useRef(false);
  const dirtyCloseResolverRef = useRef<((choice: DirtyCloseChoice) => void) | null>(null);
  const destructiveActionInFlightRef = useRef(false);
  const commitTextareaRef = useRef<HTMLTextAreaElement>(null);
  // The last message OpenTig itself put in the composer, so an edited one is
  // never replaced without asking.
  const lastAppliedMessageRef = useRef('');
  const forceGhStatusRef = useRef(false);
  const knownConflictPathsRef = useRef<Map<string, string[]>>(new Map());
  const refreshCyclesRef = useRef<Map<string, { queued: RefreshRequest | null; promise: Promise<void> }>>(new Map());

  const historyQuery = useInfiniteQuery({
    queryKey: queryKeys.history(repository?.id ?? ''),
    queryFn: ({ pageParam }) => opentig.commits.list(repository!.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: repository !== null && view === 'history',
  });
  const commits = historyQuery.data ? historyQuery.data.pages.flatMap((page) => page.commits) : null;
  const nextCursor = historyQuery.hasNextPage ? historyQuery.data?.pages.at(-1)?.nextCursor ?? null : null;

  const githubInfoQuery = useQuery<GitHubRepositoryInfo>({
    queryKey: queryKeys.githubInfo(repository?.id ?? ''),
    queryFn: async () => {
      try { return await opentig.github.repositoryInfo(repository!.id); }
      catch { return { isGitHub: false, nameWithOwner: null }; }
    },
    enabled: repository !== null,
  });
  const githubInfo = githubInfoQuery.data ?? null;
  const pullsQuery = useQuery<{ ghStatus: GhCliStatus; pulls: PullRequestSummary[] | null }>({
    queryKey: queryKeys.pulls(repository?.id ?? '', pullRequestStates),
    queryFn: async () => {
      const forceStatus = forceGhStatusRef.current;
      forceGhStatusRef.current = false;
      const nextGhStatus = await opentig.github.status(forceStatus);
      if (!nextGhStatus.installed || nextGhStatus.authStatus === 'unauthenticated') return { ghStatus: nextGhStatus, pulls: null };
      const nextPulls = pullRequestStates.length ? await opentig.github.listPullRequests(repository!.id, pullRequestStates) : [];
      return { ghStatus: nextGhStatus, pulls: nextPulls };
    },
    enabled: view === 'prs' && repository !== null && githubInfo?.isGitHub === true,
  });
  const ghStatus = pullsQuery.data?.ghStatus ?? null;
  const pulls = pullsQuery.data?.pulls ?? null;
  const pullsLoading = pullsQuery.isFetching;
  const pullsError = pullsQuery.error ? messageOf(pullsQuery.error) : null;
  useEffect(() => { setMobilePane('list'); }, [repository?.id]);
  const currentSnapshot = snapshotRepositoryId === repository?.id;
  const status = currentSnapshot ? statusState : null;
  const files = currentSnapshot ? filesState : null;
  const branches = currentSnapshot ? branchesState : [];
  const worktrees = currentSnapshot ? worktreesState : [];

  const openFilesStates = bootstrap?.openFilesStates ?? NO_OPEN_FILES_STATES;
  const connectionState = useSyncExternalStore(
    serverClient.transport.subscribeState,
    serverClient.transport.getState,
    serverClient.transport.getState,
  );
  const theme = bootstrap?.preferences.theme ?? 'system';
  const diffView = mobile ? mobileDiffView : bootstrap?.preferences.diffView ?? 'unified';
  const wrapLines = bootstrap?.preferences.wrapLines ?? false;
  const uiZoom = bootstrap?.preferences.uiZoom ?? 100;
  const uiFont = bootstrap?.preferences.uiFont ?? 'geist';
  const monoFont = bootstrap?.preferences.monoFont ?? 'inconsolata';
  const shortcuts = useMemo(() => resolveShortcuts(bootstrap?.preferences.shortcutOverrides), [bootstrap?.preferences.shortcutOverrides]);

  useEffect(() => {
    let active = true;
    opentig.app.bootstrap().then((data) => {
      if (!active) return;
      filesTreeStates.clear();
      for (const state of data.filesTreeStates) filesTreeStates.set(state.repositoryId, [...state.expandedPaths]);
      setBootstrap(data);
      setRepository(data.activeRepository);
    }).catch((reason) => reportError('Could not start OpenTig', reason));
    opentig.app.capabilities().then((available) => {
      if (active) setCapabilities(available);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [filesTreeStates]);

  useLayoutEffect(() => {
    const overlay = (navigator as Navigator & {
      windowControlsOverlay?: {
        visible: boolean;
        getTitlebarAreaRect(): DOMRect;
        addEventListener(type: 'geometrychange', listener: EventListener): void;
        removeEventListener(type: 'geometrychange', listener: EventListener): void;
      };
    }).windowControlsOverlay;
    const apply = () => {
      const rect = overlay?.visible ? overlay.getTitlebarAreaRect() : null;
      const inset = resolveWindowControlsInset({
        rect,
        viewportWidth: window.innerWidth,
        mac: navigator.userAgent.includes('Mac OS X'),
        desktop: Boolean(window.opentigDesktop),
      });
      document.documentElement.style.setProperty('--window-controls-inset', `${inset.right}px`);
      document.documentElement.style.setProperty('--window-controls-inset-left', `${inset.left}px`);
      // Matching the toolbar to the controls makes their hover surface line up
      // with the header instead of ending a few pixels short.
      if (inset.height > 0) document.documentElement.style.setProperty('--toolbar-height', `${inset.height}px`);
      else document.documentElement.style.removeProperty('--toolbar-height');
    };
    apply();
    overlay?.addEventListener('geometrychange', apply);
    window.addEventListener('resize', apply);
    return () => {
      overlay?.removeEventListener('geometrychange', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);

  useLayoutEffect(() => {
    if (!bootstrap) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('light', !dark);
      persistTheme(theme);
      void opentig.app.setTitleBarTheme(dark).catch(() => undefined);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [bootstrap, theme]);

  useEffect(() => {
    opentig.app.setZoomFactor(mobile ? 1 : uiZoom / 100);
  }, [uiZoom, mobile]);

  useLayoutEffect(() => {
    document.documentElement.dataset.uiFont = uiFont;
    document.documentElement.dataset.monoFont = monoFont;
  }, [monoFont, uiFont]);

  useEffect(() => {
    if (!bootstrap?.performanceAutomation) return;
    window.__opentigPerformanceAutomation = true;
    window.__opentigPerformanceResults = [];
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (!action || typeof action !== 'object') return;
      const record = action as Record<string, unknown>;
      if (record.type === 'refresh') {
        setRefreshVersion((version) => version + 1);
        setSearchRevision((version) => version + 1);
        return;
      }
      if (record.type === 'view'
        && (record.view === 'changes' || record.view === 'files' || record.view === 'history' || record.view === 'prs')) {
        setView(record.view);
        return;
      }
      if (record.type === 'selection' && isPerformanceSelection(record.selection)) {
        viewerSelectionRef.current = record.selection;
        setViewerSelection(record.selection);
      }
    };
    window.addEventListener('opentig:performance-action', handleAction);
    return () => {
      window.removeEventListener('opentig:performance-action', handleAction);
      delete window.__opentigPerformanceAutomation;
      delete window.__opentigPerformanceResults;
    };
  }, [bootstrap?.performanceAutomation]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    repositoryRef.current = repository;
  }, [repository]);

  /**
   * Replaces one worktree's tab session and persists its metadata. Only
   * structural changes reach the main process; the payload is compared with the
   * last one sent so activation bumps do not produce redundant writes.
   */
  const commitFileSession = useCallback((repositoryId: string, session: FileSession): FileSession => {
    const current = fileSessionsRef.current.get(repositoryId) ?? emptyFileSession;
    if (session === current) return current;
    const map = new Map(fileSessionsRef.current);
    map.set(repositoryId, session);
    fileSessionsRef.current = map;
    setFileSessions(map);

    const payload = serializeSession(session);
    const fingerprint = JSON.stringify(payload);
    if (persistedSessionsRef.current.get(repositoryId) !== fingerprint) {
      persistedSessionsRef.current.set(repositoryId, fingerprint);
      void opentig.app.setOpenFilesState(repositoryId, payload.tabs, payload.activePath, payload.previewPath).catch(() => undefined);
    }
    return session;
  }, []);

  const updateFileSession = useCallback((repositoryId: string, update: (session: FileSession) => FileSession): FileSession => {
    const current = fileSessionsRef.current.get(repositoryId) ?? emptyFileSession;
    return commitFileSession(repositoryId, update(current));
  }, [commitFileSession]);

  const selectFilePath = useCallback((path: string | null) => {
    const selection: ViewerSelection = path ? { type: 'file', path } : null;
    viewerSelectionRef.current = selection;
    setViewerSelection(selection);
    if (!path) setMobilePane((pane) => pane === 'viewer' ? 'list' : pane);
  }, []);

  const dropFileDraft = useCallback((repositoryId: string, path: string) => {
    const drafts = fileDraftsRef.current.get(repositoryId);
    if (!drafts) return;
    const draft = drafts.get(path);
    if (!draft) return;
    draftBytesRef.current -= draftBytes(draft.content);
    drafts.delete(path);
    if (drafts.size === 0) fileDraftsRef.current.delete(repositoryId);
  }, []);

  const renameFileDrafts = useCallback((repositoryId: string, renamed: ReadonlyMap<string, string>) => {
    if (renamed.size === 0) return;
    const drafts = fileDraftsRef.current.get(repositoryId);
    if (!drafts) return;
    const next = new Map<string, RuntimeFileDraft>();
    for (const [path, draft] of drafts) next.set(renamed.get(path) ?? path, draft);
    fileDraftsRef.current.set(repositoryId, next);
  }, []);

  const readFileDraft = useCallback((repositoryId: string, path: string): RuntimeFileDraft | null => {
    return fileDraftsRef.current.get(repositoryId)?.get(path) ?? null;
  }, []);

  const currentFileSession = useCallback((): FileSession => {
    const repositoryId = repositoryRef.current?.id;
    return (repositoryId ? fileSessionsRef.current.get(repositoryId) : undefined) ?? emptyFileSession;
  }, []);

  /** Unsaved tabs at or under the given paths, on screen or not. */
  const unsavedTabsUnder = useCallback((paths: readonly string[]): string[] => (
    dirtyTabsUnder(currentFileSession(), paths)
  ), [currentFileSession]);

  const anyDirtyTab = useCallback((): string[] => dirtyTabs(currentFileSession()), [currentFileSession]);

  /**
   * Records the latest draft for a path. Called on every keystroke, so it only
   * touches refs; React state changes just once, when the dirty flag flips.
   */
  const storeFileDraft = useCallback((path: string, content: string, expectedContent: string, expectedMtimeMs: number) => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return;
    let drafts = fileDraftsRef.current.get(repositoryId);
    if (!drafts) {
      drafts = new Map<string, RuntimeFileDraft>();
      fileDraftsRef.current.set(repositoryId, drafts);
    }
    const previous = drafts.get(path);
    const dirty = content !== expectedContent;
    if (!dirty) {
      if (previous) dropFileDraft(repositoryId, path);
      updateFileSession(repositoryId, (session) => setTabDirty(session, path, false));
      return;
    }
    draftBytesRef.current += draftBytes(content) - (previous ? draftBytes(previous.content) : 0);
    // An inactive tab keeps the content it was read with, so a save still
    // detects a file that changed on disk in the meantime.
    drafts.set(path, {
      content,
      expectedContent: previous?.expectedContent ?? expectedContent,
      expectedMtimeMs: previous?.expectedMtimeMs ?? expectedMtimeMs,
    });
    if (!draftWarningShownRef.current && draftBytesRef.current > DRAFT_MEMORY_WARNING_BYTES) {
      draftWarningShownRef.current = true;
      sileo.warning({ title: 'Unsaved changes are using a lot of memory', description: 'Save or close some open files.', duration: 10_000 });
    }
    if (!previous) updateFileSession(repositoryId, (session) => setTabDirty(session, path, true));
  }, [dropFileDraft, updateFileSession]);

  useEffect(() => {
    viewerSelectionRef.current = viewerSelection;
  }, [viewerSelection]);

  const applyFilesSnapshot = useCallback((nextFiles: FileTreeEntry[]) => {
    const previous = filesRef.current;
    const same = previous !== null && fileSnapshotFingerprint(previous) === fileSnapshotFingerprint(nextFiles);
    filesRef.current = same && previous ? previous : nextFiles;
    if (!same) setFiles(nextFiles);
    setFilesSnapshotRevision((revision) => revision + 1);

    const repositoryId = repositoryRef.current?.id;
    const session = repositoryId ? fileSessionsRef.current.get(repositoryId) : undefined;
    if (repositoryId && session && session.tabs.length > 0) {
      // One walk of the snapshot serves every tab; per-tab walks would turn a
      // refresh into fifty tree traversals.
      const index = indexSnapshot(nextFiles);
      const removed: string[] = [];
      const present = new Set<string>();
      for (const tab of session.tabs) {
        const presence = snapshotPresenceFromIndex(index, tab.path);
        if (presence === 'present') present.add(tab.path);
        else if (presence === 'missing' && pendingViewerPathRef.current !== tab.path) removed.push(tab.path);
      }
      if (removed.length > 0 || present.size > 0) {
        const restored = markTabsPresent(session, present);
        const result = removeTabsUnder(restored, removed);
        for (const path of result.closedPaths) dropFileDraft(repositoryId, path);
        for (const path of result.retainedPaths) {
          sileo.info({ title: 'File no longer exists', description: `${path} — unsaved changes are still open` });
        }
        const next = commitFileSession(repositoryId, result.session);
        const active = viewerSelectionRef.current;
        if (active?.type === 'file' && result.closedPaths.includes(active.path)) {
          const selection: ViewerSelection = next.activePath ? { type: 'file', path: next.activePath } : null;
          viewerSelectionRef.current = selection;
          setViewerSelection(selection);
          sileo.info({ title: 'File no longer exists', description: active.path });
        }
      }
    }

    const active = viewerSelectionRef.current;
    if (active?.type !== 'file') return;
    const presence = snapshotPathPresence(nextFiles, active.path);
    if (presence === 'missing') {
      if (pendingViewerPathRef.current === active.path) return;
      return;
    }
    if (pendingViewerPathRef.current === active.path) pendingViewerPathRef.current = null;
    if (presence === 'present' && previous && selectedFileChanged(previous, nextFiles, active.path)) {
      setRefreshVersion((version) => version + 1);
    }
  }, [commitFileSession, dropFileDraft]);

  const refreshFilesOnly = useCallback(async () => {
    if (!repository) return;
    const repositoryId = repository.id;
    try {
      const nextFiles = await appQueryClient.fetchQuery({
        queryKey: queryKeys.files(repositoryId), queryFn: () => opentig.repository.getFiles(repositoryId),
      });
      if (repositoryRef.current?.id === repositoryId) applyFilesSnapshot(nextFiles);
    } catch (reason) {
      if (repositoryRef.current?.id === repositoryId) reportError('Could not refresh files', reason);
    }
  }, [applyFilesSnapshot, appQueryClient, repository]);

  // Folders the file tree leaves collapsed (git-ignored trees) are read one level
  // at a time, the first time the user opens them.
  const loadDirectoryEntries = useCallback(async (directoryPath: string): Promise<FileTreeEntry[]> => {
    if (!repository) return [];
    try {
      return await opentig.repository.getDirectoryEntries(repository.id, directoryPath);
    } catch (reason) {
      sileo.error({ title: 'Could not read folder', description: messageOf(reason) });
      return [];
    }
  }, [repository]);

  const refreshFileHistoryState = useCallback(async () => {
    if (!repository) return;
    const repositoryId = repository.id;
    const next = await appQueryClient.fetchQuery({
      queryKey: queryKeys.fileHistory(repositoryId), queryFn: () => opentig.repository.fileHistoryState(repositoryId),
    });
    if (repositoryRef.current?.id === repositoryId) setFileHistoryState(next);
  }, [appQueryClient, repository]);

  useEffect(() => {
    if (!repository) { setFileHistoryState({ canUndo: false, undoLabel: null, canRedo: false, redoLabel: null }); return; }
    void refreshFileHistoryState();
  }, [refreshFileHistoryState, repository]);

  const performRefresh = useCallback(async (repositoryId: string, request: RefreshRequest) => {
    const { background, scope, view: refreshView } = request;
    const operations = refreshOperationsForScope(scope, refreshView);
    const resources = queryResourcesForScope(scope, refreshView);
    if (!background) setBusy('refresh');
    try {
      await Promise.all(resources.map((resource) => appQueryClient.invalidateQueries({
        queryKey: resource === 'status' ? queryKeys.status(repositoryId)
          : resource === 'branches' ? queryKeys.branches(repositoryId)
            : resource === 'worktrees' ? queryKeys.worktrees(repositoryId)
              : resource === 'files' ? queryKeys.files(repositoryId)
                : queryKeys.history(repositoryId),
        exact: true,
        refetchType: 'none',
      })));
      const [nextStatus, nextBranches, nextWorktrees, nextFiles, nextHistory] = await Promise.all([
        appQueryClient.fetchQuery({ queryKey: queryKeys.status(repositoryId), queryFn: () => opentig.repository.getStatus(repositoryId) }),
        operations.branches ? appQueryClient.fetchQuery({ queryKey: queryKeys.branches(repositoryId), queryFn: () => opentig.refs.listBranches(repositoryId) }) : Promise.resolve(null),
        operations.worktrees ? appQueryClient.fetchQuery({ queryKey: queryKeys.worktrees(repositoryId), queryFn: () => opentig.refs.listWorktrees(repositoryId) }) : Promise.resolve(null),
        operations.files ? appQueryClient.fetchQuery({ queryKey: queryKeys.files(repositoryId), queryFn: () => opentig.repository.getFiles(repositoryId) }) : Promise.resolve(null),
        operations.history ? appQueryClient.fetchInfiniteQuery({
          queryKey: queryKeys.history(repositoryId),
          queryFn: ({ pageParam }) => opentig.commits.list(repositoryId, pageParam),
          initialPageParam: undefined as string | undefined,
          getNextPageParam: (lastPage: CommitPage) => lastPage.nextCursor ?? undefined,
        }) : Promise.resolve(null),
      ]);
      if (repositoryRef.current?.id !== repositoryId) return;
      setSnapshotRepositoryId(repositoryId);
      setStatus(nextStatus);
      if (nextBranches) setBranches(nextBranches);
      if (nextWorktrees) setWorktrees(nextWorktrees);
      if (nextFiles) applyFilesSnapshot(nextFiles);
      void nextHistory;
      if (shouldRefreshViewer(scope, viewerSelectionRef.current?.type ?? null)) {
        setRefreshVersion((version) => version + 1);
      }
      if (shouldRefreshSearch(scope)) setSearchRevision((version) => version + 1);
    } catch (reason) {
      if (repositoryRef.current?.id === repositoryId) reportError('Could not refresh', reason);
    } finally {
      if (!background && repositoryRef.current?.id === repositoryId) setBusy(null);
    }
  }, [applyFilesSnapshot, appQueryClient]);
  // One cycle per repository folds watcher bursts and explicit mutation
  // refreshes into a single follow-up snapshot with the union of their scopes.
  const refresh = useCallback((options?: AppRefreshOptions): Promise<void> => {
    if (!repository) return Promise.resolve();
    const repositoryId = repository.id;
    const request: RefreshRequest = {
      background: options?.background === true,
      scope: options?.scope ?? 'unknown',
      view,
    };
    const existing = refreshCyclesRef.current.get(repositoryId);
    if (existing) {
      existing.queued = existing.queued ? mergeRefreshRequests(existing.queued, request) : request;
      return existing.promise;
    }

    const cycle: { queued: RefreshRequest | null; promise: Promise<void> } = {
      queued: null,
      promise: Promise.resolve(),
    };
    cycle.promise = (async () => {
      let current: RefreshRequest | null = request;
      while (current) {
        await performRefresh(repositoryId, current);
        current = cycle.queued;
        cycle.queued = null;
      }
    })().finally(() => {
      if (refreshCyclesRef.current.get(repositoryId) === cycle) refreshCyclesRef.current.delete(repositoryId);
    });
    refreshCyclesRef.current.set(repositoryId, cycle);
    return cycle.promise;
  }, [performRefresh, repository, view]);

  useEffect(() => { busyRef.current = busy; }, [busy]);

  const remoteFetchIntervalSeconds = bootstrap?.preferences.remoteFetchIntervalSeconds ?? DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS;
  useEffect(() => {
    if (!repository || remoteFetchIntervalSeconds <= 0) return;
    const repositoryId = repository.id;
    let cancelled = false;
    let inFlight = false;

    const run = async () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      if (busyRef.current || repositorySyncOperationsRef.current.has(repositoryId)) return;
      inFlight = true;
      try {
        const result = await opentig.refs.fetch(repositoryId);
        if (cancelled || repositoryRef.current?.id !== repositoryId || result.status !== 'success') return;
        await refresh({ background: true, scope: 'refs' });
      } catch {
        // Periodic fetch stays silent; pull and push still surface remote errors.
      } finally {
        inFlight = false;
      }
    };

    void run();
    const timer = window.setInterval(() => { void run(); }, remoteFetchIntervalSeconds * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, remoteFetchIntervalSeconds, repository]);

  useEffect(() => {
    setSnapshotRepositoryId(null);
    clearCommitFilesCache();
    filesRef.current = null;
    setFiles(null);
    setCreatePrOpen(false);
    setQuickOpen(false);
  }, [repository?.id]);

  const loadPulls = useCallback(async (_states: PullRequestState[], forceStatus = false) => {
    if (forceStatus) forceGhStatusRef.current = true;
    await pullsQuery.refetch();
  }, [pullsQuery]);

  useEffect(() => {
    void refresh();
  }, [refresh, repository?.id, view]);

  // Switching worktree or sidebar view no longer discards the file session: the
  // tabs of each worktree are restored from persisted metadata the first time it
  // is shown, and Files reopens on whichever tab was last active there.
  useEffect(() => {
    const repositoryId = repository?.id;
    if (!repositoryId) {
      selectFilePath(null);
      return;
    }
    let session = fileSessionsRef.current.get(repositoryId);
    if (!session) {
      session = restoreSession(openFilesStates.find((state) => state.repositoryId === repositoryId) ?? null);
      const map = new Map(fileSessionsRef.current);
      map.set(repositoryId, session);
      fileSessionsRef.current = map;
      setFileSessions(map);
      persistedSessionsRef.current.set(repositoryId, JSON.stringify(serializeSession(session)));
    }
    selectFilePath(view === 'files' ? session.activePath : null);
  }, [openFilesStates, repository?.id, selectFilePath, view]);

  useEffect(() => opentig.events.onRepositoryChanged((repositoryId, scope) => {
    if (repositoryId === repository?.id) void refresh({ background: true, scope });
  }), [refresh, repository?.id]);

  useEffect(() => {
    if (!bootstrap?.performanceAutomation) return;
    const handleBurst = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (!action || typeof action !== 'object') return;
      const record = action as Record<string, unknown>;
      if (record.type !== 'refresh-burst') return;
      const count = Math.max(1, Math.min(100, Math.round(Number(record.count) || 20)));
      for (let index = 0; index < count; index += 1) {
        const scope: RepositoryChangeScope = index === count - 1 ? 'refs' : 'worktree';
        void refresh({ background: true, scope });
      }
    };
    window.addEventListener('opentig:performance-action', handleBurst);
    return () => window.removeEventListener('opentig:performance-action', handleBurst);
  }, [bootstrap?.performanceAutomation, refresh]);

  useEffect(() => {
    if (view !== 'files' || !repository) return;
    const reconcile = () => {
      if (document.visibilityState === 'visible') void refreshFilesOnly();
    };
    const timer = window.setInterval(reconcile, 5_000);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [refreshFilesOnly, repository, view]);

  const recordOpenedRepository = useCallback((selected: RepositoryInfo, previousId?: string) => {
    if (previousId && previousId !== selected.id) {
      const expandedPaths = filesTreeStates.get(previousId);
      filesTreeStates.delete(previousId);
      if (expandedPaths) filesTreeStates.set(selected.id, expandedPaths);

      const previousSession = fileSessionsRef.current.get(previousId);
      if (previousSession) {
        const sessions = new Map(fileSessionsRef.current);
        sessions.delete(previousId);
        sessions.set(selected.id, previousSession);
        fileSessionsRef.current = sessions;
        setFileSessions(sessions);
      }
      const drafts = fileDraftsRef.current.get(previousId);
      if (drafts) {
        fileDraftsRef.current.delete(previousId);
        fileDraftsRef.current.set(selected.id, drafts);
      }
      const persisted = persistedSessionsRef.current.get(previousId);
      if (persisted) {
        persistedSessionsRef.current.delete(previousId);
        persistedSessionsRef.current.set(selected.id, persisted);
      }
    }
    setRepository(selected);
    setBootstrap((current) => {
      if (!current) return current;
      const previous = previousId && previousId !== selected.id
        ? current.recentRepositories.find((item) => item.id === previousId)
        : null;
      let repositoryProjects = current.repositoryProjects;
      if (previous) {
        const previousKey = normalizeRepositoryKey(previous.commonDir);
        const nextKey = normalizeRepositoryKey(selected.commonDir);
        const destinationAlreadyAssigned = repositoryProjects.some((project) => (
          project.repositoryKeys.some((key) => key === nextKey && key !== previousKey)
        ));
        repositoryProjects = repositoryProjects.map((project) => ({
          ...project,
          repositoryKeys: [...new Set(project.repositoryKeys.flatMap((key) => (
            key !== previousKey ? [key] : destinationAlreadyAssigned ? [] : [nextKey]
          )))],
        }));
      }
      return {
        ...current,
        activeRepository: selected,
        repositoryProjects,
        recentRepositories: touchRecentRepositories(current.recentRepositories.filter((item) => item.id !== previousId || item.id === selected.id), selected, repositoryProjects),
        filesTreeStates: previous ? normalizeFilesTreeStates(current.filesTreeStates.map((state) => (
          state.repositoryId === previousId ? { ...state, repositoryId: selected.id } : state
        ))) : current.filesTreeStates,
        openFilesStates: previous ? normalizeOpenFilesStates(current.openFilesStates.map((state) => (
          state.repositoryId === previousId ? { ...state, repositoryId: selected.id } : state
        ))) : current.openFilesStates,
      };
    });
  }, [filesTreeStates]);

  const openRepository = useCallback(async () => {
    if (!window.opentigDesktop) { setOpenRepositoryDialog(true); return; }
    try {
      const selectedPath = await opentig.repository.select();
      if (!selectedPath) return;
      recordOpenedRepository(await opentig.repository.openPath(selectedPath));
    } catch (reason) { reportError('Could not open repository', reason); }
  }, [recordOpenedRepository]);

  useEffect(() => opentig.events.onActiveRepositoryChanged((selected) => {
    if (selected.id !== repositoryRef.current?.id) recordOpenedRepository(selected);
  }), [recordOpenedRepository]);

  useEffect(() => {
    const update = (event: KeyboardEvent) => setCtrlHeld(event.ctrlKey && !event.altKey && !event.metaKey);
    // A lost focus never delivers the keyup, so the hint would stay pinned open.
    const clear = () => setCtrlHeld(false);
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const updatePreference = async (partial: Partial<Preferences>) => {
    try {
      const preferences = await opentig.app.setPreferences(partial);
      setBootstrap((current) => current ? { ...current, preferences } : current);
    } catch (reason) { reportError('Could not save settings', reason); }
  };

  const persistFilesTreeExpandedPaths = useCallback((paths: string[]) => {
    if (!repository) return;
    filesTreeStates.set(repository.id, [...paths]);
    void opentig.app.setFilesTreeExpandedPaths(repository.id, paths)
      .catch((reason) => reportError('Could not save folder state', reason));
  }, [filesTreeStates, repository]);

  const runIndexOperation = async (mode: 'stage' | 'unstage', paths: string[]) => {
    if (!repository || !status || paths.length === 0) return;
    const previous = status;
    setStatus(optimisticStatus(status, paths, mode));
    setBusy(mode);
    setCommitProposal(null);
    setPreparedCommitIndex(null);
    try {
      if (mode === 'stage') await opentig.index.stage(repository.id, paths);
      else await opentig.index.unstage(repository.id, paths);
      await refresh({ background: true });
    } catch (reason) {
      setStatus(previous);
      reportError(mode === 'stage' ? 'Could not stage changes' : 'Could not unstage changes', reason);
    } finally { setBusy(null); }
  };

  const discardChanges = (paths: string[]) => {
    if (!repository || busy || status?.readOnly || paths.length === 0) return;
    setBusy('discard');
    setCommitProposal(null);
    setPreparedCommitIndex(null);
    setDestructiveAction(createDiscardAction(repository.id, paths, status?.changes ?? []));
  };

  /**
   * Changing the selection no longer discards anything: a file's unsaved draft
   * lives in App, so switching tabs, opening a diff, or moving to another
   * worktree simply leaves it in memory until it is saved or explicitly closed.
   */
  const selectViewer = useCallback((selection: ViewerSelection): boolean => {
    viewerSelectionRef.current = selection;
    setViewerSelection(selection);
    if (selection) setMobilePane('viewer');
    return true;
  }, []);

  /** The single entry point for every `type: 'file'` selection in the app. */
  const openFile = useCallback((path: string, mode: OpenMode = 'preview'): boolean => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return false;
    if (!selectViewer({ type: 'file', path })) return false;
    const current = fileSessionsRef.current.get(repositoryId) ?? emptyFileSession;
    const result = openTab(current, path, mode);
    if (result.evictedPath) dropFileDraft(repositoryId, result.evictedPath);
    if (result.overCap) {
      sileo.info({ title: 'Too many open files', description: 'Every open tab has unsaved changes, so none could be closed for you.' });
    }
    commitFileSession(repositoryId, result.session);
    return true;
  }, [commitFileSession, dropFileDraft, selectViewer]);

  const activateFileTab = useCallback((path: string) => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return;
    if (!selectViewer({ type: 'file', path })) return;
    updateFileSession(repositoryId, (session) => activateTab(session, path));
    setView('files');
  }, [selectViewer, updateFileSession]);

  const reorderFileTab = useCallback((path: string, toIndex: number) => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return;
    updateFileSession(repositoryId, (session) => moveTab(session, path, toIndex));
  }, [updateFileSession]);

  /**
   * Saves an inactive tab's draft through the same typed API and the same
   * expected-content check the mounted editor uses, so an external modification
   * still produces a conflict instead of a silent overwrite.
   */
  const saveFileDraft = useCallback(async (repositoryId: string, path: string): Promise<boolean> => {
    const draft = readFileDraft(repositoryId, path);
    if (!draft) return true;
    try {
      const result = await opentig.repository.writeFile(repositoryId, path, draft.content, draft.expectedContent);
      if (result.status === 'conflict') {
        sileo.error({ title: 'File changed on disk', description: `${path} — the unsaved version is still open.`, duration: 10_000 });
        return false;
      }
      dropFileDraft(repositoryId, path);
      updateFileSession(repositoryId, (session) => setTabDirty(session, path, false));
      await refreshFilesOnly();
      return true;
    } catch (reason) {
      sileo.error({ title: 'Could not save file', description: messageOf(reason), duration: 10_000 });
      return false;
    }
  }, [dropFileDraft, readFileDraft, refreshFilesOnly, updateFileSession]);

  const closeFileTab = useCallback(async (path: string) => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return;
    const session = fileSessionsRef.current.get(repositoryId) ?? emptyFileSession;
    const tab = session.tabs.find((item) => item.path === path);
    if (!tab) return;
    if (tab.dirty) {
      // One prompt at a time: a second close request while the dialog is open
      // would replace the pending resolver and leave the first one hanging.
      if (dirtyCloseResolverRef.current) return;
      const choice = await new Promise<DirtyCloseChoice>((resolve) => {
        dirtyCloseResolverRef.current = resolve;
        setDirtyClosePath(path);
      });
      setDirtyClosePath(null);
      dirtyCloseResolverRef.current = null;
      if (choice === 'cancel') return;
      // A conflict keeps both the tab and its draft; the user decides again.
      if (choice === 'save' && !(await saveFileDraft(repositoryId, path))) return;
    }
    dropFileDraft(repositoryId, path);
    const current = fileSessionsRef.current.get(repositoryId) ?? emptyFileSession;
    const result = closeTab(current, path);
    commitFileSession(repositoryId, result.session);
    const selection = viewerSelectionRef.current;
    if (selection?.type === 'file' && selection.path === path) selectFilePath(result.activePath);
  }, [commitFileSession, dropFileDraft, saveFileDraft, selectFilePath]);

  const runTabKeyboardAction = useCallback((action: TabKeyboardAction) => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return;
    const session = fileSessionsRef.current.get(repositoryId) ?? emptyFileSession;
    const result = applyKeyboardAction(session, action);
    if (result.closeRequest) {
      void closeFileTab(result.closeRequest);
      return;
    }
    if (result.session === session) return;
    commitFileSession(repositoryId, result.session);
    if (result.session.activePath !== session.activePath) {
      selectFilePath(result.session.activePath);
      setMobilePane('viewer');
      setView('files');
    }
  }, [closeFileTab, commitFileSession, selectFilePath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesCombo(event, shortcuts.openRepository)) { event.preventDefault(); void openRepository(); }
      if (matchesCombo(event, shortcuts.refresh)) { event.preventDefault(); void refresh(); }
      if (repository && event.ctrlKey && !event.altKey && !event.metaKey) {
        const section = SIDEBAR_VIEWS[Number(event.key) - 1];
        if (section) { event.preventDefault(); setView(section); }
      }
      // Deliberately reachable from inside an editor: none of these produce
      // text, and VS Code binds them the same way while typing.
      const tabAction = repository ? openFileTabShortcut(event, shortcuts) : null;
      if (tabAction) {
        event.preventDefault();
        if (!event.repeat) runTabKeyboardAction(tabAction);
      }
      if (repository && !event.repeat && matchesCombo(event, shortcuts.quickOpen)) {
        if (!quickOpen && document.querySelector('[data-slot="dialog-popup"]')) return;
        event.preventDefault();
        setQuickOpen(true);
        void refreshFilesOnly();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openRepository, quickOpen, refresh, refreshFilesOnly, repository, runTabKeyboardAction, shortcuts]);

  // One guard for every worktree's drafts. Per-editor listeners could only see
  // the file currently on screen, so switching tabs would drop the warning.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const dirty = [...fileSessionsRef.current.values()].some((session) => session.tabs.some((tab) => tab.dirty));
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const reconcileViewerPaths = (changes: FileHistoryPathChange[], removedPaths: string[]) => {
    const repositoryId = repositoryRef.current?.id;
    if (repositoryId) {
      const session = fileSessionsRef.current.get(repositoryId) ?? emptyFileSession;
      const removal = removeTabsUnder(session, removedPaths);
      for (const path of removal.closedPaths) dropFileDraft(repositoryId, path);
      const renaming = renameTabPaths(removal.session, changes.map((change) => ({ from: change.from, to: change.to })));
      renameFileDrafts(repositoryId, renaming.renamed);
      commitFileSession(repositoryId, renaming.session);
    }

    const current = viewerSelectionRef.current;
    if (current?.type !== 'file') return;
    if (removedPaths.some((item) => pathContains(item, current.path))) {
      const session = repositoryId ? fileSessionsRef.current.get(repositoryId) : undefined;
      selectFilePath(session?.activePath ?? null);
      return;
    }
    const change = changes.find((item) => pathContains(item.from, current.path));
    if (!change) return;
    const nextPath = `${change.to}${current.path.slice(change.from.length)}`;
    pendingViewerPathRef.current = nextPath;
    selectFilePath(nextPath);
    setRefreshVersion((version) => version + 1);
  };

  const performFileHistory = async (direction: 'undo' | 'redo') => {
    if (!repository || busy || status?.readOnly) return;
    const dirty = anyDirtyTab();
    if (dirty.length > 0) {
      sileo.info({ title: `Save open files before ${direction === 'undo' ? 'undoing' : 'redoing'} a file operation`, description: dirty.join(', ') });
      return;
    }
    setBusy(`${direction}-file`);
    try {
      const result = direction === 'undo'
        ? await opentig.repository.undoFileOperation(repository.id)
        : await opentig.repository.redoFileOperation(repository.id);
      setFileHistoryState(result.state);
      if (result.status === 'empty') return;
      if (result.status === 'conflict') {
        sileo.error({ title: `Could not ${direction} ${sentenceCaseLabel(result.label)}`, description: result.message, duration: 10_000 });
        return;
      }
      if (result.status === 'system-trash') {
        sileo.info({ title: `${sentenceCaseLabel(result.label)} cannot be undone in OpenTig`, description: 'Restore it from system trash.' });
        return;
      }
      reconcileViewerPaths(result.pathChanges, result.removedPaths);
      await refresh({ background: true });
      sileo.success({ title: `${direction === 'undo' ? 'Undid' : 'Redid'} ${sentenceCaseLabel(result.label)}` });
    } catch (reason) {
      sileo.error({ title: `Could not ${direction} a file operation`, description: messageOf(reason), duration: 10_000 });
    } finally { setBusy(null); }
  };

  const copyFilePaths = async (entries: FileTreeEntry[]) => {
    if (!repository || entries.length === 0) return;
    try {
      const paths = await Promise.all(entries.map((entry) => opentig.repository.getAbsolutePath(repository.id, entry.path)));
      await writeClipboardText(paths.join('\n'));
      sileo.success({
        title: paths.length === 1 ? 'Path copied' : `${paths.length} paths copied`,
        description: entries.length === 1 ? entries[0]!.path : undefined,
      });
    } catch (reason) {
      sileo.error({ title: 'Could not copy path', description: messageOf(reason) });
    }
  };

  const copyFileContents = async (entry: FileTreeEntry) => {
    if (!repository || entry.type !== 'file') return;
    try {
      const result = await opentig.repository.readFile(repository.id, entry.path);
      if (result.binary) {
        sileo.info({ title: 'Binary files cannot be copied as text', description: entry.path });
        return;
      }
      if (result.tooLarge) {
        sileo.info({ title: 'File is too large to copy safely', description: entry.path });
        return;
      }
      await writeClipboardText(result.content);
      sileo.success({ title: 'File copied', description: entry.path });
    } catch (reason) {
      sileo.error({ title: 'Could not copy file', description: messageOf(reason) });
    }
  };

  const copyFileEntries = async (entries: FileTreeEntry[]) => {
    if (!repository || entries.length === 0) return;
    try {
      const result = await opentig.repository.copyEntries(repository.id, entries.map((entry) => entry.path));
      await writeFileTransfer(result.paths);
      sileo.success({
        title: entries.length === 1 ? (entries[0]!.type === 'directory' ? 'Folder copied' : 'File copied') : `${entries.length} items copied`,
        description: 'Select a destination folder in the file browser and press Ctrl+V.',
      });
    } catch (reason) {
      sileo.error({ title: 'Could not copy item', description: messageOf(reason) });
    }
  };

  const cutFileEntries = async (entries: FileTreeEntry[]) => {
    if (!repository || busy || status?.readOnly || entries.length === 0) return;
    const dirty = unsavedTabsUnder(entries.map((entry) => entry.path));
    if (dirty.length > 0) {
      sileo.info({ title: 'Save open files before cutting them', description: dirty.join(', ') });
      return;
    }
    try {
      const result = await opentig.repository.cutEntries(repository.id, entries.map((entry) => entry.path));
      await writeFileTransfer(result.paths, result.transferId);
      sileo.success({
        title: entries.length === 1 ? (entries[0]!.type === 'directory' ? 'Folder cut' : 'File cut') : `${entries.length} items cut`,
        description: 'Select a destination folder in the file browser and press Ctrl+V.',
      });
    } catch (reason) {
      sileo.error({ title: 'Could not cut item', description: messageOf(reason) });
    }
  };

  const pasteFileEntries = async (targetDirectory: string) => {
    if (!repository || busy || status?.readOnly || !capabilities?.fileClipboard) return;
    setBusy('paste-file');
    try {
      const sourcePaths = await opentig.clipboard.readFilePaths();
      const imagePng = sourcePaths.length === 0 ? await opentig.clipboard.readImagePng() : null;
      const result = await opentig.repository.pasteEntries(repository.id, targetDirectory, sourcePaths, fileCutTransferId(sourcePaths), imagePng);
      if (result.status === 'empty') {
        sileo.info({ title: 'Clipboard does not contain files or an image' });
        return;
      }
      await refresh({ background: true });
      await refreshFileHistoryState();
      const destination = targetDirectory || repository.name;
      sileo.success({
        title: result.source === 'image'
          ? 'Clipboard image pasted'
          : result.source === 'cut'
            ? `${result.created.length} ${result.created.length === 1 ? 'item' : 'items'} moved`
            : `${result.created.length} ${result.created.length === 1 ? 'item' : 'items'} pasted`,
        description: destination,
        button: { title: 'Undo', onClick: () => void performFileHistory('undo') },
      });
    } catch (reason) {
      sileo.error({ title: 'Could not paste item', description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const moveFileEntries = async (entries: FileTreeEntry[], targetDirectory: string) => {
    if (!repository || busy || status?.readOnly || entries.length === 0) return;
    const dirty = unsavedTabsUnder(entries.map((entry) => entry.path));
    if (dirty.length > 0) {
      sileo.info({ title: 'Save open files before moving them', description: dirty.join(', ') });
      return;
    }
    setBusy('move-file');
    try {
      const result = await opentig.repository.moveEntries(repository.id, entries.map((entry) => entry.path), targetDirectory);
      const moved = result.moved.length;
      const conflicts = result.conflicts.length;
      reconcileViewerPaths(result.moved, []);
      await refresh({ background: true });
      await refreshFileHistoryState();
      if (conflicts > 0) {
        sileo.error({ title: conflicts === 1 ? 'An item with that name already exists' : `${conflicts} items already exist in the destination` });
      }
      if (moved > 0) {
        sileo.success({ title: moved === 1 ? 'Item moved' : `${moved} items moved`, description: targetDirectory || repository.name, button: { title: 'Undo', onClick: () => void performFileHistory('undo') } });
      }
    } catch (reason) {
      sileo.error({ title: 'Could not move item', description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const deleteFileEntries = async (entries: FileTreeEntry[]) => {
    if (!repository || busy || status?.readOnly || entries.length === 0) return;
    setBusy('delete-file');
    setDestructiveAction(createDeleteAction(repository.id, entries));
  };

  const settleDestructiveAction = async (confirmed: boolean) => {
    const action = destructiveAction;
    if (!action || destructiveActionInFlightRef.current) return;
    if (repositoryRef.current?.id !== action.repositoryId) {
      setDestructiveAction(null);
      setBusy(null);
      return;
    }
    if (!confirmed) {
      await dispatchDestructiveAction(action, false, {
        discard: (repositoryId, paths) => opentig.index.discard(repositoryId, paths),
        deleteEntries: (repositoryId, paths) => opentig.repository.deleteEntries(repositoryId, paths),
      });
      setDestructiveAction(null);
      setBusy(null);
      return;
    }
    destructiveActionInFlightRef.current = true;
    setDestructiveAction(null);
    try {
      const outcome = await dispatchDestructiveAction(action, true, {
        discard: (repositoryId, paths) => opentig.index.discard(repositoryId, paths),
        deleteEntries: (repositoryId, paths) => opentig.repository.deleteEntries(repositoryId, paths),
      });
      if (!outcome) return;
      if (outcome.kind === 'discard') {
        await refresh({ background: true });
        return;
      }
      const result = outcome.result;
      if (result.deleted === 0) return;
      // Clean tabs under the deleted paths close; a tab with unsaved changes is
      // kept and flagged missing so its text can still be recovered.
      reconcileViewerPaths([], action.paths);
      await refreshFilesOnly();
      await refreshFileHistoryState();
      sileo.success({
        title: result.deleted === 1 ? 'Moved to system trash' : `${result.deleted} items moved to system trash`,
        ...(result.recovery === 'undo'
          ? { description: 'Undo available', button: { title: 'Undo', onClick: () => void performFileHistory('undo') } }
          : { description: 'Restore from system trash' }),
      });
    } catch (reason) {
      const message = messageOf(reason);
      if (action.kind === 'delete') {
        sileo.error({ title: 'Could not delete item', description: message, duration: 10_000 });
      } else sileo.error({ title: 'Could not discard changes', description: message, duration: 10_000 });
    } finally {
      destructiveActionInFlightRef.current = false;
      setBusy(null);
    }
  };

  const revealFileEntry = async (entry: FileTreeEntry) => {
    if (!repository) return;
    try {
      await opentig.repository.revealEntry(repository.id, entry.path);
    } catch (reason) {
      sileo.error({ title: 'Could not reveal item', description: messageOf(reason) });
    }
  };

  const renameFileEntry = async (entry: FileTreeEntry, newName: string) => {
    if (!repository || busy || status?.readOnly) return;
    const dirty = unsavedTabsUnder([entry.path]);
    if (dirty.length > 0) {
      sileo.info({ title: 'Save open files before renaming them', description: dirty.join(', ') });
      return;
    }
    setBusy('rename-file');
    try {
      const result = await opentig.repository.renameEntry(repository.id, entry.path, newName);
      if (result.status === 'noop') return;
      if (result.status === 'conflict') {
        sileo.error({ title: 'An item with that name already exists', description: result.path });
        return;
      }
      reconcileViewerPaths([{ from: result.from, to: result.to }], []);
      await refresh({ background: true });
      await refreshFileHistoryState();
      sileo.success({ title: entry.type === 'directory' ? 'Folder renamed' : 'File renamed', description: `${result.from} → ${result.to}`, button: { title: 'Undo', onClick: () => void performFileHistory('undo') } });
    } catch (reason) {
      sileo.error({ title: 'Could not rename item', description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const createFileEntry = async (targetDirectory: string, name: string, kind: 'file' | 'directory') => {
    if (!repository || busy || status?.readOnly) return;
    setBusy('create-file');
    try {
      const result = await opentig.repository.createEntry(repository.id, targetDirectory, name, kind);
      if (result.status === 'conflict') {
        sileo.error({ title: 'An item with that name already exists', description: result.path });
        return;
      }
      if (result.kind === 'file') {
        pendingViewerPathRef.current = result.path;
        openFile(result.path);
      }
      await refreshFilesOnly();
      await refreshFileHistoryState();
      sileo.success({ title: result.kind === 'directory' ? 'Folder created' : 'File created', description: result.path, button: { title: 'Undo', onClick: () => void performFileHistory('undo') } });
    } catch (reason) {
      sileo.error({ title: 'Could not create item', description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const runAll = async (mode: 'stage' | 'unstage') => {
    if (!repository || !status) return;
    const paths = status.changes.filter((item) => mode === 'stage' ? item.unstaged : item.staged).map((item) => item.path);
    if (!paths.length) return;
    const previous = status;
    setStatus(optimisticStatus(status, paths, mode));
    setBusy(mode);
    setCommitProposal(null);
    setPreparedCommitIndex(null);
    try {
      if (mode === 'stage') await opentig.index.stageAll(repository.id);
      else await opentig.index.unstageAll(repository.id);
      await refresh({ background: true });
    } catch (reason) { setStatus(previous); reportError(mode === 'stage' ? 'Could not stage changes' : 'Could not unstage changes', reason); }
    finally { setBusy(null); }
  };

  const createCommit = async (options?: { push?: boolean }) => {
    if (!repository || !status?.stagedCount || !commitMessage.trim()) return;
    setBusy('commit');
    let committed = false;
    try {
      const result = await opentig.commits.create(repository.id, commitMessage);
      const subject = commitMessage.split(/\r?\n/, 1)[0] ?? commitMessage;
      setCommitMessage('');
      // Completed groups stay in the plan, marked done. Removing them would
      // renumber the remaining ones under the user after every commit.
      if (commitProposal && preparedCommitIndex !== null) {
        const done = new Set(completedCommitIndices).add(preparedCommitIndex);
        setCompletedCommitIndices(done);
        setPreparedCommitIndex(null);
        if (done.size === commitProposal.commits.length) {
          setCommitProposal(null);
          setCompletedCommitIndices(new Set());
          sileo.success({ title: 'Commit plan finished', description: `${done.size} commits created.` });
        }
      } else {
        setCommitProposal(null);
        setPreparedCommitIndex(null);
        setCompletedCommitIndices(new Set());
      }
      lastAppliedMessageRef.current = '';
      setViewerSelection({ type: 'commit', oid: result.oid, subject });
      setMobilePane('viewer');
      await refresh({ background: true });
      committed = true;
    } catch (reason) { reportError('Could not create the commit', reason); }
    finally { setBusy(null); }
    // The refreshed status has not reached this closure yet, so push without
    // re-checking how many commits are ahead.
    if (committed && options?.push) await performPush();
  };

  const openAiSettings = () => {
    setSettingsSection('ai');
    setSettingsOpen(true);
  };

  const cancelCommitMessageGeneration = async () => {
    const active = generationRequest.current;
    if (!active) return;
    await opentig.ai.cancelGeneration(active.id).catch(() => undefined);
  };

  const generateCommitMessage = async () => {
    if (!bootstrap || !repository || !status?.stagedCount || status.readOnly || generating) return;
    const harness = bootstrap.preferences.commitMessageHarness;
    const model = bootstrap.preferences.commitMessageModels[harness] ?? 'default';
    const requestId = crypto.randomUUID();
    generationRequest.current = { id: requestId, repositoryId: repository.id };
    setGenerating(requestId);
    try {
      const result = await opentig.ai.generateCommitMessage({ repositoryId: repository.id, harness, model, requestId });
      if (generationRequest.current?.id !== requestId || generationRequest.current.repositoryId !== repository.id) return;
      setCommitMessage(result.message);
      lastAppliedMessageRef.current = result.message;
      setCommitProposal(result.proposal);
      setPreparedCommitIndex(null);
      setCompletedCommitIndices(new Set());
      setCommitPlanCollapsed(false);
      sileo.success({
        title: `Message generated with ${harnessLabel(result.harness)}`,
        description: result.proposal
          ? `${result.proposal.commits.length} focused commits may be clearer than one.`
          // Silence used to hide both "the model saw no split" and "OpenTig
          // refused to offer one"; only the second needs explaining.
          : result.splitBlockedReason
            ? `No commit split was offered: ${result.splitBlockedReason.charAt(0).toLowerCase()}${result.splitBlockedReason.slice(1)}`
            : result.contextWasTruncated
              ? 'A truncated version of the staged diff was used.'
              : undefined,
        ...(result.splitBlockedReason ? { duration: 8_000 } : {}),
      });
    } catch (reason) {
      const detail = aiDetail(reason);
      if (detail?.code === 'AI_CANCELLED') {
        sileo.info({ title: 'Generation canceled' });
      } else {
        const settingsAction = detail?.code === 'AI_CLI_NOT_FOUND' || detail?.code === 'AI_AUTH_REQUIRED' || detail?.code === 'AI_MODEL_UNAVAILABLE';
        sileo.error({
          title: aiErrorTitle(detail),
          description: detail?.message ?? messageOf(reason),
          duration: 10_000,
          ...(settingsAction ? { button: { title: 'Open settings', onClick: openAiSettings } } : {}),
        });
      }
    } finally {
      if (generationRequest.current?.id === requestId) generationRequest.current = null;
      setGenerating((current) => current === requestId ? null : current);
    }
  };

  const prepareCommitGroup = async (index: number) => {
    const proposal = commitProposal;
    const group = proposal?.commits[index];
    if (!repository || !status || !proposal || !group || status.readOnly || busy) return;
    // Preparing a different group unstages the one already prepared, so the work
    // waiting in the index is only discarded when the user says so.
    if (preparedCommitIndex !== null && preparedCommitIndex !== index
      && !window.confirm('Commit group ' + (preparedCommitIndex + 1) + ' is staged and not committed yet. Prepare a different group and unstage it?')) {
      return;
    }
    // The generated message is only overwritten when it is still the generated
    // one; anything typed by hand is the user's to keep.
    if (commitMessage.trim() && commitMessage !== lastAppliedMessageRef.current
      && !window.confirm('Replace the commit message you wrote with the one from this group?')) {
      return;
    }
    setBusy('prepare-commit-group');
    try {
      await opentig.index.prepareCommitGroup({
        repositoryId: repository.id,
        paths: group.paths,
        expectedStagedPaths: status.changes.filter((change) => change.staged && !change.conflict).map((change) => change.path).sort(),
        expectedFingerprint: group.fingerprint,
      });
      setCommitMessage(group.message);
      lastAppliedMessageRef.current = group.message;
      setPreparedCommitIndex(index);
      await refresh({ background: true });
      sileo.success({ title: 'Commit group prepared', description: `${group.paths.length} ${group.paths.length === 1 ? 'file is' : 'files are'} staged. Review the diff before committing.` });
      window.setTimeout(() => commitTextareaRef.current?.focus(), 0);
    } catch (reason) {
      // The plan survives a failed prepare: regenerating it costs another model
      // call, and most failures here are recoverable.
      setPreparedCommitIndex(null);
      sileo.error({ title: 'Could not prepare the commit group', description: messageOf(reason), duration: 10_000 });
      await refresh({ background: true });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const active = generationRequest.current;
    if (active && active.repositoryId !== repository?.id) void opentig.ai.cancelGeneration(active.id);
    setCommitProposal(null);
    setPreparedCommitIndex(null);
  }, [repository?.id]);

  useEffect(() => () => {
    const active = generationRequest.current;
    if (active) void opentig.ai.cancelGeneration(active.id);
  }, []);

  const selectRecent = async (id: string | null) => {
    if (!id || id === repository?.id) return;
    try {
      try {
        const selected = await opentig.repository.openRecent(id);
        if (selected) recordOpenedRepository(selected, id);
      } catch (reason) {
        const recent = bootstrap?.recentRepositories.find((candidate) => candidate.id === id);
        if (!recent) throw reason;
        const selectedPath = await opentig.repository.selectRelocation(recent.repositoryName, recent.path);
        if (!selectedPath) return;
        recordOpenedRepository(await opentig.repository.relocateRecent(id, selectedPath), id);
      }
    }
    catch (reason) { reportError('Could not open repository', reason); }
  };

  const switchBranch = async (name: string | null) => {
    if (!repository || !name || name === status?.branch) return;
    setBusy('branch');
    try {
      const result = await opentig.refs.switchBranch(repository.id, name, false);
      if (result.status === 'blocked-local-changes') {
        const label = branches.find((branch) => branch.fullName === name)?.name ?? name.replace(/^refs\/(?:heads|remotes)\//, '');
        setBlockedBranchSwitch({ ref: name, label, files: result.files });
        return;
      }
      await refresh({ background: true });
    }
    catch (reason) { reportError('Could not switch branch', reason); }
    finally { setBusy(null); }
  };

  const moveChangesAndSwitchBranch = async () => {
    const pending = blockedBranchSwitch;
    if (!repository || !pending) return;
    setBusy('branch');
    try {
      const result = await opentig.refs.switchBranch(repository.id, pending.ref, true);
      if (result.status === 'blocked-local-changes') {
        setBlockedBranchSwitch({ ...pending, files: result.files });
        return;
      }
      setBlockedBranchSwitch(null);
      setView('changes');
      await refresh({ background: true });
      if (result.status === 'switched') {
        sileo.success({
          title: `Switched to ${pending.label}`,
          description: result.movedChanges ? 'Local changes were moved here and left unstaged.' : 'The branch was switched successfully.',
        });
      } else if (result.status === 'moved-with-conflicts') {
        const toast = {
          id: conflictToastId(repository.id),
          title: `Switched to ${pending.label} with conflicts`,
          description: `${result.files.length} ${result.files.length === 1 ? 'file needs' : 'files need'} resolution. The safety stash was kept.`,
          duration: 12_000,
          button: { title: 'View conflicts', onClick: () => showConflicts(result.files) },
        };
        sileo.error(toast);
      } else {
        sileo.error({
          title: 'Could not restore every local change',
          description: result.recoveredChanges
            ? 'Some changes were recovered and the safety stash was kept.'
            : 'The safety stash was kept so the changes can be recovered.',
          duration: 12_000,
        });
      }
    } catch (reason) {
      reportError('Could not move changes to the branch', reason);
      await refresh({ background: true });
    } finally {
      setBusy(null);
    }
  };

  const switchWorktree = async (targetPath: string | null) => {
    if (!repository || !targetPath || targetPath === repository.path) return;
    setBusy('worktree');
    try { recordOpenedRepository(await opentig.refs.selectWorktree(repository.id, targetPath)); }
    catch (reason) { reportError('Could not switch worktree', reason); }
    finally { setBusy(null); }
  };

  /**
   * Runs after any successful branch/worktree management mutation. Toolbar
   * entries are never removed optimistically; only a real backend result
   * reaches this point.
   */
  const handleRefsManaged = (recentRepositories: RecentRepository[] | null) => {
    if (recentRepositories) setBootstrap((current) => current ? { ...current, recentRepositories } : current);
    // A removed branch or worktree can change status, branches, worktrees, and
    // the visible history, so this asks for the full background refresh.
    void refresh({ background: true });
  };

  const loadMore = async () => {
    if (!repository || !nextCursor) return;
    setBusy('history');
    try {
      await historyQuery.fetchNextPage();
    } catch (reason) { reportError('Could not load more history', reason); }
    finally { setBusy(null); }
  };

  const undoLatestCommit = async () => {
    if (!repository || !undoCommit || undoingCommit) return;
    const selected = undoCommit;
    setUndoingCommit(true);
    try {
      const result = await opentig.commits.undoLatest(repository.id, selected.oid);
      if (result.status === 'success') {
        setUndoCommit(null);
        setViewerSelection(null);
        setView('changes');
        if (!commitMessage.trim()) {
          setCommitMessage(result.message);
        } else {
          sileo.success({
            title: 'Commit undone',
            description: 'Its changes are staged again. Your draft was preserved.',
            button: { title: 'Use previous message', onClick: () => setCommitMessage(result.message) },
          });
          await refresh({ background: true });
          window.setTimeout(() => commitTextareaRef.current?.focus(), 0);
          return;
        }
        sileo.success({ title: 'Commit undone', description: 'Its changes are staged again.' });
        await refresh({ background: true });
        window.setTimeout(() => commitTextareaRef.current?.focus(), 0);
        return;
      }
      setUndoCommit(null);
      const copy = undoBlockedCopy(result);
      sileo.error({ title: copy.title, description: copy.description, duration: 10_000 });
      await refresh({ background: true });
    } catch (reason) {
      sileo.error({ title: 'Could not undo commit', description: messageOf(reason), duration: 10_000 });
    } finally {
      setUndoingCommit(false);
    }
  };

  const showConflicts = useCallback((files: string[]) => {
    setView('changes');
    const first = files[0];
    if (first) { setViewerSelection({ type: 'conflict', path: first }); setMobilePane('viewer'); }
  }, []);

  const conflictPathSignature = (status?.changes ?? [])
    .filter((change) => change.conflict)
    .map((change) => change.path)
    .sort()
    .join('\0');
  useEffect(() => {
    if (!repository || !status) return;
    const paths = conflictPathSignature ? conflictPathSignature.split('\0') : [];
    const previous = knownConflictPathsRef.current.get(repository.id);
    const action = conflictNotificationAction(previous, paths);
    knownConflictPathsRef.current.set(repository.id, paths);
    const id = conflictToastId(repository.id);
    if (action === 'dismiss') {
      sileo.dismiss(id);
      return;
    }
    if (action !== 'show') return;
    const toast = {
      id,
      title: paths.length === 1 ? 'Conflict needs resolution' : `${paths.length} conflicts need resolution`,
      description: 'Open the conflicts section to choose the version to keep.',
      duration: 10_000,
      button: { title: 'View conflicts', onClick: () => showConflicts(paths) },
    };
    sileo.error(toast);
  }, [conflictPathSignature, repository, showConflicts, status]);

  const resolveConflictFile = async (path: string, content: string): Promise<boolean> => {
    if (!repository || busy) return false;
    setBusy('resolve-conflict');
    try {
      await opentig.index.resolveConflict(repository.id, path, content);
      sileo.success({ title: 'Conflict marked as resolved', description: path });
      setViewerSelection({ type: 'diff', path, kind: 'staged' });
      await refresh({ background: true });
      return true;
    } catch (reason) {
      const message = messageOf(reason);
      sileo.error({ title: 'Could not resolve conflict', description: message, duration: 10_000 });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const updateConflictFile = async (path: string, content: string): Promise<boolean> => {
    if (!repository) return false;
    try {
      await opentig.index.updateConflict(repository.id, path, content);
      return true;
    } catch (reason) {
      const message = messageOf(reason);
      sileo.error({ title: 'Could not apply selection', description: message, duration: 10_000 });
      return false;
    }
  };

  const pullUpdates = async () => {
    if (!repository || busy) return;
    const repositoryId = repository.id;
    const pendingBehind = status?.behind ?? 0;
    setBusy('pull');
    try {
      await sileo.promise(async () => {
        const result = await opentig.refs.pull(repositoryId);
        await refresh({ background: true });
        if (result.status === 'success' || result.status === 'up-to-date') return result;
        throw new PullBlocked(result);
      }, {
        loading: repositorySyncLoadingToast(repositoryId, 'pull', pendingBehind > 0 ? `Pulling ${pendingBehind} ${pendingBehind === 1 ? 'commit' : 'commits'}…` : 'Pulling changes…'),
        success: (result) => pullSuccessCopy(result),
        error: (err) => {
          if (err instanceof PullBlocked) {
            const result = err.result;
            if (result.status === 'blocked-conflicts') {
              return {
                title: 'Could not pull changes',
                description: `Resolve ${result.files.length === 1 ? 'the pending conflict' : `${result.files.length} pending conflicts`} before updating.`,
                duration: 10_000,
                button: { title: 'View conflicts', onClick: () => showConflicts(result.files) },
              };
            }
            if (result.status === 'stash-conflict') {
              return {
                title: result.updated ? 'Update completed with local conflicts' : 'Could not restore local changes',
                description: 'The safety stash was preserved. Resolve the conflicts to continue.',
                duration: 12_000,
                button: { title: 'View conflicts', onClick: () => showConflicts(result.files) },
              };
            }
            if (result.status === 'restore-failed') {
              return {
                title: 'Could not automatically restore local changes',
                description: result.recoveredChanges
                  ? 'Some changes are visible and the safety stash was preserved. Do not continue until you review them.'
                  : 'The worktree is still clean and the safety stash remains intact.',
                duration: 12_000,
              };
            }
            if (result.status === 'rebase-conflict') {
              return {
                title: 'Could not rebase onto the remote',
                description: result.files.length > 0
                  ? `Your local commits overlap the remote changes in ${result.files.length === 1 ? result.files[0] : `${result.files.length} files`}. The branch was left unchanged.`
                  : 'Your local commits overlap the remote changes. The branch was left unchanged.',
                duration: 10_000,
              };
            }
            if (result.status === 'diverged') {
              return {
                title: 'Branch has diverged',
                description: `${result.ahead} ahead and ${result.behind} behind.`,
                duration: 10_000,
              };
            }
            if (result.status === 'no-upstream') {
              return { title: 'Branch has no upstream configured', duration: 10_000 };
            }
            return {
              title: 'A Git operation is in progress',
              description: `Finish or cancel ${result.operation} before updating.`,
              duration: 10_000,
            };
          }
          const message = messageOf(err);
          return { title: 'Could not pull changes', description: message, duration: 10_000 };
        },
      });
    } catch {
      // sileo.promise() already rendered the matching error toast above.
    } finally {
      setBusy(null);
    }
  };

  const pushUpdates = async () => {
    if (!status || status.ahead === 0 || busy) return;
    await performPush();
  };

  const performPush = async () => {
    if (!repository) return;
    const repositoryId = repository.id;
    setBusy('push');
    try {
      await sileo.promise(async () => {
        const result = await opentig.refs.push(repositoryId);
        await refresh({ background: true });
        if (result.status === 'success' || result.status === 'up-to-date') return result;
        throw new PushBlocked(result);
      }, {
        loading: { title: 'Pushing commits…' },
        success: (result) => result.status === 'success'
          ? { title: `${result.commits} ${result.commits === 1 ? 'commit pushed' : 'commits pushed'}` }
          : { title: 'No commits pending push' },
        error: (err) => {
          if (err instanceof PushBlocked) {
            const result = err.result;
            if (result.status === 'blocked-conflicts') {
              return {
                title: 'Could not push commits',
                description: `Resolve ${result.files.length === 1 ? 'the pending conflict' : `${result.files.length} pending conflicts`} before continuing.`,
                duration: 10_000,
                button: { title: 'View conflicts', onClick: () => showConflicts(result.files) },
              };
            }
            if (result.status === 'blocked-operation') {
              return { title: 'A Git operation is in progress', description: `Finish or cancel ${result.operation} before pushing.`, duration: 10_000 };
            }
            if (result.status === 'no-upstream') {
              return { title: 'Branch has no upstream configured', description: 'Configure a remote branch before pushing.', duration: 10_000 };
            }
            if (result.status === 'diverged') {
              return {
                title: 'The remote contains new changes',
                description: `${result.ahead} ahead and ${result.behind} behind. Pull rebases your local commits on top when there are no conflicts.`,
                duration: 10_000,
                button: { title: 'Pull', onClick: () => void pullUpdates() },
              };
            }
            return { title: 'Could not push commits', description: result.message, duration: 10_000 };
          }
          const message = messageOf(err);
          return { title: 'Could not push commits', description: message, duration: 10_000 };
        },
      });
    } catch {
      // sileo.promise() already rendered the matching error toast above.
    } finally {
      setBusy(null);
    }
  };

  const syncRepository = async (item: RepositoryOption, projectName: string | null, action: ProjectSyncAction) => {
    const repositoryId = item.recent.id;
    if (repositorySyncOperationsRef.current.has(repositoryId)) return;
    repositorySyncOperationsRef.current.set(repositoryId, action);
    setRepositorySyncOperations(new Map(repositorySyncOperationsRef.current));

    try {
      const label = projectName ? `${projectName} · ${item.name}` : item.name;
      if (action === 'pull') {
        await sileo.promise(async () => {
          const result = await opentig.refs.pull(repositoryId);
          if (repositoryRef.current?.id === repositoryId) await refresh({ background: true });
          if (result.status === 'success' || result.status === 'up-to-date') return result;
          throw new PullBlocked(result);
        }, {
          loading: repositorySyncLoadingToast(repositoryId, action, `Pulling ${label}…`),
          success: (result) => projectPullSuccessCopy(label, result),
          error: (reason) => reason instanceof PullBlocked
            ? projectPullBlockedCopy(label, reason.result)
            : { title: `Could not pull ${label}`, description: messageOf(reason), duration: 10_000 },
        });
      } else {
        await sileo.promise(async () => {
          const result = await opentig.refs.push(repositoryId);
          if (repositoryRef.current?.id === repositoryId) await refresh({ background: true });
          if (result.status === 'success' || result.status === 'up-to-date') return result;
          throw new PushBlocked(result);
        }, {
          loading: repositorySyncLoadingToast(repositoryId, action, `Pushing ${label}…`),
          success: (result) => projectPushSuccessCopy(label, result),
          error: (reason) => reason instanceof PushBlocked
            ? projectPushBlockedCopy(label, reason.result)
            : { title: `Could not push ${label}`, description: messageOf(reason), duration: 10_000 },
        });
      }
    } catch {
      // Sileo rendered the repository-specific failure.
    } finally {
      repositorySyncOperationsRef.current.delete(repositoryId);
      setRepositorySyncOperations(new Map(repositorySyncOperationsRef.current));
    }
  };

  const ensureRepositoryCanBeManaged = (option: RepositoryOption) => {
    const ids = bootstrap?.recentRepositories.filter((item) => normalizeRepositoryKey(item.commonDir) === option.key).map((item) => item.id) ?? [];
    if (ids.some((id) => dirtyTabs(fileSessionsRef.current.get(id) ?? emptyFileSession).length > 0)) {
      throw new Error('Save or close unsaved files in this repository and its worktrees first.');
    }
    if (busy || ids.some((id) => repositorySyncOperationsRef.current.has(id))) {
      throw new Error('Wait for the current repository operation to finish.');
    }
    return ids;
  };

  const forgetRepository = async (option: RepositoryOption) => {
    const ids = new Set(ensureRepositoryCanBeManaged(option));
    const organization = await opentig.repository.forget(option.key);
    const sessions = new Map(fileSessionsRef.current);
    for (const id of ids) {
      sessions.delete(id);
      fileDraftsRef.current.delete(id);
      persistedSessionsRef.current.delete(id);
      filesTreeStates.delete(id);
    }
    fileSessionsRef.current = sessions;
    setFileSessions(sessions);
    if (repositoryRef.current && ids.has(repositoryRef.current.id)) setRepository(null);
    setBootstrap((current) => current ? {
      ...current, ...organization,
      activeRepository: current.activeRepository && ids.has(current.activeRepository.id) ? null : current.activeRepository,
      filesTreeStates: current.filesTreeStates.filter((state) => !ids.has(state.repositoryId)),
      openFilesStates: current.openFilesStates.filter((state) => !ids.has(state.repositoryId)),
    } : current);
    return organization;
  };

  const relocateRepository = async (option: RepositoryOption, path: string) => {
    ensureRepositoryCanBeManaged(option);
    recordOpenedRepository(await opentig.repository.relocateRecent(option.recent.id, path), option.recent.id);
  };

  const browserRepositoryDialog = <OpenRepositoryDialog open={openRepositoryDialog} onOpenChange={setOpenRepositoryDialog} onBrowse={opentig.repository.browseDirectories} onOpen={async (path) => {
    recordOpenedRepository(await opentig.repository.openPath(path));
  }} />;

  if (!bootstrap) {
    return <SplashScreen heading={appDisplayName} detail={startupSplashDetail(connectionState)} />;
  }
  if (!repository) {
    return (
      <TooltipProvider>
        <Toaster theme="light" position="bottom-right" />
        {browserRepositoryDialog}
      <DesktopUpdateNotice />
        <Welcome recent={bootstrap.recentRepositories} onOpen={openRepository} onRecent={(id) => void selectRecent(id)} />
      </TooltipProvider>
    );
  }

  const pendingDestructiveCopy = destructiveAction ? destructiveActionCopy(destructiveAction) : null;
  const conflicts = status?.changes.filter((change) => change.conflict) ?? [];
  const staged = status?.changes.filter((change) => change.staged && !change.conflict) ?? [];
  const changed = status?.changes.filter((change) => change.unstaged && !change.conflict) ?? [];

  return (
    <ShortcutsProvider shortcuts={shortcuts}>
    <TooltipProvider>
      {browserRepositoryDialog}
      <DesktopUpdateNotice />
      {/* Sileo names its themes after the page, not the toast: `light` fills the
          toast with #1a1a1a and `dark` with #f2f2f2. Pinning it to `light` keeps
          every toast dark whatever the app theme is, and also sidesteps `system`,
          which sileo resolves from the OS instead of OpenTig's own preference. */}
      <Toaster theme="light" position="bottom-right" />
      {quickOpen && (
        <Suspense fallback={null}>
          <QuickOpenDialog
            open={quickOpen}
            files={files}
            includeIgnored={bootstrap.preferences.showDotEnvFiles}
            activePath={viewerSelection?.type === 'file' ? viewerSelection.path : null}
            onOpenChange={setQuickOpen}
            onOpenFile={openFile}
          />
        </Suspense>
      )}
      <Dialog
        open={dirtyClosePath !== null}
        onOpenChange={(open) => { if (!open) dirtyCloseResolverRef.current?.('cancel'); }}
      >
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>Save changes before closing?</DialogTitle>
            <DialogDescription>This file has unsaved changes. Discarding them cannot be undone.</DialogDescription>
            {dirtyClosePath && <div className="undo-commit-summary"><strong>{dirtyClosePath}</strong></div>}
          </div>
          <div className="undo-commit-actions">
            <Button variant="ghost" onClick={() => dirtyCloseResolverRef.current?.('cancel')}>Cancel</Button>
            <Button variant="destructive" onClick={() => dirtyCloseResolverRef.current?.('discard')}>Discard</Button>
            <Button onClick={() => dirtyCloseResolverRef.current?.('save')}>Save</Button>
          </div>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={destructiveAction !== null}
        onOpenChange={(open) => { if (!open) void settleDestructiveAction(false); }}
      >
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>{pendingDestructiveCopy?.title}</DialogTitle>
            <DialogDescription>{pendingDestructiveCopy?.message}</DialogDescription>
            {pendingDestructiveCopy?.detail && (
              <div className="destructive-confirmation-detail">{pendingDestructiveCopy.detail}</div>
            )}
          </div>
          <div className="undo-commit-actions">
            <Button variant="ghost" onClick={() => void settleDestructiveAction(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void settleDestructiveAction(true)}>
              {destructiveAction?.kind === 'discard' ? <IconRestore /> : <IconTrash />}
              {pendingDestructiveCopy?.confirmLabel}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={blockedBranchSwitch !== null}
        onOpenChange={(open) => { if (!open && busy !== 'branch') setBlockedBranchSwitch(null); }}
      >
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>Move local changes to {blockedBranchSwitch?.label}?</DialogTitle>
            <DialogDescription>
              OpenTig will save all tracked and untracked changes temporarily, switch branches, restore them, and leave them unstaged. If Git finds conflicts, the safety stash will be kept.
            </DialogDescription>
            {blockedBranchSwitch && blockedBranchSwitch.files.length > 0 && (
              <div className="destructive-confirmation-detail">
                {blockedBranchSwitch.files.join('\n')}
              </div>
            )}
          </div>
          <div className="undo-commit-actions">
            <Button variant="ghost" onClick={() => setBlockedBranchSwitch(null)} disabled={busy === 'branch'}>Cancel</Button>
            <Button onClick={() => void moveChangesAndSwitchBranch()} disabled={busy === 'branch'}>
              <IconFileArrowRight /> {busy === 'branch' ? 'Moving changes…' : `Move changes to ${blockedBranchSwitch?.label ?? 'branch'}`}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
      <Dialog open={Boolean(undoCommit)} onOpenChange={(open) => { if (!open && !undoingCommit) setUndoCommit(null); }}>
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>Undo the last local commit?</DialogTitle>
            <DialogDescription>The commit will disappear from local history. Its changes and any already staged changes will remain staged. No files will be deleted.</DialogDescription>
            {undoCommit && <div className="undo-commit-summary"><code>{undoCommit.shortOid}</code><strong>{undoCommit.subject || '(no subject)'}</strong></div>}
          </div>
          <div className="undo-commit-actions">
            <Button variant="ghost" onClick={() => setUndoCommit(null)} disabled={undoingCommit}>Cancel</Button>
            <Button variant="destructive" onClick={() => void undoLatestCommit()} disabled={undoingCommit}>
              <IconRestore /> {undoingCommit ? 'Undoing…' : 'Undo and stage changes'}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
      {createPrOpen && (
        <Suspense fallback={null}>
          <CreatePullRequestDialog
            open={createPrOpen}
            onOpenChange={setCreatePrOpen}
            repositoryId={repository.id}
            branches={branches}
            status={status}
            preferences={bootstrap.preferences}
            aiProviders={capabilities?.aiProviders}
            pushBusy={busy === 'push'}
            onPush={() => void pushUpdates()}
            onCreated={(prNumber) => {
              setCreatePrOpen(false);
              void loadPulls(pullRequestStates);
              if (prNumber !== null) selectViewer({ type: 'pull-request', number: prNumber });
            }}
          />
        </Suspense>
      )}
      <div className="app-shell" data-mobile-pane={mobilePane}>
        <Toolbar
          repository={repository}
          recent={bootstrap.recentRepositories}
          repositoryProjects={bootstrap.repositoryProjects}
          status={status}
          branches={branches}
          worktrees={worktrees}
          preferences={bootstrap.preferences}
          busy={busy}
          repositorySyncOperations={repositorySyncOperations}
          onOpen={openRepository}
          onRecent={selectRecent}
          onBranch={switchBranch}
          onWorktree={switchWorktree}
          onRefresh={() => void refresh()}
          onPull={() => void pullUpdates()}
          onPush={() => void pushUpdates()}
          onRepositorySync={syncRepository}
          onPreference={(partial) => void updatePreference(partial)}
          onForgetRepository={forgetRepository}
          onRelocateRepository={relocateRepository}
          onOrganizationChange={(organization) => setBootstrap((current) => current ? { ...current, ...organization } : current)}
          onRefsManaged={handleRefsManaged}
          openFiles={fileSessions.get(repository.id) ?? emptyFileSession}
          onOpenFileTab={activateFileTab}
          onPinFileTab={(path) => openFile(path, 'pinned')}
          onCloseFileTab={(path) => void closeFileTab(path)}
          onReorderFileTab={reorderFileTab}
          settingsOpen={settingsOpen}
          settingsSection={settingsSection}
          onSettingsOpen={setSettingsOpen}
          onSettingsSection={setSettingsSection}
        />
        {status?.readOnly && <div className="operation-banner">Repository is read-only: {status.operation} is in progress.</div>}
        <nav className="mobile-navigation" aria-label="Repository views">
          {SIDEBAR_VIEWS.map((item) => (
            <button key={item} aria-current={view === item ? 'page' : undefined} onClick={() => { setView(item); setMobilePane('list'); }}>
              {item === 'changes' ? <IconGitCompare /> : item === 'files' ? <IconFiles /> : item === 'history' ? <IconHistory /> : item === 'prs' ? <IconGitPullRequest /> : <IconSearch />}
              <span>{item === 'changes' ? 'Changes' : item === 'files' ? 'Files' : item === 'history' ? 'History' : item === 'prs' ? 'PRs' : 'Search'}</span>
            </button>
          ))}
        </nav>
        <div className="mobile-workspace-actions">
          {mobilePane !== 'list' ? (
            <button ref={mobileBackRef} onClick={() => setMobilePane('list')}><IconArrowLeft /> Back to {view === 'prs' ? 'PRs' : view}</button>
          ) : <span>{view === 'changes' ? `${status?.changes.length ?? 0} changes` : view === 'files' ? 'Repository files' : view === 'history' ? 'Commit history' : view === 'prs' ? 'Pull requests' : 'Search files'}</span>}
          {Boolean(status?.stagedCount || commitProposal) && <button aria-pressed={mobilePane === 'commit'} onClick={() => { setView('changes'); setMobilePane('commit'); }}><IconGitCommit /> Commit{status?.stagedCount ? ` (${status.stagedCount})` : ''}</button>}
          {mobilePane === 'list' && viewerSelection && <button onClick={() => setMobilePane('viewer')}>View selection</button>}
        </div>
        <main className="workspace">
          <aside className="sidebar" style={{ width: bootstrap.preferences.sidebarWidth }}>
            <nav className="sidebar-tabs" data-shortcuts={ctrlHeld ? 'visible' : undefined} aria-label="Repository views">
              {SIDEBAR_VIEWS.map((item, index) => (
                <button
                  key={item}
                  className={view === item ? 'active' : ''}
                  aria-current={view === item ? 'page' : undefined}
                  aria-keyshortcuts={`Control+${index + 1}`}
                  onClick={() => setView(item)}
                >
                  {item === 'changes' ? <IconGitCompare /> : item === 'files' ? <IconFiles /> : item === 'history' ? <IconHistory /> : item === 'prs' ? <IconGitPullRequest /> : <IconSearch />}
                  <span className="sidebar-tab-label">{item === 'changes' ? 'Changes' : item === 'files' ? 'Files' : item === 'history' ? 'History' : item === 'prs' ? 'PRs' : 'Search'}</span>
                  {item === 'changes' && status && status.changes.length > 0 && <span className="sidebar-tab-count">{status.changes.length}</span>}
                  {item === 'prs' && pulls !== null && pulls.length > 0 && <span className="sidebar-tab-count">{pulls.length}</span>}
                  {ctrlHeld && <span className="sidebar-tab-shortcut" aria-hidden="true">{index + 1}</span>}
                </button>
              ))}
            </nav>
            <div className="sidebar-body">
              <div className="view-fade">
              {view === 'changes' && (
                <ChangesView
                  conflicts={conflicts}
                  staged={staged}
                  changed={changed}
                  displayMode={bootstrap.preferences.changesLayout}
                  readOnly={Boolean(status?.readOnly)}
                  onSelect={(path, kind) => { selectViewer({ type: 'diff', path, kind }); }}
                  onConflict={(path) => { selectViewer({ type: 'conflict', path }); }}
                  onOpenFile={openFile}
                  onDiscard={(paths) => void discardChanges(paths)}
                  onStage={(paths) => void runIndexOperation('stage', paths)}
                  onUnstage={(paths) => void runIndexOperation('unstage', paths)}
                  onStageAll={() => void runAll('stage')}
                  onUnstageAll={() => void runAll('unstage')}
                />
              )}
              {view === 'files' && (
                <Suspense fallback={sidebarFallback}>
                  <FilesView
                    key={repository.id}
                    active={view === 'files'}
                    initialExpandedPaths={filesTreeStates.get(repository.id) ?? []}
                    files={files}
                    filesSnapshotRevision={filesSnapshotRevision}
                    showDotEnvFiles={bootstrap.preferences.showDotEnvFiles}
                    activePath={viewerSelection?.type === 'file' ? viewerSelection.path : null}
                    readOnly={Boolean(status?.readOnly || busy)}
                    fileClipboardAvailable={capabilities?.fileClipboard === true}
                    revealAvailable={capabilities?.revealInFileManager === true}
                    onQuickOpen={() => setQuickOpen(true)}
                    historyState={fileHistoryState}
                    onUndo={() => performFileHistory('undo')}
                    onRedo={() => performFileHistory('redo')}
                    onOpenFile={openFile}
                    onLoadDirectory={loadDirectoryEntries}
                    onPersistExpandedPaths={persistFilesTreeExpandedPaths}
                    onCopyPath={copyFilePaths}
                    onCopyEntries={copyFileEntries}
                    onCutEntries={cutFileEntries}
                    onCopyContents={copyFileContents}
                    onPaste={pasteFileEntries}
                    onMoveEntries={moveFileEntries}
                    onDeleteEntries={deleteFileEntries}
                    onReveal={revealFileEntry}
                    onRename={renameFileEntry}
                    onCreate={createFileEntry}
                  />
                </Suspense>
              )}
              {view === 'history' && (
                <Suspense fallback={sidebarFallback}>
                <HistoryView
                  repositoryId={repository.id}
                  upstream={status?.upstream ?? null}
                  readOnly={Boolean(status?.readOnly)}
                  operation={status?.operation ?? null}
                  commits={commits}
                  nextCursor={nextCursor}
                  loading={busy === 'history'}
                  onSelectCommit={(commit) => { selectViewer({ type: 'commit', oid: commit.oid, subject: commit.subject }); }}
                  onSelectFile={(oid, file) => { selectViewer({ type: 'commit-file', oid, path: file.path, oldPath: file.oldPath ?? undefined }); }}
                  onUndo={setUndoCommit}
                  undoing={undoingCommit}
                  onMore={() => void loadMore()}
                />
                </Suspense>
              )}
              {view === 'search' && (
                <Suspense fallback={sidebarFallback}>
                <SearchView
                  repositoryId={repository.id}
                  active={view === 'search'}
                  revision={searchRevision}
                  onOpenFile={openFile}
                  unsavedPathsAmong={unsavedTabsUnder}
                  onReplaced={() => { void refresh({ background: true }); }}
                />
                </Suspense>
              )}
              {view === 'prs' && (
                <Suspense fallback={sidebarFallback}>
                <PullRequestsView
                  info={githubInfo}
                  ghStatus={ghStatus}
                  pulls={pulls}
                  loading={pullsLoading}
                  error={pullsError}
                  states={pullRequestStates}
                  activeNumber={viewerSelection?.type === 'pull-request' ? viewerSelection.number : null}
                  createDisabledReason={!status
                    ? 'Loading repository status…'
                    : status.detached || status.unborn || !status.branch
                      ? 'Check out a branch first'
                      : null}
                  onRefresh={() => void loadPulls(pullRequestStates, true)}
                  onStateChange={(state, checked) => {
                    const order: PullRequestState[] = ['OPEN', 'CLOSED', 'MERGED'];
                    const nextStates = order.filter((candidate) => candidate === state ? checked : pullRequestStates.includes(candidate));
                    setPullRequestStates(nextStates);
                  }}
                  onSelect={(pr) => { selectViewer({ type: 'pull-request', number: pr.number }); }}
                  onCreate={() => setCreatePrOpen(true)}
                  onCopyCommand={(command) => {
                    void writeClipboardText(command)
                      .then(() => sileo.success({ title: 'Command copied', description: command }))
                      .catch(() => sileo.error({ title: 'Could not copy the command' }));
                  }}
                />
                </Suspense>
              )}
              </div>
            </div>
          </aside>
          <section className="viewer-pane">
            <ErrorBoundary
              resetKey={viewerSelection}
              fallback={(err) => (
                <div className="viewer-message flex-col gap-2 text-center text-destructive">
                  <p>Could not display this content.</p>
                  <small className="text-muted-foreground">{err.message}</small>
                </div>
              )}
            >
              <Suspense fallback={<div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Preparing viewer…" /></div>}>
                <Viewer
                  repositoryId={repository.id}
                  selection={viewerSelection}
                  diffView={diffView}
                  wrapLines={wrapLines}
                  theme={theme}
                  revision={refreshVersion}
                  readOnly={Boolean(status?.readOnly)}
                  commits={commits ?? []}
                  draftFor={(path) => readFileDraft(repository.id, path)}
                  onSelect={selectViewer}
                  onOpenFile={openFile}
                  onDiffViewChange={(value) => { if (mobile) setMobileDiffView(value); else void updatePreference({ diffView: value }); }}
                  onWrapLinesChange={(value) => void updatePreference({ wrapLines: value })}
                  onDraftChange={storeFileDraft}
                  onDraftSaved={(path) => {
                    dropFileDraft(repository.id, path);
                    updateFileSession(repository.id, (session) => setTabDirty(session, path, false));
                  }}
                  onUpdateConflict={updateConflictFile}
                  onResolveConflict={resolveConflictFile}
                />
              </Suspense>
            </ErrorBoundary>
          </section>
        </main>
        <CommitComposer
          open={mobile ? mobilePane === 'commit' : view === 'changes' && Boolean(status?.stagedCount || commitProposal)}
          stagedCount={status?.stagedCount ?? 0}
          message={commitMessage}
          generating={Boolean(generating)}
          harness={bootstrap.preferences.commitMessageHarness}
          harnessLabel={harnessLabel(bootstrap.preferences.commitMessageHarness)}
          modelLabel={aiModelLabel(
            capabilities?.aiProviders,
            bootstrap.preferences.commitMessageHarness,
            bootstrap.preferences.commitMessageModels[bootstrap.preferences.commitMessageHarness] ?? 'default',
          )}
          busy={busy}
          readOnly={Boolean(status?.readOnly)}
          canPush={Boolean(status?.upstream)}
          proposal={commitProposal}
          preparedIndex={preparedCommitIndex}
          completed={completedCommitIndices}
          collapsed={commitPlanCollapsed}
          textareaRef={commitTextareaRef}
          onMessage={setCommitMessage}
          onGenerate={() => void generateCommitMessage()}
          onCancelGenerate={() => void cancelCommitMessageGeneration()}
          onDismissProposal={() => { setCommitProposal(null); setPreparedCommitIndex(null); setCompletedCommitIndices(new Set()); }}
          onToggleCollapsed={() => setCommitPlanCollapsed((value) => !value)}
          onOpenPath={(path) => { selectViewer({ type: 'diff', path, kind: 'staged' }); }}
          onPrepare={(index) => void prepareCommitGroup(index)}
          onCommit={(options) => void createCommit(options)}
        />
      </div>
    </TooltipProvider>
    </ShortcutsProvider>
  );
}

function indexSnapshot(entries: FileTreeEntry[]): { paths: Set<string>; deferred: string[] } {
  const paths = new Set<string>();
  const deferred: string[] = [];
  const visit = (items: FileTreeEntry[]) => {
    for (const entry of items) {
      paths.add(entry.path);
      if (entry.type !== 'directory') continue;
      if (entry.ignored === true && entry.children.length === 0) deferred.push(entry.path);
      else visit(entry.children);
    }
  };
  visit(entries);
  return { paths, deferred };
}

function snapshotPresenceFromIndex(index: { paths: Set<string>; deferred: string[] }, path: string): 'present' | 'deferred' | 'missing' {
  if (index.paths.has(path)) return 'present';
  return index.deferred.some((prefix) => pathContains(prefix, path)) ? 'deferred' : 'missing';
}

/** Header tab shortcuts. `Ctrl+1`–`Ctrl+9` stays reserved for sidebar sections. */
function openFileTabShortcut(event: KeyboardEvent, shortcuts: ShortcutMap): TabKeyboardAction | null {
  if (matchesCombo(event, shortcuts.closeTab)) return 'close';
  if (matchesCombo(event, shortcuts.nextTab)) return 'next';
  if (matchesCombo(event, shortcuts.prevTab)) return 'previous';
  if (matchesCombo(event, shortcuts.moveTabLeft)) return 'move-left';
  if (matchesCombo(event, shortcuts.moveTabRight)) return 'move-right';
  return null;
}

function optimisticStatus(status: RepositoryStatus, paths: string[], mode: 'stage' | 'unstage'): RepositoryStatus {
  const selected = new Set(paths);
  const changes = status.changes.map((change) => selected.has(change.path)
    ? mode === 'stage'
      ? { ...change, staged: true, unstaged: false, indexStatus: change.worktreeStatus === '?' ? 'A' : change.worktreeStatus, worktreeStatus: '.' }
      : { ...change, staged: false, unstaged: true, indexStatus: '.', worktreeStatus: change.indexStatus }
    : change);
  return { ...status, changes, stagedCount: changes.filter((change) => change.staged && !change.conflict).length, unstagedCount: changes.filter((change) => change.unstaged && !change.conflict).length };
}

function isPerformanceSelection(value: unknown): value is ViewerSelection {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const selection = value as Record<string, unknown>;
  if (selection.type === 'file' || selection.type === 'conflict') return typeof selection.path === 'string';
  if (selection.type === 'diff') {
    return typeof selection.path === 'string' && (selection.kind === 'staged' || selection.kind === 'unstaged');
  }
  if (selection.type === 'commit') return typeof selection.oid === 'string' && typeof selection.subject === 'string';
  if (selection.type === 'commit-file') {
    return typeof selection.oid === 'string' && typeof selection.path === 'string'
      && (selection.oldPath === undefined || typeof selection.oldPath === 'string');
  }
  return selection.type === 'pull-request' && typeof selection.number === 'number';
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : 'An unexpected error occurred.'; }
function sentenceCaseLabel(label: string): string {
  return label.length > 0 ? `${label[0]!.toLocaleLowerCase()}${label.slice(1)}` : label;
}
function reportError(title: string, reason: unknown): void {
  sileo.error({ title, description: messageOf(reason), duration: 10_000 });
  if (serializedErrorFromReason(reason)) return;
  void opentig.diagnostics.record({ operation: title, message: messageOf(reason) }).catch(() => undefined);
}
function undoBlockedCopy(result: Exclude<UndoLatestCommitResult, { status: 'success' }>): { title: string; description: string } {
  if (result.status === 'stale-head') return { title: 'History changed', description: 'The view was refreshed without undoing any commit.' };
  if (result.status === 'no-upstream') return { title: 'Branch has no upstream', description: 'Cannot confirm that the commit is still local only.' };
  if (result.status === 'not-local') return { title: 'Commit is no longer local only', description: 'History was not modified.' };
  if (result.status === 'unsupported-merge') return { title: 'Cannot undo this merge', description: 'Merge commits require choosing a parent and are protected in this version.' };
  if (result.status === 'unsupported-root') return { title: 'Cannot undo the first commit', description: 'The initial commit is protected in this version.' };
  return { title: 'A Git operation is in progress', description: `Finish or cancel ${result.operation} before undoing the commit.` };
}
function aiDetail(reason: unknown): SerializedAiError | null {
  if (!(reason instanceof Error) || !('detail' in reason) || !reason.detail || typeof reason.detail !== 'object') return null;
  const detail = reason.detail as Partial<SerializedAiError>;
  return typeof detail.code === 'string' && detail.code.startsWith('AI_') && typeof detail.message === 'string' ? detail as SerializedAiError : null;
}
function aiErrorTitle(detail: SerializedAiError | null): string {
  if (!detail) return 'Could not generate the message';
  if (detail.code === 'AI_CLI_NOT_FOUND') return `${detail.harness ? harnessLabel(detail.harness) : 'The harness'} is not installed`;
  if (detail.code === 'AI_AUTH_REQUIRED') return 'Sign in to generate the message';
  if (detail.code === 'AI_MODEL_UNAVAILABLE') return 'The model is unavailable';
  if (detail.code === 'AI_RATE_LIMITED') return 'Usage limit reached';
  if (detail.code === 'AI_TIMEOUT') return 'Generation took too long';
  if (detail.code === 'AI_STAGED_CHANGES_CHANGED') return 'Staged changes have changed';
  if (detail.code === 'AI_INVALID_OUTPUT') return 'The response was invalid';
  return 'Could not generate the message';
}
