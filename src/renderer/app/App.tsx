import { GettingStartedChecklist } from '@/features/onboarding/GettingStartedChecklist';
import { parentFolderPath } from '@/features/repositories/directory-navigation';
import { ONBOARDING_VERSION } from '../../shared/onboarding';
import { lastCloneParent, resumeBackgroundClone } from '@/features/onboarding/clone-jobs';
import { useGitHubAccount } from '@/features/pulls/useGitHubAccount';
import { branchPullRequestQueryOptions, commitsAfterMergeQueryOptions } from '@/features/pulls/branch-pull-request-query';
import { withLineCounts, withStackMemberships } from '@/features/pulls/pull-request-list';
import { releasesQueryOptions } from '@/features/pulls/releases-query';
import { appDisplayName } from '@/lib/app-identity';
import { Activity, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isModuleLoadError, lazyWithPreload, lazyWithRetry, preloadWhenIdle } from '@/lib/lazy-with-retry';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBrandGithub, IconFileArrowRight, IconFiles, IconGitBranch, IconGitCompare, IconHistory,
  IconRefresh, IconRestore, IconSearch, IconTrash,
} from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { BootstrapData, FetchResult, FileHistoryPathChange, FileHistoryState, GhCliStatus, GitHubRepositoryInfo, OpenTigCapabilities, Preferences, PullRequestState, PullRequestSummary, PullResult, PushResult, RecentRepository, RepositoryInfo, RepositoryRelocationSearch, UndoLatestCommitResult } from '../../shared/contracts';
import { matchesCombo, resolveShortcuts, type ShortcutMap } from '../../shared/shortcuts';
import { ShortcutsProvider } from './ShortcutsContext';
import { Toolbar } from './Toolbar';
import { SidebarCollapseButton, SidebarRail, type SidebarRailSection } from './SidebarRail';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { useBranchPush } from '@/features/refs/useBranchPush';
import { PublishRemoteDialog } from '@/features/refs/PublishRemoteDialog';
import { PublishNewBranchDialog } from '@/features/refs/PublishNewBranchDialog';
import { publicationKey } from '@/features/refs/publication-context';
import { normalizeOpenFilesStates, type OpenFilesState } from '../../shared/open-files-state';
import { normalizeFilesTreeStates } from '../../shared/files-tree-state';
import { serializedErrorFromReason, type SerializedAiError } from '../../shared/errors';
import type { BranchInfo, CommitInfo, CommitPage, FileTreeEntry, RepositoryStatus, WorktreeInfo } from '../../shared/git-types';
import { normalizeRepositoryKey } from '../../shared/repository-projects';
import { DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS } from '../../shared/remote-fetch';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { Button } from '@/components/ui/button';
import { MobileChromeContext, NO_MOBILE_CHROME_HOSTS } from '@/components/mobile-chrome-context';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SplashScreen } from '@/components/SplashScreen';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChangesView } from '@/features/changes/ChangesView';
import { createDeleteAction, createDiscardAction, destructiveActionCopy, dispatchDestructiveAction, type DestructiveAction } from '@/features/files/destructive-action';
import { createSnapshotComparer, findEntry, pathContains, selectedFileChanged, snapshotPathPresence } from '@/features/files/file-tree';
import { MobileFileBar } from '@/features/files/MobileFileBar';
import { FileLineTargetContext, type FileLineTarget } from '@/features/viewer/file-line-target';
import { OpenFilesStrip } from '@/features/files/OpenFilesStrip';
import {
  activateTab, applyKeyboardAction, closeTab, dirtyTabs, dirtyTabsUnder, DRAFT_MEMORY_WARNING_BYTES, draftBytes,
  emptyFileSession, type FileSession, markTabsPresent, moveTab, type OpenMode, openTab, removeTabsUnder, renameTabPaths,
  restoreSession, serializeSession, setTabDirty, type TabKeyboardAction,
} from '@/features/files/open-files-model';
import { StoredCommitComposer } from '@/features/commit/StoredCommitComposer';
import { createCommitMessageStore } from '@/features/commit/commit-message-store';
import { useCommitPlan } from '@/features/commit/useCommitPlan';
import { OpenRepositoryDialog } from '@/features/repositories/OpenRepositoryDialog';
import { Welcome } from '@/features/repositories/Welcome';
import { RepositoryUnavailable } from '@/features/repositories/RepositoryUnavailable';
import { RepositoryRelocationsDialog } from '@/features/repositories/RepositoryRelocationsDialog';
import { touchRecentRepositories, type RepositoryOption } from '@/features/repositories/repository-select-model';
import { createRepositorySwitcher } from '@/features/repositories/repository-switch';
import { remoteAccessActionLabel, remoteAccessCopy, type RemoteAccessAction } from '@/features/repositories/remote-access';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import type { RemoteAccessProblem } from '../../shared/repository-access';
import { FileViewerToolbarHostContext } from '@/features/viewer/file-viewer-toolbar-host';
import { LineBlameContext, type LineBlameSettings } from '@/features/viewer/line-blame-context';
import type { RuntimeFileDraft, ViewerSelection } from '@/features/viewer/Viewer';
import type { PullRequestsSection } from '@/features/pulls/PullRequestsView';
import {
  mergeRefreshRequests, refreshOperationsForScope, sectionRefresh, shouldRefreshSearch, shouldRefreshViewer, type RefreshRequest,
} from './refresh-policy';
import { resolveWindowControlsInset } from './window-controls';
import { SectionSelections, stillShowable } from './section-memory';
import { historyHead, queryKeys, queryResourcesForScope, refreshGitHubQueries, resetGitHubQueries } from '@/lib/query-client';
import { listAgents } from '@/features/refs/local-refs-model';
import { AgentMarks } from '@/features/refs/AgentLabel';
import { persistTheme } from '@/lib/boot-theme';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { installZoomAwarePositioning } from '@/lib/zoom-aware-positioning';
import { isUserIdle } from '@/lib/window-focus';
import { dropFilesAhead, prefetchFile } from '@/features/viewer/viewer-prefetch';
import { changeGeneration, confirmWatch, doubtWatch, noteChange, type FileStamp } from '@/features/viewer/content-cache';
import { mobileMainAction } from '@/lib/mobile-main-action';
import { useElapsed } from '@/lib/use-elapsed';
import { opentig, serverClient } from '@/lib/opentig-api';
import { startupSplashDetail } from '@/lib/startup-splash';
import { ServerAuthenticationError, ServerDisconnectedError, UNCONFIRMED_RESULT_MESSAGE, inBackground, isConnectionLoss, isUnconfirmedResult } from '@/lib/websocket-transport';
import { conflictNotificationAction, conflictToastId } from '@/features/changes/conflict-notification';
import { fileCutTransferId, writeClipboardText, writeFileTransfer } from '@/lib/browser-capabilities';
import { needsBranchPublication, newBranchPublishedCopy, nothingPushedCopy, projectPullBlockedCopy, projectPullSuccessCopy, projectPushSuccessCopy, pullAndPushSuccessCopy, pullSuccessCopy, pushBlockedCopy, repositorySyncLoadingToast, syncToast, type ProjectSyncAction } from '@/features/repositories/project-sync';
import { aiModelLabel, harnessLabel } from '@/features/ai/harness-copy';
import { DesktopUpdateIndicator } from '@/features/settings/UpdateSettings';
import { updatesApi } from '@/features/settings/update-api';
import type { SettingsSection } from '@/features/settings/SettingsDialog';
import { CommitAuthorshipDialog } from '@/features/settings/CommitAuthorshipDialog';
import { RepositoryLinksContext, type RepositoryLinks } from '@/components/repository-links';
import { Spinner } from '@/components/ui/spinner';

// The sections and the viewer are downloaded on first use, or while the app is idle if that comes first (see `preloadWhenIdle`).
const Viewer = lazyWithPreload(() => import('@/features/viewer/Viewer'));
const FilesView = lazyWithPreload(() => import('@/features/files/FilesView').then((module) => ({ default: module.FilesView })));
const HistoryView = lazyWithPreload(() => import('@/features/history/HistoryView').then((module) => ({ default: module.HistoryView })));
const SearchView = lazyWithPreload(() => import('@/features/search/SearchView').then((module) => ({ default: module.SearchView })));
const IDLE_SECTIONS = [Viewer, FilesView, HistoryView, SearchView];
const PullRequestsView = lazyWithPreload(() => import('@/features/pulls/PullRequestsView').then((module) => ({ default: module.PullRequestsView })));
const QuickOpenDialog = lazyWithRetry(() => import('@/features/files/QuickOpenDialog').then((module) => ({ default: module.QuickOpenDialog })));
const CreatePullRequestDialog = lazyWithRetry(() => import('@/features/pulls/CreatePullRequestDialog').then((module) => ({ default: module.CreatePullRequestDialog })));
// Tooltips and menus must land on their anchors under the browser's Interface size zoom.
installZoomAwarePositioning();

const sidebarFallback = <div className="view-loading" role="status"><Spinner className="view-spinner" /> <ShimmeringText text="Loading…" /></div>;
const NO_OPEN_FILES_STATES: OpenFilesState[] = [];
type DirtyCloseChoice = 'save' | 'discard' | 'cancel';
const SIDEBAR_VIEWS = ['changes', 'files', 'history', 'prs', 'search'] as const;
const VIEW_STORAGE_KEY = 'opentig.lastView';
const BACKGROUND_REFRESH_RETRY_MS = 1_000;
const WORKTREE_AGENTS_REFRESH_MS = 10_000;
const HISTORY_STALE_MS = 30_000;
/** How often a repository the server cannot fully watch is read again. */
const UNWATCHED_REFRESH_MS = 10_000;
/** A branch switch Git refused over local changes; `allowAgents` keeps a confirmed agent warning confirmed. */
interface BlockedBranchSwitch { ref: string; label: string; files: string[]; allowAgents?: boolean }
type SidebarView = (typeof SIDEBAR_VIEWS)[number];
/** Matches `.sidebar[data-collapsed]` in index.css. */
const SIDEBAR_RAIL_WIDTH = 44;
interface AppRefreshOptions {
  manual?: boolean;
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
  constructor(readonly result: Exclude<PushResult, { status: 'success' } | { status: 'up-to-date' } | { status: 'published' }>) {
    super(result.status);
  }
}

/** Where a pull or push runs: the open repository, or a row of the repository list. */
interface SyncTarget {
  repositoryId: string;
  label: string;
  row?: { item: RepositoryOption; projectName: string | null; settled: (() => void) | undefined };
}

const CloneRepositoryDialog = lazyWithRetry(() => import('@/features/onboarding/CloneRepositoryDialog').then(module => ({ default: module.CloneRepositoryDialog })));
const FindRepositoriesDialog = lazyWithRetry(() => import('@/features/onboarding/FindRepositoriesDialog').then(module => ({ default: module.FindRepositoriesDialog })));
const WelcomeSettings = lazyWithRetry(() => import('@/features/settings/SettingsDialog').then(module => ({ default: module.SettingsDialog })));

export default function App({ initialView, initialSelection, pullRequestCreationDisabledReason }: { initialView?: SidebarView; initialSelection?: ViewerSelection; pullRequestCreationDisabledReason?: string } = {}) {
  const appQueryClient = useQueryClient();
  const branchPush = useBranchPush();
  const mobile = useMobileLayout();
  const [openRepositoryDialog, setOpenRepositoryDialog] = useState(false);
  const addingRepository = useRef(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'viewer'>('list');
  // Long lines wrap on a phone unless turned off for the session; the saved desktop choice stays as it is.
  const [mobileWrapLines, setMobileWrapLines] = useState(true);
  const [viewerTitleHost, setViewerTitleHost] = useState<HTMLElement | null>(null);
  const [viewerActionsHost, setViewerActionsHost] = useState<HTMLElement | null>(null);
  const [mobileFloatHost, setMobileFloatHost] = useState<HTMLElement | null>(null);
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
  // Read by a refresh as it starts, to tell the first read of a repository from a later one.
  const snapshotRepositoryIdRef = useRef<string | null>(null);
  const [pendingRepositoryId, setPendingRepositoryId] = useState<string | null>(null);
  // Saved repositories whose folder is gone, and the active one when that happened to it.
  const [unavailableRepositoryIds, setUnavailableRepositoryIds] = useState<ReadonlySet<string>>(() => new Set());
  const [unavailableRepository, setUnavailableRepository] = useState<RecentRepository | null>(null);
  // The server folder browser for locating a moved repository (the desktop app uses its native picker).
  const [relocatingRepository, setRelocatingRepository] = useState<RecentRepository | null>(null);
  const [relocationSearch, setRelocationSearch] = useState<RepositoryRelocationSearch | null>(null);
  const lastRelocationParentRef = useRef<string | null>(null);
  const [remoteProblem, setRemoteProblem] = useState<{ repositoryId: string; access: RemoteAccessProblem; message: string } | null>(null);
  /** Keeps the toolbar warning in step with the latest fetch of each repository. */
  const noteFetchResult = useCallback((repositoryId: string, result: FetchResult) => {
    if (result.status === 'success') setRemoteProblem(current => current?.repositoryId === repositoryId ? null : current);
    else if (result.access) setRemoteProblem({ repositoryId, access: result.access, message: result.message });
  }, []);
  const [repositorySwitcher] = useState(createRepositorySwitcher);
  const [view, setView] = useState<SidebarView>(() => {
    if (initialView) return initialView;
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      return SIDEBAR_VIEWS.find((item) => item === stored) ?? 'files';
    } catch {
      return 'files';
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* storage unavailable */ }
  }, [view]);
  // Read by a refresh as it starts, so opening another section does not make a new `refresh`.
  const viewRef = useRef(view);
  useLayoutEffect(() => { viewRef.current = view; }, [view]);
  // Sections opened in this repository stay mounted, hidden, so going back to one shows what it had: its
  // scroll position, search text and loaded folders. Hidden, their effects are torn down, so they neither
  // poll nor listen. Opening another repository keeps only the section on screen.
  const [keptSectionsState, setKeptSectionsState] = useState<{ repositoryId: string | null; sections: ReadonlySet<SidebarView> }>(
    () => ({ repositoryId: null, sections: new Set() }),
  );
  let keptSections = keptSectionsState.sections;
  const keptRepositoryId = repository?.id ?? null;
  if (keptSectionsState.repositoryId !== keptRepositoryId || !keptSections.has(view)) {
    keptSections = new Set(keptSectionsState.repositoryId === keptRepositoryId ? [...keptSections, view] : [view]);
    setKeptSectionsState({ repositoryId: keptRepositoryId, sections: keptSections });
  }
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>(null);
  const [fileViewerToolbarHost, setFileViewerToolbarHost] = useState<HTMLElement | null>(null);
  const initialSelectionApplied = useRef(false);
  // The commit box's text. Not React state: a key pressed in the box must not redraw the app.
  const [commitMessage] = useState(createCommitMessageStore);
  const sidebarElement = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [repositorySyncOperations, setRepositorySyncOperations] = useState<ReadonlyMap<string, ProjectSyncAction>>(() => new Map());

  const [refreshVersion, setRefreshVersion] = useState(0);
  const [searchRevision, setSearchRevision] = useState(0);
  // Replaying onboarding shows the start screen over the workspace, then the checklist.
  const [welcomeReplay, setWelcomeReplay] = useState(false);
  const [checklistReplay, setChecklistReplay] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [generating, setGenerating] = useState<string | null>(null);
  const [undoCommit, setUndoCommit] = useState<CommitInfo | null>(null);
  const [undoingCommit, setUndoingCommit] = useState(false);
  const [pullRequestStates, setPullRequestStates] = useState<PullRequestState[]>(['OPEN']);
  const [pullRequestsSection, setPullRequestsSection] = useState<PullRequestsSection>('pulls');
  const [actionsWorkflowId, setActionsWorkflowId] = useState<number | null>(null);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  // Repository whose commit authorship editor is open, so a stale toast cannot open it for another repository.
  const [authorshipRepositoryId, setAuthorshipRepositoryId] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [fileLineTarget, setFileLineTarget] = useState<FileLineTarget | null>(null);
  // Open-file tabs, one session per worktree. Structural metadata only: the
  // draft text of a dirty tab lives in a ref-backed map, never in React state.
  const [fileSessions, setFileSessions] = useState<ReadonlyMap<string, FileSession>>(() => new Map());
  const [dirtyClosePath, setDirtyClosePath] = useState<string | null>(null);
  const [destructiveAction, setDestructiveAction] = useState<DestructiveAction | null>(null);
  const [blockedBranchSwitch, setBlockedBranchSwitch] = useState<BlockedBranchSwitch | null>(null);
  const [agentBranchSwitch, setAgentBranchSwitch] = useState<{ ref: string; label: string; agents: string[]; moveChanges: boolean } | null>(null);
  // Holding Ctrl reveals the section numbers, so the shortcut is discoverable
  // without a cheat sheet. The page itself carries the state, for the styles to
  // read: a key that changes nothing else must not redraw the app.
  const ctrlHeldRef = useRef(false);
  const filesRef = useRef<FileTreeEntry[] | null>(null);
  const [filesComparer] = useState(createSnapshotComparer);
  const viewerSelectionRef = useRef<ViewerSelection>(null);
  // A path we just created/renamed/moved the viewer onto; it may be missing from
  // an in-flight (stale) file snapshot, so don't declare it deleted until it appears.
  const pendingViewerPathRef = useRef<string | null>(null);
  // The open repository's watch on the server, when it is not reporting every change.
  // The latest the server said about its one watch: the repository it reports every change of, and that
  // watch's id. Null after a reconnect, until the server says it again.
  const [announcedWatch, setAnnouncedWatch] = useState<{ repositoryId: string; watchId: string } | null>(null);
  /** Shown instead of the section's own selection once a requested section switch lands. */
  const pendingSectionSelectionRef = useRef<ViewerSelection>(null);
  // What each section last showed, per repository; and which section of which repository the viewer shows now.
  const [sectionSelections] = useState(() => new SectionSelections());
  const shownSelectionKeyRef = useRef<{ repositoryId: string; view: SidebarView } | null>(null);
  // The status last read for a repository, for deciding whether a remembered change is still there.
  const knownStatusRef = useRef<{ repositoryId: string; status: RepositoryStatus } | null>(null);
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
  const knownConflictPathsRef = useRef<Map<string, string[]>>(new Map());
  const refreshCyclesRef = useRef<Map<string, { queued: RefreshRequest | null; promise: Promise<void> }>>(new Map());
  // The change generation the file tree on screen was read at: while it is the current one, the
  // tree's sizes and times are current too, and the viewer may open a file it read before.
  const treeGenerationRef = useRef<{ repositoryId: string; generation: number } | null>(null);
  // The change generation at the start of the tree read that last came back. A read that joins one already on
  // its way gets that read's tree, so the generation comes from the read itself, not from whoever asked.
  const treeReadRef = useRef<{ repositoryId: string; generation: number } | null>(null);
  const readTree = useCallback((repositoryId: string) => appQueryClient.fetchQuery({
    queryKey: queryKeys.files(repositoryId),
    queryFn: async () => {
      const generation = changeGeneration();
      const files = await opentig.repository.getFiles(repositoryId);
      treeReadRef.current = { repositoryId, generation };
      return files;
    },
  }), [appQueryClient]);
  const fileStamp = useCallback((path: string): FileStamp | null => {
    const tree = treeGenerationRef.current;
    if (!tree || tree.repositoryId !== repositoryRef.current?.id || tree.generation !== changeGeneration() || !filesRef.current) return null;
    const entry = findEntry(filesRef.current, path);
    return entry?.type === 'file' ? { size: entry.size, mtimeMs: entry.mtimeMs } : null;
  }, []);
  // When the open repository's snapshot and its file tree were last read, for `sectionRefresh`.
  const lastReadRef = useRef({ snapshot: Number.NEGATIVE_INFINITY, files: Number.NEGATIVE_INFINITY, refs: Number.NEGATIVE_INFINITY });

  // Known once the status is; until then History waits rather than show another branch's commits.
  const [shownHistoryHead, setShownHistoryHead] = useState<{ repositoryId: string; head: string } | null>(null);
  const currentHistoryHead = shownHistoryHead && shownHistoryHead.repositoryId === repository?.id ? shownHistoryHead.head : null;
  const historyQuery = useInfiniteQuery({
    queryKey: queryKeys.history(repository?.id ?? '', currentHistoryHead ?? ''),
    queryFn: ({ pageParam }) => opentig.commits.list(repository!.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: repository !== null && currentHistoryHead !== null && view === 'history',
    // A change to the branches marks it outdated (see `performRefresh`), so coming back to History only reads it again after that.
    staleTime: HISTORY_STALE_MS,
  });
  const commits = useMemo(
    () => historyQuery.data ? historyQuery.data.pages.flatMap((page) => page.commits) : null,
    [historyQuery.data],
  );
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
  // CLI availability belongs to the backend session, not a repository or PR filter.
  const ghStatusQuery = useQuery<GhCliStatus>({
    queryKey: queryKeys.githubCliStatus,
    queryFn: () => opentig.github.status(true),
    enabled: bootstrap !== null,
    staleTime: Infinity,
  });
  const ghStatus = ghStatusQuery.data ?? null;
  const githubAccountQuery = useGitHubAccount(repository && githubInfo?.isGitHub ? repository.id : null);
  const githubAccount = githubAccountQuery.data ?? null;
  useEffect(() => opentig.events.onGitHubAccountsChanged((ids, inventoryChanged, detected) => {
    void resetGitHubQueries(appQueryClient, ids, inventoryChanged);
    const current = repositoryRef.current;
    if (!detected || !current || !ids?.includes(current.id)) return;
    sileo.success({
      title: `Using @${detected.login} for ${current.repositoryName}`,
      description: detected.previousLogin ? `The default account @${detected.previousLogin} can’t access this repository.` : 'No default account could access this repository.',
      button: { title: 'Change', onClick: () => { setSettingsSection('github'); setSettingsOpen(true); } },
    });
  }), [appQueryClient]);
  useEffect(() => opentig.events.onReconnected(() => { void refreshGitHubQueries(appQueryClient, repositoryRef.current?.id ?? null); }), [appQueryClient]);
  // Changes may have gone unreported while disconnected; the bootstrap that follows says how the server watches now.
  useEffect(() => opentig.events.onReconnected(() => setAnnouncedWatch(null)), []);
  const githubReady = repository !== null && githubInfo?.isGitHub === true && ghStatus?.installed === true;
  // Set by an explicit refresh, so the next read skips the list the backend keeps for a few seconds.
  const freshPulls = useRef(false);
  const pullsQuery = useQuery<PullRequestSummary[]>({
    queryKey: queryKeys.pulls(repository?.id ?? '', pullRequestStates),
    queryFn: async () => {
      const fresh = freshPulls.current;
      freshPulls.current = false;
      try { return pullRequestStates.length ? await opentig.github.listPullRequests(repository!.id, pullRequestStates, fresh) : []; }
      catch (error) {
        if (serializedErrorFromReason(error)?.code === 'GH_CLI_NOT_FOUND') {
          void appQueryClient.invalidateQueries({ queryKey: queryKeys.githubCliStatus });
        }
        throw error;
      }
      finally {
        // The read may have switched to an account with access; the list doesn't wait to say so.
        const repositoryId = repository!.id;
        void opentig.github.repositoryAccount(repositoryId, false)
          .then((context) => appQueryClient.setQueryData(queryKeys.githubAccount(repositoryId), context))
          .catch(() => undefined);
      }
    },
    // Read before the GitHub section is opened, so it shows its list straight away; refreshed when it opens.
    enabled: githubReady,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
  // Opening the section refreshes a list read more than 30 seconds ago, while still showing it.
  useEffect(() => {
    if (view === 'prs' && repository) void appQueryClient.refetchQueries({ queryKey: queryKeys.pulls(repository.id, pullRequestStates), stale: true });
  }, [appQueryClient, view, repository, pullRequestStates]);
  useEffect(() => {
    if (!githubReady || !repository) return;
    PullRequestsView.preload();
    void appQueryClient.prefetchQuery(releasesQueryOptions(repository.id));
  }, [appQueryClient, githubReady, repository]);
  const pullNumbers = useMemo(() => pullsQuery.data?.map((pull) => pull.number) ?? [], [pullsQuery.data]);
  // Stack membership comes after the list, so the rows don't wait for it.
  const pullStacksQuery = useQuery({
    queryKey: queryKeys.pullStacks(repository?.id ?? '', pullNumbers),
    queryFn: () => opentig.github.listPullRequestStacks(repository!.id, pullNumbers),
    enabled: repository !== null && pullNumbers.length > 0,
    staleTime: 60_000,
  });
  // So do the line counts of closed and merged PRs, which GitHub is slow to add up.
  const pullLineCountsQuery = useQuery({
    queryKey: queryKeys.pullLineCounts(repository?.id ?? '', pullRequestStates),
    queryFn: () => opentig.github.listPullRequestLineCounts(repository!.id, pullRequestStates),
    enabled: repository !== null && pullsQuery.data?.some((pull) => pull.lineCountsPending) === true,
    staleTime: 10 * 60_000,
  });
  const pulls = useMemo(
    () => withStackMemberships(withLineCounts(pullsQuery.data, pullLineCountsQuery.data), pullStacksQuery.data),
    [pullsQuery.data, pullLineCountsQuery.data, pullStacksQuery.data],
  );
  const pullsLoading = pullsQuery.isFetching || ghStatusQuery.isFetching;
  const pullsError = ghStatusQuery.error ? messageOf(ghStatusQuery.error) : pullsQuery.error ? messageOf(pullsQuery.error) : null;
  useEffect(() => { setMobilePane('list'); }, [repository?.id]);
  const mobileViewerBar = useMemo(() => ({ onBack: () => setMobilePane('list'), setTitleHost: setViewerTitleHost, setActionsHost: setViewerActionsHost }), []);
  const mobileChrome = useMemo(() => !mobile ? null
    : mobilePane === 'viewer' ? { title: viewerTitleHost, actions: viewerActionsHost, float: mobileFloatHost } : NO_MOBILE_CHROME_HOSTS,
  [mobile, mobileFloatHost, mobilePane, viewerActionsHost, viewerTitleHost]);
  const currentSnapshot = snapshotRepositoryId === repository?.id;
  const repositoryLoadPhase = pendingRepositoryId ? 'opening' : repository && !currentSnapshot ? 'loading' : null;
  // Quick switches finish without a flash; only a noticeable wait shows progress.
  const repositoryLoadVisible = useElapsed(repositoryLoadPhase ? 'busy' : null, 200);
  const repositoryLoadSlow = useElapsed(pendingRepositoryId ?? (repositoryLoadPhase ? repository?.id ?? null : null), 5000);
  const status = currentSnapshot ? statusState : null;
  useEffect(() => {
    if (repository && status) knownStatusRef.current = { repositoryId: repository.id, status };
  }, [repository, status]);
  const commitPlan = useCommitPlan({ repositoryId: repository?.id, status, getMessage: commitMessage.get, setMessage: commitMessage.set, index: opentig.index });
  // Three lists of every change: worked out when the changes do, not on every render.
  const changeLists = useMemo(() => {
    const changes = status?.changes ?? [];
    return {
      conflicts: changes.filter((change) => change.conflict),
      staged: changes.filter((change) => change.staged && !change.conflict),
      changed: changes.filter((change) => change.unstaged && !change.conflict),
    };
  }, [status?.changes]);
  const files = currentSnapshot ? filesState : null;
  const branches = currentSnapshot ? branchesState : [];
  const worktrees = currentSnapshot ? worktreesState : [];
  // Agents start and stop without touching Git, so they are looked for on their own and kept fresh.
  const worktreeAgentsQuery = useQuery({
    queryKey: queryKeys.worktreeAgents(repository?.id ?? ''),
    queryFn: () => opentig.refs.worktreeAgents(repository?.id ?? ''),
    enabled: repository !== null && currentSnapshot,
    refetchInterval: WORKTREE_AGENTS_REFRESH_MS,
  });
  const worktreeAgents = currentSnapshot ? worktreeAgentsQuery.data ?? [] : [];
  const currentBranch = status && !status.detached && !status.unborn ? status.branch : null;
  const branchPullRequestQuery = useQuery(branchPullRequestQueryOptions(
    repository?.id ?? '', currentBranch ?? '',
    repository !== null && githubInfo?.isGitHub === true && currentBranch !== null && ghStatus?.installed === true,
  ));
  const branchPullRequest = currentBranch && githubInfo?.isGitHub && !branchPullRequestQuery.isError
    ? branchPullRequestQuery.data ?? null : null;
  // Its place in a stack is read after it, so the pull request shows without waiting for that.
  const branchPullRequestNumbers = useMemo(() => branchPullRequest ? [branchPullRequest.number] : [], [branchPullRequest]);
  const branchPullRequestStackQuery = useQuery({
    queryKey: queryKeys.pullStacks(repository?.id ?? '', branchPullRequestNumbers),
    queryFn: () => opentig.github.listPullRequestStacks(repository!.id, branchPullRequestNumbers),
    enabled: repository !== null && branchPullRequestNumbers.length > 0,
    staleTime: 60_000,
  });
  const currentBranchPullRequest = useMemo(
    () => branchPullRequest ? withStackMemberships([branchPullRequest], branchPullRequestStackQuery.data)![0]! : null,
    [branchPullRequest, branchPullRequestStackQuery.data],
  );
  // A merged pull request no longer describes a branch that kept getting commits.
  const mergedHeadOid = currentBranchPullRequest?.state === 'MERGED' ? currentBranchPullRequest.headRefOid || null : null;
  const commitsAfterMergeQuery = useQuery(commitsAfterMergeQueryOptions(repository?.id ?? '', mergedHeadOid, status?.oid ?? null));
  const commitsAfterMerge = mergedHeadOid === null ? null : mergedHeadOid === status?.oid ? 0 : commitsAfterMergeQuery.data ?? null;
  // Only a branch whose upstream has another name needs the server's push review up front.
  const trackedUnderOtherName = Boolean(currentBranch && status?.upstream && !status.upstream.endsWith(`/${currentBranch}`));
  const publicationQuery = useQuery({
    queryKey: [...publicationKey(repository?.id ?? ''), currentBranch, status?.upstream, status?.oid],
    queryFn: () => opentig.refs.pushContext(repository!.id),
    enabled: repository !== null && trackedUnderOtherName,
  });
  const upstreamMismatch = trackedUnderOtherName ? publicationQuery.data?.upstreamMismatch ?? null : null;
  const offersNewBranch = upstreamMismatch !== null && publicationQuery.data?.blockedReason === 'upstream-name';

  const openFilesStates = bootstrap?.openFilesStates ?? NO_OPEN_FILES_STATES;
  const connectionState = useSyncExternalStore(
    serverClient.transport.subscribeState,
    serverClient.transport.getState,
    serverClient.transport.getState,
  );
  const theme = bootstrap?.preferences.theme ?? 'system';
  // A phone has no room for two columns, so it always reads inline.
  const diffView = mobile ? 'unified' : bootstrap?.preferences.diffView ?? 'unified';
  const wrapLines = mobile ? mobileWrapLines : bootstrap?.preferences.wrapLines ?? false;
  const uiZoom = bootstrap?.preferences.uiZoom ?? 100;
  const uiFont = bootstrap?.preferences.uiFont ?? 'plus-jakarta-sans';
  const monoFont = bootstrap?.preferences.monoFont ?? 'jetbrains-mono';
  const shortcuts = useMemo(() => resolveShortcuts(bootstrap?.preferences.shortcutOverrides), [bootstrap?.preferences.shortcutOverrides]);

  useEffect(() => {
    let active = true;
    opentig.app.bootstrap().then((data) => {
      if (!active) return;
      filesTreeStates.clear();
      for (const state of data.filesTreeStates) filesTreeStates.set(state.repositoryId, [...state.expandedPaths]);
      setBootstrap(data);
      setRepository(data.activeRepository);
      setAnnouncedWatch(data.activeRepository && data.activeRepositoryWatch?.state === 'watching' && data.activeRepositoryWatch.watchId
        ? { repositoryId: data.activeRepository.id, watchId: data.activeRepositoryWatch.watchId } : null);
      setUnavailableRepositoryIds(new Set(data.unavailableRepositoryIds ?? []));
      setUnavailableRepository(data.recentRepositories.find((item) => item.id === data.unavailableActiveRepositoryId) ?? null);
    }).catch((reason) => {
      // The connection boundary owns the pairing screen, including a session
      // rejected while bootstrap is already in flight.
      if (!active || reason instanceof ServerAuthenticationError) return;
      reportError('Could not start OpenTig', reason);
    });
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
    // Zooming a phone's whole layout would undo its fixed bars, so the size reaches code through its text.
    document.documentElement.style.setProperty('--mobile-code-scale', String(uiZoom / 100));
  }, [uiZoom, mobile]);

  useLayoutEffect(() => {
    document.documentElement.dataset.uiFont = uiFont;
    document.documentElement.dataset.monoFont = monoFont;
  }, [monoFont, uiFont]);

  useEffect(() => {
    if (!bootstrap?.performanceAutomation) return;
    window.__opentigPerformanceAutomation = true;
    window.__opentigPerformanceResults = [];
    // Every action starts a new count, so a reading says what that navigation asked the server for.
    let countedFrom = serverClient.transport.requestCounts().requested;
    window.__opentigNavigationRequests = () => {
      const { requested, unanswered } = serverClient.transport.requestCounts();
      return { requested: requestsSince(countedFrom, requested), unanswered };
    };
    const handleAction = (event: Event) => {
      countedFrom = serverClient.transport.requestCounts().requested;
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
      delete window.__opentigNavigationRequests;
    };
  }, [bootstrap?.performanceAutomation]);

  // Once the app is up, the sections not yet opened are downloaded in its idle moments, so the first click on each doesn't wait.
  const started = bootstrap !== null;
  useEffect(() => started ? preloadWhenIdle(IDLE_SECTIONS) : undefined, [started]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    repositoryRef.current = repository;
  }, [repository]);
  const bootstrapRef = useRef(bootstrap);
  useEffect(() => { bootstrapRef.current = bootstrap; }, [bootstrap]);

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
    if (!path) setMobilePane('list');
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
    // Each section keeps what it shows, for when it is opened again. Read from the refs, which already
    // name the section a click moved to along with its selection, such as a file tab opening Files.
    const repositoryId = repositoryRef.current?.id;
    if (repositoryId) sectionSelections.remember(repositoryId, viewRef.current, viewerSelection);
  }, [sectionSelections, viewerSelection]);

  const applyFilesSnapshot = useCallback((nextFiles: FileTreeEntry[]) => {
    const previous = filesRef.current;
    // The first tree of a repository is never the same as none.
    const same = filesComparer.same(nextFiles) && previous !== null;
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
  }, [commitFileSession, dropFileDraft, filesComparer]);

  const refreshFilesOnly = useCallback(async () => {
    if (!repository) return;
    const repositoryId = repository.id;
    try {
      const nextFiles = await readTree(repositoryId);
      if (repositoryRef.current?.id !== repositoryId) return;
      lastReadRef.current.files = Date.now();
      treeGenerationRef.current = treeReadRef.current?.repositoryId === repositoryId ? treeReadRef.current : null;
      applyFilesSnapshot(nextFiles);
    } catch (reason) {
      if (repositoryRef.current?.id !== repositoryId) return;
      if (isConnectionLoss(reason)) recordConnectionLoss('Could not refresh files', reason);
      else reportError('Could not refresh files', reason);
    }
  }, [applyFilesSnapshot, readTree, repository]);

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
    const { background, manual, view: refreshView } = request;
    // Nothing of this repository is on screen yet, so read all of it whatever asked for the refresh.
    const firstRead = snapshotRepositoryIdRef.current !== repositoryId;
    const scope = firstRead ? 'unknown' : request.scope;
    const operations = refreshOperationsForScope(scope, refreshView);
    const resources = queryResourcesForScope(scope, refreshView);
    // History is only read while it is open; from another section it is marked outdated, and read when it is opened.
    if (!operations.history && refreshOperationsForScope(scope, 'history').history) {
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.histories(repositoryId), refetchType: 'none' });
    }
    if (!background) { busyRef.current = 'refresh'; setBusy('refresh'); }
    try {
      if (manual) {
        // Explicit checks bypass the automatic interval; update state stays in
        // the update icon and Settings even if fetching Git fails.
        void updatesApi().check().catch(() => undefined);
        try {
          const result = await opentig.refs.fetch(repositoryId);
          noteFetchResult(repositoryId, result);
          if (result.status === 'failed' && result.access) {
            // The toolbar warning offers the fix; the toast only reports the failed refresh.
            const copy = remoteAccessCopy(result.access);
            if (repositoryRef.current?.id === repositoryId) sileo.error({ title: 'Could not fetch remote changes', description: `${copy.summary} ${copy.detail}`, duration: 10_000 });
          } else if (result.status === 'failed') throw new Error(result.message);
        } catch (reason) {
          if (repositoryRef.current?.id === repositoryId) reportError('Could not fetch remote changes', reason);
        }
      }
      const readSnapshot = async () => {
        await Promise.all(resources.map((resource) => appQueryClient.invalidateQueries({
          queryKey: resource === 'status' ? queryKeys.status(repositoryId)
            : resource === 'branches' ? queryKeys.branches(repositoryId)
              : resource === 'worktrees' ? queryKeys.worktrees(repositoryId)
                : resource === 'files' ? queryKeys.files(repositoryId)
                  : queryKeys.histories(repositoryId),
          // Every branch's history: a change to the refs may have moved any of them.
          exact: resource !== 'history',
          refetchType: 'none',
        })));
        return snapshotReads();
      };
      const snapshotReads = () => {
        const statusRead = appQueryClient.fetchQuery({ queryKey: queryKeys.status(repositoryId), queryFn: () => opentig.repository.getStatus(repositoryId) });
        return Promise.all([
          statusRead,
          operations.branches ? appQueryClient.fetchQuery({ queryKey: queryKeys.branches(repositoryId), queryFn: () => opentig.refs.listBranches(repositoryId) }) : Promise.resolve(null),
          operations.worktrees ? appQueryClient.fetchQuery({ queryKey: queryKeys.worktrees(repositoryId), queryFn: () => opentig.refs.listWorktrees(repositoryId) }) : Promise.resolve(null),
          operations.files ? readTree(repositoryId) : Promise.resolve(null),
          // The history of whatever HEAD the status found, so a branch switch lands with that branch's commits.
          operations.history ? statusRead.then((read) => appQueryClient.fetchInfiniteQuery({
            queryKey: queryKeys.history(repositoryId, historyHead(read)),
            queryFn: ({ pageParam }) => opentig.commits.list(repositoryId, pageParam),
            initialPageParam: undefined as string | undefined,
            getNextPageParam: (lastPage: CommitPage) => lastPage.nextCursor ?? undefined,
          })) : Promise.resolve(null),
        ]);
      };
      let snapshot: Awaited<ReturnType<typeof snapshotReads>>;
      try {
        snapshot = await readSnapshot();
      } catch (reason) {
        // Automatic refreshes race with tools still writing to the repository; retry once quietly before reporting.
        // So does the first read of a repository, which would otherwise leave its workspace empty; a folder that is gone is reported at once.
        if (!(background || (firstRead && !isRepositoryMissing(reason))) || repositoryRef.current?.id !== repositoryId) throw reason;
        await new Promise((resolve) => setTimeout(resolve, BACKGROUND_REFRESH_RETRY_MS));
        if (repositoryRef.current?.id !== repositoryId) return;
        snapshot = await readSnapshot();
      }
      const [nextStatus, nextBranches, nextWorktrees, nextFiles, nextHistory] = snapshot;
      if (repositoryRef.current?.id !== repositoryId) return;
      snapshotRepositoryIdRef.current = repositoryId;
      lastReadRef.current.snapshot = Date.now();
      if (nextFiles) lastReadRef.current.files = lastReadRef.current.snapshot;
      if (nextBranches && nextWorktrees) lastReadRef.current.refs = lastReadRef.current.snapshot;
      setSnapshotRepositoryId(repositoryId);
      setStatus(nextStatus);
      setShownHistoryHead((current) => current?.repositoryId === repositoryId && current.head === historyHead(nextStatus) ? current : { repositoryId, head: historyHead(nextStatus) });
      if (nextBranches) setBranches(nextBranches);
      if (nextWorktrees) setWorktrees(nextWorktrees);
      if (nextFiles) {
        treeGenerationRef.current = treeReadRef.current?.repositoryId === repositoryId ? treeReadRef.current : null;
        applyFilesSnapshot(nextFiles);
      }
      void nextHistory;
      if (shouldRefreshViewer(scope, viewerSelectionRef.current?.type ?? null)) {
        setRefreshVersion((version) => version + 1);
      }
      if (shouldRefreshSearch(scope)) setSearchRevision((version) => version + 1);
      if (!background) {
        void appQueryClient.invalidateQueries({ queryKey: queryKeys.githubInfo(repositoryId) });
        void appQueryClient.invalidateQueries({ queryKey: ['repository', repositoryId, 'branch-pull-request'] });
      }
    } catch (reason) {
      if (repositoryRef.current?.id !== repositoryId) return;
      if (background && isConnectionLoss(reason)) recordConnectionLoss('Could not refresh', reason);
      else reportError('Could not refresh', reason);
    } finally {
      if (!background && repositoryRef.current?.id === repositoryId) { busyRef.current = null; setBusy(null); }
    }
  }, [applyFilesSnapshot, appQueryClient, noteFetchResult, readTree]);
  // One cycle per repository folds watcher bursts and explicit mutation
  // refreshes into a single follow-up snapshot with the union of their scopes.
  const refresh = useCallback((options?: AppRefreshOptions): Promise<void> => {
    if (!repository) return Promise.resolve();
    const repositoryId = repository.id;
    const request: RefreshRequest = {
      ...(options?.manual ? { manual: true } : {}),
      background: options?.background === true,
      scope: options?.scope ?? 'unknown',
      view: viewRef.current,
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
  }, [performRefresh, repository]);

  // A timeout or disconnect says nothing about the work, so show the real state before anyone retries.
  const refreshAfterUnconfirmedResult = (reason: unknown) => {
    if (isUnconfirmedResult(reason)) void refresh({ background: true });
  };
  const rethrowAfterRefreshing = (reason: unknown): never => {
    refreshAfterUnconfirmedResult(reason);
    throw reason;
  };

  useEffect(() => { busyRef.current = busy; }, [busy]);

  const remoteFetchIntervalSeconds = bootstrap?.preferences.remoteFetchIntervalSeconds ?? DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS;
  useEffect(() => {
    if (!repository || remoteFetchIntervalSeconds <= 0) return;
    const repositoryId = repository.id;
    let cancelled = false;
    let inFlight = false;

    const run = async () => {
      // Nobody is looking, or nobody has touched the window for a while: the next turn fetches again.
      if (cancelled || inFlight || addingRepository.current || document.visibilityState === 'hidden' || isUserIdle()) return;
      if (busyRef.current || repositorySyncOperationsRef.current.has(repositoryId)) return;
      inFlight = true;
      try {
        const result = await inBackground(() => opentig.refs.fetch(repositoryId));
        if (!cancelled) noteFetchResult(repositoryId, result);
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
  }, [noteFetchResult, refresh, remoteFetchIntervalSeconds, repository]);

  useEffect(() => {
    const repositoryId = repository?.id ?? null;
    // Nothing of this repository has been read since it was opened: the first refresh reads all of it.
    snapshotRepositoryIdRef.current = null;
    lastReadRef.current = { snapshot: Number.NEGATIVE_INFINITY, files: Number.NEGATIVE_INFINITY, refs: Number.NEGATIVE_INFINITY };
    // Only the open repository is watched: what was read of this one before may have changed since.
    noteChange();
    filesComparer.reset();
    // A repository or worktree seen in the last few minutes shows what it had at once, while the first
    // refresh reads it again behind that; it holds Pull, Push and Commit until it has. Each piece comes
    // from this repository's own entry, so nothing of the previous one is shown next to it.
    const known = repositoryId ? knownSnapshot(appQueryClient, repositoryId) : null;
    setSnapshotRepositoryId(known ? repositoryId : null);
    if (known) setStatus(known.status);
    if (known && repositoryId) setShownHistoryHead({ repositoryId, head: historyHead(known.status) });
    filesRef.current = known?.files ?? null;
    if (known?.files) filesComparer.same(known.files);
    setFiles(known?.files ?? null);
    // A later refresh may read only part of the new repository; it must not be shown next to the previous one's refs.
    setBranches(known?.branches ?? []);
    setWorktrees(known?.worktrees ?? []);
    setCreatePrOpen(false);
    setQuickOpen(false);
  }, [appQueryClient, filesComparer, repository?.id]);

  const loadPulls = useCallback(async (_states: PullRequestState[], forceStatus = false) => {
    if (forceStatus) {
      const result = await ghStatusQuery.refetch();
      if (result.isError || !result.data?.installed) return;
      if (repository) {
        await Promise.all([
          appQueryClient.invalidateQueries({ queryKey: ['repository', repository.id, 'pull-request-stack'] }),
          appQueryClient.invalidateQueries({ queryKey: ['repository', repository.id, 'pull-request'] }),
          appQueryClient.invalidateQueries({ queryKey: ['repository', repository.id, 'pull-request-state'] }),
          appQueryClient.invalidateQueries({ queryKey: ['repository', repository.id, 'pull-request-conversation'] }),
        ]);
      }
    }
    if (repository) void appQueryClient.invalidateQueries({ queryKey: ['repository', repository.id, 'branch-pull-request'] });
    freshPulls.current = true;
    await pullsQuery.refetch();
    // After the list, which tells the backend these are to be read again too.
    if (repository) void appQueryClient.invalidateQueries({ queryKey: ['repository', repository.id, 'pull-line-counts'] });
  }, [appQueryClient, ghStatusQuery, pullsQuery, repository]);

  useEffect(() => {
    void refresh();
  }, [refresh, repository?.id]);

  // Opening another section shows what is already known. It reads again behind
  // that, without holding Pull, Push or Commit, and only what was not read moments ago.
  const shownSectionRef = useRef(view);
  useEffect(() => {
    if (shownSectionRef.current === view) return;
    shownSectionRef.current = view;
    const now = Date.now();
    const due = sectionRefresh(view, { snapshotMs: now - lastReadRef.current.snapshot, filesMs: now - lastReadRef.current.files, refsMs: now - lastReadRef.current.refs });
    if (due === 'full') {
      void refresh({ background: true });
      // The remote may have been added or changed outside the app.
      if (repository) void appQueryClient.invalidateQueries({ queryKey: queryKeys.githubInfo(repository.id) });
    } else if (due === 'snapshot') void refresh({ background: true, scope: 'worktree' });
    else if (due === 'files') void refreshFilesOnly();
  }, [appQueryClient, refresh, refreshFilesOnly, repository, view]);

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
    const left = shownSelectionKeyRef.current;
    const moved = left?.repositoryId !== repositoryId || left.view !== view;
    shownSelectionKeyRef.current = { repositoryId, view };
    if (!initialSelectionApplied.current && initialSelection) {
      initialSelectionApplied.current = true;
      viewerSelectionRef.current = initialSelection;
      setViewerSelection(initialSelection);
    } else if (pendingSectionSelectionRef.current) {
      const selection = pendingSectionSelectionRef.current;
      pendingSectionSelectionRef.current = null;
      viewerSelectionRef.current = selection;
      setViewerSelection(selection);
    } else if (!moved) {
      // The same section of the same repository: nothing to bring back.
    } else if (view === 'files') selectFilePath(session.activePath);
    else {
      const remembered = sectionSelections.recall(repositoryId, view);
      const known = knownStatusRef.current;
      const showable = stillShowable(remembered, {
        status: known?.repositoryId === repositoryId ? known.status : null,
        openTabs: new Set(session.tabs.map((tab) => tab.path)),
      });
      const selection = showable ? remembered : null;
      viewerSelectionRef.current = selection;
      setViewerSelection(selection);
      if (!selection) setMobilePane('list');
    }
  }, [openFilesStates, repository?.id, selectFilePath, view, initialSelection, sectionSelections]);

  useEffect(() => opentig.events.onRepositoryChanged((repositoryId, scope, watch, watchId) => {
    // Whatever repository it is about: the server watches one at a time, and a change it reports, or a
    // watch it begins elsewhere, may be news about this one too.
    noteChange();
    if (watch === 'watching' && watchId) setAnnouncedWatch({ repositoryId, watchId });
    else if (watch) setAnnouncedWatch((current) => current?.repositoryId === repositoryId ? null : current);
    if (repositoryId !== repository?.id) return;
    void refresh({ background: true, scope });
    // An open refs manager may be showing a worktree whose removal another request finished.
    if (scope === 'worktrees' || scope === 'unknown') void appQueryClient.invalidateQueries({ queryKey: queryKeys.localRefs(repositoryId) });
    // Git's config is among what `unknown` covers, and a remote added in a terminal changes whether this is a GitHub repository.
    if (scope === 'unknown') void appQueryClient.invalidateQueries({ queryKey: queryKeys.githubInfo(repositoryId) });
    // A file read ahead of a click may be the one that just changed.
    if (scope !== 'refs' && scope !== 'worktrees') dropFilesAhead(repositoryId);
  }), [appQueryClient, refresh, repository?.id]);

  // Unless the server said it reports every change of the open repository, which it stops doing when another
  // client opens another one, the repository is read on a timer, and nothing the viewer read before is trusted.
  const confirmedWatchId = announcedWatch !== null && announcedWatch.repositoryId === repository?.id ? announcedWatch.watchId : null;
  useEffect(() => {
    if (repository && confirmedWatchId) confirmWatch(repository.id, confirmedWatchId);
    else doubtWatch();
    if (!repository || confirmedWatchId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !isUserIdle()) void refresh({ background: true, scope: 'unknown' });
    }, UNWATCHED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [confirmedWatchId, refresh, repository]);

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
      if (document.visibilityState === 'visible' && !isUserIdle()) void refreshFilesOnly();
    };
    const timer = window.setInterval(reconcile, 5_000);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [refreshFilesOnly, repository, view]);

  // Moves everything kept per repository (tabs, drafts, expanded folders,
  // project membership) from a moved repository's old id to its new one.
  const rebindRelocatedRepository = useCallback((previousId: string, selected: RepositoryInfo) => {
    if (previousId === selected.id) return;
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
    setBootstrap((current) => current ? rebindBootstrapRepository(current, previousId, selected) : current);
  }, [filesTreeStates]);

  const recordOpenedRepository = useCallback((selected: RepositoryInfo, previousId?: string) => {
    if (previousId) rebindRelocatedRepository(previousId, selected);
    setRepository(selected);
    setBootstrap((current) => current ? {
      ...current,
      activeRepository: selected,
      recentRepositories: touchRecentRepositories(current.recentRepositories, selected),
    } : current);
  }, [rebindRelocatedRepository]);

  const openRepository = useCallback(async () => {
    setOpenRepositoryDialog(true);
  }, []);

  useEffect(() => opentig.events.onActiveRepositoryChanged((selected) => {
    if (selected.id !== repositoryRef.current?.id && repositorySwitcher.accepts(selected.id)) recordOpenedRepository(selected);
  }), [recordOpenedRepository, repositorySwitcher]);

  useEffect(() => {
    const setHeld = (held: boolean) => {
      if (ctrlHeldRef.current === held) return;
      ctrlHeldRef.current = held;
      if (held) document.documentElement.dataset.shortcuts = 'visible';
      else delete document.documentElement.dataset.shortcuts;
    };
    const update = (event: KeyboardEvent) => setHeld(event.ctrlKey && !event.altKey && !event.metaKey);
    // A lost focus never delivers the keyup, so the hint would stay pinned open.
    const clear = () => setHeld(false);
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, []);

  const updatePreference = async (partial: Partial<Preferences>) => {
    try {
      const preferences = await opentig.app.setPreferences(partial);
      setBootstrap((current) => current ? { ...current, preferences } : current);
      return true;
    } catch (reason) { reportError('Could not save settings', reason); return false; }
  };
  /**
   * Paints the width the sidebar would get while its edge is dragged, on the
   * element itself: as React state every pointer move redrew the whole app.
   * Null ends the drag and puts back the saved width, which a resize then replaces.
   */
  const savedSidebarWidth = useRef(bootstrap?.preferences.sidebarWidth);
  useEffect(() => { savedSidebarWidth.current = bootstrap?.preferences.sidebarWidth; }, [bootstrap?.preferences.sidebarWidth]);
  const previewSidebarWidth = useCallback((width: number | null) => {
    const sidebar = sidebarElement.current;
    if (!sidebar) return;
    sidebar.toggleAttribute('data-resizing', width !== null);
    const shown = width ?? savedSidebarWidth.current;
    if (shown !== undefined) sidebar.style.width = `${shown}px`;
  }, []);
  /** Applies a sidebar layout change at once, then saves it; the saved preferences win when they return. */
  const setSidebarLayout = useCallback((partial: Pick<Partial<Preferences>, 'sidebarCollapsed' | 'sidebarWidth'>) => {
    setBootstrap((current) => current ? { ...current, preferences: { ...current.preferences, ...partial } } : current);
    void opentig.app.setPreferences(partial).then(
      (preferences) => setBootstrap((current) => current ? { ...current, preferences } : current),
      (reason) => reportError('Could not save the sidebar layout', reason),
    );
  }, []);
  const sidebarCollapsed = !mobile && Boolean(bootstrap?.preferences.sidebarCollapsed);
  /** Opens a section from the rail or its shortcut, unfolding a collapsed sidebar so the section shows. */
  const showSidebarView = useCallback((section: SidebarView) => {
    setView(section);
    if (sidebarCollapsed) setSidebarLayout({ sidebarCollapsed: false });
  }, [setSidebarLayout, sidebarCollapsed]);
  const changeWrapLines = (value: boolean) => {
    if (mobile) setMobileWrapLines(value);
    else void updatePreference({ wrapLines: value });
  };
  /** What Settings changes. On a phone, wrapping belongs to the session, as it does in a viewer's menu. */
  const updateSettingsPreference = async (partial: Partial<Preferences>) => {
    const { wrapLines: wrap, ...rest } = partial;
    if (!mobile || wrap === undefined) return updatePreference(partial);
    setMobileWrapLines(wrap);
    return Object.keys(rest).length > 0 ? updatePreference(rest) : true;
  };

  const persistFilesTreeExpandedPaths = useCallback((paths: string[]) => {
    if (!repository) return;
    filesTreeStates.set(repository.id, [...paths]);
    void opentig.app.setFilesTreeExpandedPaths(repository.id, paths)
      .catch((reason) => reportError('Could not save folder state', reason));
  }, [filesTreeStates, repository]);

  const runIndexOperation = async (mode: 'stage' | 'unstage', paths: string[]): Promise<boolean> => {
    if (!repository || !status || paths.length === 0) return false;
    const previous = status;
    setStatus(optimisticStatus(status, paths, mode));
    setBusy(mode);
    try {
      if (mode === 'stage') await opentig.index.stage(repository.id, paths);
      else await opentig.index.unstage(repository.id, paths);
      commitPlan.pause('You changed the staged files by hand.');
      await refresh({ background: true });
      return true;
    } catch (reason) {
      setStatus(previous);
      reportError(mode === 'stage' ? 'Could not stage changes' : 'Could not unstage changes', reason);
      return false;
    } finally { setBusy(null); }
  };

  const discardChanges = (paths: string[]) => {
    if (!repository || busy || status?.readOnly || paths.length === 0) return;
    setBusy('discard');
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
  // A linked commit may not be among the history's listed ones, or not fetched yet.
  const openLinkedCommit = useCallback(async (oid: string) => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return;
    try {
      if (!await opentig.commits.recognize(repositoryId, oid)) {
        sileo.error({ title: 'Commit not in this repository yet', description: `${oid.slice(0, 7)} isn't in your local copy. Fetch or pull to get it, or open it on GitHub.`, duration: 10_000 });
        return;
      }
      if (repositoryRef.current?.id === repositoryId) selectViewer({ type: 'commit', oid, subject: oid.slice(0, 8) });
    } catch (reason) {
      reportError('Could not open the commit', reason);
    }
  }, [selectViewer]);
  // Line blame in the Files editor: a saved preference, applied at once.
  const lineBlameEnabled = bootstrap?.preferences.lineBlame ?? true;
  const setLineBlameEnabled = useCallback((enabled: boolean) => {
    setBootstrap((current) => current ? { ...current, preferences: { ...current.preferences, lineBlame: enabled } } : current);
    void opentig.app.setPreferences({ lineBlame: enabled }).then(
      (preferences) => setBootstrap((current) => current ? { ...current, preferences } : current),
      (reason) => reportError('Could not save settings', reason),
    );
  }, []);
  const openBlamedCommit = useCallback(async (oid: string, subject: string) => {
    const repositoryId = repositoryRef.current?.id;
    if (!repositoryId) return;
    try {
      if (!await opentig.commits.recognize(repositoryId, oid)) {
        sileo.error({ title: 'Commit not in this repository', description: `${oid.slice(0, 7)} could not be found in your local copy.` });
        return;
      }
      if (repositoryRef.current?.id !== repositoryId) return;
      const selection: ViewerSelection = { type: 'commit', oid, subject };
      // Changing section resets the viewer, so the commit is shown once History is.
      if (view === 'history') selectViewer(selection);
      else pendingSectionSelectionRef.current = selection;
      showSidebarView('history');
    } catch (reason) {
      reportError('Could not open the commit', reason);
    }
  }, [selectViewer, showSidebarView, view]);
  const lineBlameSettings = useMemo<LineBlameSettings | null>(() => repository ? {
    repositoryId: repository.id,
    revision: refreshVersion,
    enabled: lineBlameEnabled,
    setEnabled: setLineBlameEnabled,
    openCommit: (oid, subject) => void openBlamedCommit(oid, subject),
  } : null, [lineBlameEnabled, openBlamedCommit, refreshVersion, repository, setLineBlameEnabled]);
  const githubNameWithOwner = githubInfo?.isGitHub ? githubInfo.nameWithOwner : null;
  // Links into this repository, wherever they're shown, can open here as well as on GitHub.
  const repositoryLinks = useMemo<RepositoryLinks | null>(() => githubNameWithOwner ? {
    nameWithOwner: githubNameWithOwner,
    open: (target) => {
      if (target.kind === 'pull') selectViewer({ type: 'pull-request', number: target.number });
      else if (target.kind === 'release') selectViewer({ type: 'release', tag: target.tag });
      else if (target.kind === 'workflow-run') selectViewer({ type: 'workflow-run', runId: target.runId, ...(target.jobId ? { jobId: target.jobId } : {}) });
      else void openLinkedCommit(target.oid);
    },
  } : null, [githubNameWithOwner, openLinkedCommit, selectViewer]);

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
      // Tabs show only with files, and a shortcut shouldn't close one the user can't see.
      if (document.querySelector('.open-files-strip')) void closeFileTab(result.closeRequest);
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
      // The replayed start screen covers the workspace; its shortcuts stay inactive.
      if (welcomeReplay) return;
      if (matchesCombo(event, shortcuts.refresh)) {
        event.preventDefault();
        if (!event.repeat && !busyRef.current && !repositorySyncOperationsRef.current.has(repository?.id ?? '')) void refresh({ manual: true });
      }
      if (repository && event.ctrlKey && !event.altKey && !event.metaKey) {
        const section = SIDEBAR_VIEWS[Number(event.key) - 1];
        if (section) { event.preventDefault(); showSidebarView(section); }
      }
      if (repository && !mobile && !event.repeat && matchesCombo(event, shortcuts.toggleSidebar)) {
        event.preventDefault();
        setSidebarLayout({ sidebarCollapsed: !sidebarCollapsed });
      }
      // Deliberately reachable from inside an editor: none of these produce
      // text, and VS Code binds them the same way while typing.
      const tabAction = repository ? openFileTabShortcut(event, shortcuts) : null;
      if (tabAction) {
        event.preventDefault();
        if (!event.repeat) runTabKeyboardAction(tabAction);
      }
      if (repository && !event.repeat && matchesCombo(event, shortcuts.quickOpen)) {
        if (!quickOpen && document.querySelector('[data-slot="dialog-popup"], .mobile-sheet, .confirm-popover')) return;
        event.preventDefault();
        setQuickOpen(true);
        void refreshFilesOnly();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [welcomeReplay, openRepository, quickOpen, refresh, refreshFilesOnly, repository, runTabKeyboardAction, shortcuts, mobile, sidebarCollapsed, setSidebarLayout, showSidebarView]);

  // One guard for every worktree's drafts. Per-editor listeners could only see
  // the file currently on screen, so switching tabs would drop the warning.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const dirty = [...fileSessionsRef.current.values()].some((session) => session.tabs.some((tab) => tab.dirty));
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeUpdate = (event: Event) => {
      if (busyRef.current || repositorySyncOperationsRef.current.size > 0
        || [...fileSessionsRef.current.values()].some((session) => session.tabs.some((tab) => tab.dirty))) event.preventDefault();
    };
    window.addEventListener('opentig:before-update', beforeUpdate);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('opentig:before-update', beforeUpdate);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
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
    if (action.kind === 'discard') commitPlan.pause('You discarded changes by hand.');
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
    try {
      if (mode === 'stage') await opentig.index.stageAll(repository.id);
      else await opentig.index.unstageAll(repository.id);
      commitPlan.pause('You changed the staged files by hand.');
      await refresh({ background: true });
    } catch (reason) { setStatus(previous); reportError(mode === 'stage' ? 'Could not stage changes' : 'Could not unstage changes', reason); }
    finally { setBusy(null); }
  };

  const createCommit = async (options?: { push?: boolean }) => {
    const message = commitMessage.get();
    if (!repository || !status?.stagedCount || !message.trim()) return;
    // While a plan is followed, the commit must hold exactly its group's files.
    const planStep = commitPlan.stepToCommit();
    if (planStep === false) return;
    setBusy('commit');
    let committed = false;
    try {
      const result = await opentig.commits.create(repository.id, message);
      const subject = message.split(/\r?\n/, 1)[0] ?? message;
      commitMessage.set('');
      // The plan marks its group done and stages the next one, so the box is
      // ready for the next commit. Any other commit ends the plan.
      if (planStep) await commitPlan.committed({ oid: result.oid, subject });
      else commitPlan.clear();
      setViewerSelection({ type: 'commit', oid: result.oid, subject });
      // On a phone the plan stays in front until its last commit is made.
      if (!planStep) setMobilePane('viewer');
      await refresh({ background: true });
      committed = true;
    } catch (reason) {
      if (serializedErrorFromReason(reason)?.code === 'IDENTITY_UNKNOWN') {
        const repositoryId = repository.id;
        sileo.error({
          title: 'Set your commit identity',
          description: 'Git needs a name and email before it can create commits in this repository. Your message and staged changes are kept.',
          duration: 10_000,
          button: { title: 'Set identity', onClick: () => setAuthorshipRepositoryId(repositoryId) },
        });
      } else {
        reportError('Could not create the commit', reason);
        refreshAfterUnconfirmedResult(reason);
      }
    }
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
      commitMessage.set(result.message);
      // Within a plan only one group is staged, so this rewrites that group's message.
      const withinPlan = commitPlan.step !== null;
      if (!withinPlan) commitPlan.propose(result.proposal, result.message);
      sileo.success({
        title: `Message generated with ${harnessLabel(result.harness)}`,
        description: withinPlan ? undefined : result.proposal
          ? `${result.proposal.commits.length} focused commits may be clearer than one.`
          // Silence used to hide both "the model saw no split" and "OpenTig
          // refused to offer one"; only the second needs explaining.
          : result.splitBlockedReason
            ? `No commit split was offered: ${result.splitBlockedReason.charAt(0).toLowerCase()}${result.splitBlockedReason.slice(1)}`
            : result.contextWasTruncated
              ? 'A truncated version of the staged diff was used.'
              : undefined,
        ...(result.splitBlockedReason && !withinPlan ? { duration: 8_000 } : {}),
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

  /** A change the plan makes to the index: staging a group, or staging everything back. */
  const runCommitPlanTask = async (task: () => Promise<void>) => {
    if (!repository || busy) return;
    setBusy('prepare-commit-group');
    try {
      await task();
    } catch (reason) {
      reportError('Could not stage the files again', reason);
    } finally {
      await refresh({ background: true });
      setBusy(null);
    }
  };

  useEffect(() => {
    const active = generationRequest.current;
    if (active && active.repositoryId !== repository?.id) void opentig.ai.cancelGeneration(active.id);
  }, [repository?.id]);

  useEffect(() => () => {
    const active = generationRequest.current;
    if (active) void opentig.ai.cancelGeneration(active.id);
  }, []);

  const recentRepositories = bootstrap?.recentRepositories;
  useEffect(() => {
    repositorySwitcher.connect({
      open: async (id) => {
        try {
          return await opentig.repository.openRecent(id);
        } catch (reason) {
          const recent = recentRepositories?.find((candidate) => candidate.id === id);
          if (!recent) throw reason;
          if (isRepositoryMissing(reason)) {
            setUnavailableRepositoryIds((current) => new Set(current).add(id));
            void locateRepositoryRef.current(recent);
            return null;
          }
          const selectedPath = await opentig.repository.selectRelocation(recent.repositoryName, recent.path);
          return selectedPath ? opentig.repository.relocateRecent(id, selectedPath) : null;
        }
      },
      apply: recordOpenedRepository,
      fail: (reason) => reportError('Could not open repository', reason),
      pending: setPendingRepositoryId,
    });
  }, [recentRepositories, recordOpenedRepository, repositorySwitcher]);

  const selectRecent = async (id: string | null) => {
    if (!id) return;
    const missing = unavailableRepositoryIds.has(id) ? bootstrap?.recentRepositories.find((item) => item.id === id) : null;
    if (missing) { await locateRepository(missing); return; }
    await repositorySwitcher.select(id, repository?.id ?? null);
  };

  const branchLabel = (name: string) => branches.find((branch) => branch.fullName === name)?.name ?? name.replace(/^refs\/(?:heads|remotes)\//, '');

  const switchBranch = async (name: string | null, allowAgents = false) => {
    if (!repository || !name || name === status?.branch) return;
    setBusy('branch');
    try {
      const result = await opentig.refs.switchBranch(repository.id, name, false, allowAgents);
      if (result.status === 'agents-working') {
        setAgentBranchSwitch({ ref: name, label: branchLabel(name), agents: result.agents, moveChanges: false });
        return;
      }
      setAgentBranchSwitch(null);
      if (result.status === 'blocked-local-changes') {
        setBlockedBranchSwitch({ ref: name, label: branchLabel(name), files: result.files, allowAgents });
        return;
      }
      await refresh({ background: true });
    }
    catch (reason) {
      reportError('Could not switch branch', reason);
      refreshAfterUnconfirmedResult(reason);
    }
    finally { setBusy(null); }
  };

  const moveChangesAndSwitchBranch = async (pending = blockedBranchSwitch) => {
    if (!repository || !pending) return;
    setBusy('branch');
    try {
      const result = await opentig.refs.switchBranch(repository.id, pending.ref, true, pending.allowAgents);
      if (result.status === 'agents-working') {
        setBlockedBranchSwitch(null);
        setAgentBranchSwitch({ ref: pending.ref, label: pending.label, agents: result.agents, moveChanges: true });
        return;
      }
      setAgentBranchSwitch(null);
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

  const switchBranchDespiteAgents = () => {
    const pending = agentBranchSwitch;
    if (!pending) return;
    if (pending.moveChanges) void moveChangesAndSwitchBranch({ ref: pending.ref, label: pending.label, files: [], allowAgents: true });
    else void switchBranch(pending.ref, true);
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
        // A plan can't account for a commit taken back, whether it made it or not.
        commitPlan.clear();
        setViewerSelection(null);
        setMobilePane('list');
        // The draft lands in the commit box, which a collapsed sidebar hides.
        showSidebarView('changes');
        if (!commitMessage.get().trim()) {
          commitMessage.set(result.message);
        } else {
          sileo.success({
            title: 'Commit undone',
            description: 'Its changes are staged again. Your draft was preserved.',
            button: { title: 'Use previous message', onClick: () => commitMessage.set(result.message) },
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

  /** The notice for a pull of the open repository that did not finish. */
  const pullFailureToast = (err: unknown) => {
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
    const unconfirmed = unconfirmedResultToast(err);
    if (unconfirmed) return unconfirmed;
    const detail = serializedErrorFromReason(err);
    const access = detail && 'access' in detail ? detail.access : undefined;
    if (access) return remoteAccessToast('Could not pull changes', access);
    const message = messageOf(err);
    return { title: 'Could not pull changes', description: message, duration: 10_000 };
  };

  const pullUpdates = async (expectedBehind?: number) => {
    if (!repository || busy) return;
    const repositoryId = repository.id;
    const pendingBehind = expectedBehind ?? status?.behind ?? 0;
    setBusy('pull');
    try {
      await sileo.promise(async () => {
        const result = await opentig.refs.pull(repositoryId).catch(rethrowAfterRefreshing);
        await refresh({ background: true });
        if (result.status === 'success' || result.status === 'up-to-date') return result;
        throw new PullBlocked(result);
      }, {
        loading: repositorySyncLoadingToast(repositoryId, 'pull', pendingBehind > 0 ? `Pulling ${pendingBehind} ${pendingBehind === 1 ? 'commit' : 'commits'}…` : 'Pulling changes…'),
        success: (result) => pullSuccessCopy(result),
        error: pullFailureToast,
      });
    } catch {
      // sileo.promise() already rendered the matching error toast above.
    } finally {
      setBusy(null);
    }
  };

  const pushUpdates = async () => {
    if (!status || (status.ahead === 0 && !needsBranchPublication(status)) || busy || status.readOnly || repositorySyncOperationsRef.current.has(repository?.id ?? '')) return;
    await performPush();
  };

  const performPush = async () => {
    if (!repository) return;
    const repositoryId = repository.id;
    const loading = repositorySyncLoadingToast(repositoryId, 'push', status?.upstream && !offersNewBranch ? 'Pushing commits…' : 'Publishing branch…');
    setBusy('push');
    try {
      await sileo.promise(async () => {
        const result = await branchPush.push(repositoryId, repository.name).catch(rethrowAfterRefreshing);
        await refresh({ background: true });
        if (!result || result.status === 'success' || result.status === 'up-to-date' || result.status === 'published') return result;
        throw new PushBlocked(result);
      }, {
        loading,
        success: (result) => !result ? { title: `${repository.name}: publication canceled` }
          : result.status === 'published' && result.previousUpstream ? newBranchPublishedCopy(result)
          : result.status === 'published' ? { title: `${repository.name}: branch published`, description: `${result.remote}/${result.branch}` }
          : result.status === 'success'
          ? { title: `${repository.name}: ${result.commits} ${result.commits === 1 ? 'commit pushed' : 'commits pushed'}` }
          : { title: `${repository.name}: no commits pending push` },
        error: (err) => {
          if (err instanceof PushBlocked) return pushBlockedToast(loading.id, err.result, { repositoryId, label: repository.name });
          return unconfirmedResultToast(err) ?? { title: `${repository.name}: could not push commits`, description: messageOf(err), duration: 10_000 };
        },
      });
    } catch {
      // sileo.promise() already rendered the matching error toast above.
    } finally {
      setBusy(null);
    }
  };

  const handleRemoteAccessAction = async (action: RemoteAccessAction, push = false) => {
    const current = repositoryRef.current;
    if (!current) return;
    if (action.kind === 'settings') { setSettingsSection('github'); setSettingsOpen(true); return; }
    if (action.kind === 'sso') { openOnGitHub(action.url); return; }
    if (action.kind === 'push-again') { void pushUpdates(); return; }
    try {
      await opentig.github.setRepositoryAccount(current.id, { mode: 'account', host: 'github.com', login: action.login });
      setRemoteProblem(null);
      if (push) void pushUpdates();
      else await refresh({ manual: true });
    } catch (reason) { reportError('Could not change the repository account', reason); }
  };
  const remoteAccessToast = (title: string, access: RemoteAccessProblem, push = false) => {
    const copy = remoteAccessCopy(access);
    const label = push && copy.action.kind === 'use-account' ? `Use @${copy.action.login} and push again` : remoteAccessActionLabel(copy.action);
    return { title, description: `${copy.summary} ${copy.detail}`, duration: 10_000, button: { title: label, onClick: () => void handleRemoteAccessAction(copy.action, push) } };
  };

  /** The notice for a push that did not happen, with what can be done about it from there. */
  const pushBlockedToast = (toastId: string, result: PushBlocked['result'], target: SyncTarget) => {
    const { row } = target;
    const sentByGit = result.status === 'rejected' && (result.reason === 'remote-changed' || result.reason === 'destination-exists' || result.reason === 'hook');
    if (!row && result.status === 'rejected' && result.access && !sentByGit) return remoteAccessToast(`${target.label}: could not push commits`, result.access, true);
    const copy = pushBlockedCopy(target.label, result, { project: Boolean(row), upstream: row ? null : status?.upstream ?? null });
    // The notice has done its job once an action is taken; the action reports on its own.
    const closing = (action: () => void) => () => { sileo.dismiss(toastId); action(); };
    const pullOnly = closing(() => void (row ? syncRepository(row.item, row.projectName, 'pull', row.settled) : pullUpdates(result.status === 'diverged' ? result.behind : undefined)));
    return syncToast(copy, copy.action === 'sync' ? [
      { title: 'Pull and push', onClick: closing(() => void pullAndPush(target, result.status === 'diverged' ? result : {})) },
      { title: 'Pull only', onClick: pullOnly },
    ] : copy.action === 'pull' ? [{ title: 'Pull', onClick: pullOnly }]
      : copy.action === 'access' ? [{ title: 'Repository access', onClick: () => { setSettingsSection('github'); setSettingsOpen(true); } }]
      : copy.action === 'conflicts' && !row && result.status === 'blocked-conflicts' ? [{ title: 'View conflicts', onClick: () => showConflicts(result.files) }]
      : []);
  };

  /** Pulls and then pushes as one notice. A pull that does not finish cleanly ends it with nothing pushed. */
  const pullAndPush = async (target: SyncTarget, pending: { ahead?: number; behind?: number }) => {
    const { repositoryId, label, row } = target;
    if (repositorySyncOperationsRef.current.has(repositoryId) || (!row && busyRef.current)) return;
    const stage = (action: ProjectSyncAction | null) => {
      if (!row) { busyRef.current = action; setBusy(action); return; }
      if (action) repositorySyncOperationsRef.current.set(repositoryId, action);
      else repositorySyncOperationsRef.current.delete(repositoryId);
      setRepositorySyncOperations(new Map(repositorySyncOperationsRef.current));
    };
    const refreshIfOpen = async () => { if (repositoryRef.current?.id === repositoryId) await refresh({ background: true }); };
    const progress = (verb: string, commits: number | undefined) => `${row ? `${label}: ${verb.toLowerCase()}` : verb} ${commits ? `${commits} ${commits === 1 ? 'commit' : 'commits'}` : 'commits'}…`;
    const loading = repositorySyncLoadingToast(repositoryId, 'pull', progress('Pulling', pending.behind));
    let pulling = true;
    stage('pull');
    try {
      await sileo.promise(async () => {
        const pulled = await opentig.refs.pull(repositoryId).catch(rethrowAfterRefreshing);
        await refreshIfOpen();
        if (pulled.status !== 'success' && pulled.status !== 'up-to-date') throw new PullBlocked(pulled);
        pulling = false;
        stage('push');
        sileo.show({ ...loading, type: 'loading', duration: null, title: progress('Pushing', pulled.status === 'success' ? pulled.localCommits : pending.ahead) });
        const pushed = await branchPush.push(repositoryId, label).catch(rethrowAfterRefreshing);
        await refreshIfOpen();
        if (!pushed || pushed.status === 'success' || pushed.status === 'up-to-date' || pushed.status === 'published') return { pulled, pushed };
        throw new PushBlocked(pushed);
      }, {
        loading,
        success: ({ pulled, pushed }) => pullAndPushSuccessCopy(row ? label : null, pulled, pushed),
        error: (err) => {
          if (!pulling) {
            return err instanceof PushBlocked ? pushBlockedToast(loading.id, err.result, target)
              : unconfirmedResultToast(err) ?? { title: row ? `Could not push ${label}` : `${label}: could not push commits`, description: messageOf(err), duration: 10_000 };
          }
          if (!row) return nothingPushedCopy(pullFailureToast(err));
          return nothingPushedCopy(err instanceof PullBlocked ? projectPullBlockedCopy(label, err.result)
            : unconfirmedResultToast(err) ?? { title: `Could not pull ${label}`, description: messageOf(err), duration: 10_000 });
        },
      });
    } catch {
      // sileo.promise() already rendered the matching error toast above.
    } finally {
      stage(null);
      row?.settled?.();
    }
  };

  const syncRepository = async (item: RepositoryOption, projectName: string | null, action: ProjectSyncAction, settled?: () => void) => {
    const repositoryId = item.recent.id;
    if (repositorySyncOperationsRef.current.has(repositoryId)) return;
    repositorySyncOperationsRef.current.set(repositoryId, action);
    setRepositorySyncOperations(new Map(repositorySyncOperationsRef.current));

    try {
      const label = projectName ? `${projectName} · ${item.name}` : item.name;
      if (action === 'pull') {
        await sileo.promise(async () => {
          const result = await opentig.refs.pull(repositoryId).catch(rethrowAfterRefreshing);
          if (repositoryRef.current?.id === repositoryId) await refresh({ background: true });
          if (result.status === 'success' || result.status === 'up-to-date') return result;
          throw new PullBlocked(result);
        }, {
          loading: repositorySyncLoadingToast(repositoryId, action, `Pulling ${label}…`),
          success: (result) => projectPullSuccessCopy(label, result),
          error: (reason) => reason instanceof PullBlocked
            ? projectPullBlockedCopy(label, reason.result)
            : unconfirmedResultToast(reason) ?? { title: `Could not pull ${label}`, description: messageOf(reason), duration: 10_000 },
        });
      } else {
        const loading = repositorySyncLoadingToast(repositoryId, action, `Pushing ${label}…`);
        await sileo.promise(async () => {
          const result = await branchPush.push(repositoryId, label).catch(rethrowAfterRefreshing);
          if (repositoryRef.current?.id === repositoryId) await refresh({ background: true });
          if (!result || result.status === 'success' || result.status === 'up-to-date' || result.status === 'published') return result;
          throw new PushBlocked(result);
        }, {
          loading,
          success: (result) => result ? projectPushSuccessCopy(label, result) : { title: `${label}: publication canceled` },
          error: (reason) => reason instanceof PushBlocked
            ? pushBlockedToast(loading.id, reason.result, { repositoryId, label, row: { item, projectName, settled } })
            : unconfirmedResultToast(reason) ?? { title: `Could not push ${label}`, description: messageOf(reason), duration: 10_000 },
        });
      }
    } catch {
      // Sileo rendered the repository-specific failure.
    } finally {
      repositorySyncOperationsRef.current.delete(repositoryId);
      setRepositorySyncOperations(new Map(repositorySyncOperationsRef.current));
      settled?.();
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
    await completeRelocation(option.recent, path);
  };

  // Locating a moved repository opens it, then offers to update the others found next to it.
  async function completeRelocation(recent: RecentRepository, path: string) {
    const relocated = await opentig.repository.relocateRecent(recent.id, path);
    recordOpenedRepository(relocated, recent.id);
    setUnavailableRepository(null);
    setUnavailableRepositoryIds((current) => { const next = new Set(current); next.delete(recent.id); return next; });
    lastRelocationParentRef.current = parentFolderPath(relocated.path);
    void offerRelatedRelocations(recent.path, relocated.path);
  }
  async function offerRelatedRelocations(previousPath: string, path: string) {
    try {
      const missing = await opentig.repository.unavailableRecent();
      setUnavailableRepositoryIds(new Set(missing));
      if (missing.length === 0) return;
      const search = await opentig.repository.findRelocations(previousPath, path);
      if (search.candidates.length > 0) setRelocationSearch(search);
    } catch {
      // The picker still marks the others; each can be located on its own.
    }
  }
  async function locateRepository(recent: RecentRepository) {
    if (!window.opentigDesktop) { setRelocatingRepository(recent); return; }
    const path = await opentig.repository.select(`Locate ${recent.name}`);
    if (!path) return;
    try { await completeRelocation(recent, path); }
    catch (reason) { reportError('Could not relocate repository', reason); }
  }
  const locateRepositoryRef = useRef(locateRepository);
  useEffect(() => { locateRepositoryRef.current = locateRepository; });

  const relocateFoundRepositories = async (entries: { id: string; path: string }[]) => {
    const result = await opentig.repository.relocateRecents(entries);
    for (const item of result.relocated) rebindRelocatedRepository(item.previousId, item.repository);
    const missing = await opentig.repository.unavailableRecent().catch(() => null);
    if (missing) setUnavailableRepositoryIds(new Set(missing));
    // The repository that was open when its folder disappeared opens again from its new place.
    const reopened = unavailableRepository && result.relocated.find((item) => item.previousId === unavailableRepository.id);
    if (reopened) { setUnavailableRepository(null); void repositorySwitcher.select(reopened.repository.id, null); }
    if (result.relocated.length > 0) {
      sileo.success({ title: `Relocated ${result.relocated.length} ${result.relocated.length === 1 ? 'repository' : 'repositories'}` });
    }
    if (result.failed.length > 0) {
      setRelocationSearch((current) => current && {
        ...current,
        candidates: current.candidates.filter((item) => result.failed.some((failed) => failed.id === item.id)),
      });
      throw new Error(result.failed.map((item) => `${item.name}: ${item.message}`).join(' '));
    }
  };

  // Every failure caused by a vanished folder lands here instead of in a toast.
  const checkingMissingRepositoryRef = useRef(false);
  useEffect(() => {
    repositoryMissingHandler = (title, reason) => {
      if (checkingMissingRepositoryRef.current) return;
      checkingMissingRepositoryRef.current = true;
      void opentig.repository.unavailableRecent().then((missing) => {
        setUnavailableRepositoryIds(new Set(missing));
        const current = repositoryRef.current;
        const recent = current && missing.includes(current.id) ? bootstrapRef.current?.recentRepositories.find((item) => item.id === current.id) : null;
        if (recent) {
          setUnavailableRepository(recent);
          setRepository(null);
        } else {
          sileo.error({ title, description: messageOf(reason), duration: 10_000 });
        }
      }, () => sileo.error({ title, description: messageOf(reason), duration: 10_000 })).finally(() => {
        checkingMissingRepositoryRef.current = false;
      });
    };
    return () => { repositoryMissingHandler = null; };
  }, []);
  const refreshUnavailableRepositories = useCallback(() => {
    void opentig.repository.unavailableRecent().then((missing) => setUnavailableRepositoryIds((current) => (
      current.size === missing.length && missing.every((id) => current.has(id)) ? current : new Set(missing)
    )), () => undefined);
  }, []);

  // A clone keeps running on the server across reloads; offer its result again.
  const bootstrapped = Boolean(bootstrap);
  const addPreparedRepositoryRef = useRef(addPreparedRepository);
  useEffect(() => { addPreparedRepositoryRef.current = addPreparedRepository; });
  useEffect(() => {
    if (bootstrapped) void resumeBackgroundClone(repository => void addPreparedRepositoryRef.current(repository));
  }, [bootstrapped]);
  const openSettings = (section: SettingsSection) => { setSettingsSection(section); setSettingsOpen(true); };
  const showOnboarding = () => { setSettingsOpen(false); setWelcomeReplay(true); setChecklistReplay(true); };
  const dismissChecklist = () => {
    setChecklistReplay(false);
    if (bootstrap?.onboardingVersion !== 0) return;
    setBootstrap(current => current ? { ...current, onboardingVersion: ONBOARDING_VERSION } : current);
    void opentig.app.completeOnboarding().catch(reason => reportError('Could not save onboarding progress', reason));
  };
  // Every way in (open, clone, find) uses the account the regular Open dialog would.
  const addRepositoryPath = async (path: string) => addPreparedRepository(await opentig.repository.preparePath(path));
  async function addPreparedRepository(prepared: RepositoryInfo) {
    addingRepository.current = true;
    try {
      const { revision } = await opentig.github.repositoryAccount(prepared.id, false);
      recordOpenedRepository(await opentig.repository.completeSetup(prepared.id, revision));
      setWelcomeReplay(false);
    } finally { addingRepository.current = false; }
  }
  const knownRepositoryPaths = (bootstrap?.recentRepositories ?? []).flatMap(item => [item.path, item.commonDir.replace(/[\\/]\.git[\\/]?$/i, '')]);
  const latestRepository = bootstrap?.recentRepositories.reduce<RecentRepository | null>((latest, item) => !latest || item.lastOpenedAt > latest.lastOpenedAt ? item : latest, null);
  const defaultCloneParent = lastCloneParent() ?? (latestRepository ? parentFolderPath(latestRepository.commonDir.replace(/[\\/]\.git[\\/]?$/i, '')) : null);
  const onboardingDialogs = <>
    {cloneOpen && <Suspense fallback={null}><CloneRepositoryDialog open onOpenChange={setCloneOpen} defaultParent={defaultCloneParent} onBrowse={opentig.repository.browseDirectories}
      onPick={window.opentigDesktop ? opentig.repository.select : undefined} onCloned={addPreparedRepository} /></Suspense>}
    {findOpen && <Suspense fallback={null}><FindRepositoriesDialog open onOpenChange={setFindOpen} known={knownRepositoryPaths} onBrowse={opentig.repository.browseDirectories}
      onAdd={addRepositoryPath} onOpenFolder={() => setOpenRepositoryDialog(true)} /></Suspense>}
  </>;
  const availableRecentRepositories = (bootstrap?.recentRepositories ?? []).filter((item) => !unavailableRepositoryIds.has(item.id));
  const relocationDialogs = <>
    <OpenRepositoryDialog
      open={relocatingRepository !== null}
      onOpenChange={(next) => { if (!next) setRelocatingRepository(null); }}
      title={`Locate ${relocatingRepository?.name ?? 'repository'}`}
      description={`OpenTig could not find ${relocatingRepository?.name ?? 'this repository'} at ${relocatingRepository?.path ?? 'its saved folder'}. Choose its folder on the server; this updates the saved location and does not move files.`}
      confirmLabel="Use this folder"
      initialPath={lastRelocationParentRef.current ?? (relocatingRepository ? parentFolderPath(relocatingRepository.path) ?? undefined : undefined)}
      recent={availableRecentRepositories}
      onBrowse={opentig.repository.browseDirectories}
      onOpen={async (path) => { if (relocatingRepository) await completeRelocation(relocatingRepository, path); }}
    />
    {relocationSearch && <RepositoryRelocationsDialog search={relocationSearch} onConfirm={relocateFoundRepositories} onClose={() => setRelocationSearch(null)} />}
  </>;
  const welcome = bootstrap && <Welcome recent={bootstrap.recentRepositories} unavailableRepositoryIds={unavailableRepositoryIds} preferences={bootstrap.preferences} onPreference={updatePreference}
    onOpen={openRepository} onClone={() => setCloneOpen(true)} onFind={() => setFindOpen(true)} onRecent={(id) => { setWelcomeReplay(false); void selectRecent(id); }}
    onSettings={openSettings} onBack={repository ? () => setWelcomeReplay(false) : undefined} />;

  const browserRepositoryDialog = <OpenRepositoryDialog confirmLabel="Add repository" onClone={() => { setOpenRepositoryDialog(false); setCloneOpen(true); }}
    description={window.opentigDesktop ? 'Choose a Git repository to add. It uses your default GitHub account, or another connected account that can access it.' : 'Choose a Git repository on your server to add. It uses your default GitHub account, or another connected account that can access it.'} open={openRepositoryDialog} recent={bootstrap?.recentRepositories} onPick={window.opentigDesktop ? opentig.repository.select : undefined} onOpenChange={setOpenRepositoryDialog} onBrowse={opentig.repository.browseDirectories} onOpen={async (path) => {
    await addRepositoryPath(path);
  }} />;

  if (!bootstrap) {
    return <SplashScreen heading={appDisplayName} detail={startupSplashDetail(connectionState)} />;
  }
  const settingsPreferences = mobile ? { ...bootstrap.preferences, wrapLines: mobileWrapLines } : bootstrap.preferences;
  if (!repository && unavailableRepository && !welcomeReplay) {
    const missing = unavailableRepository;
    return (
      <TooltipProvider>
        {relocationDialogs}
        <div className="fixed right-4 top-4 z-40"><DesktopUpdateIndicator /></div>
        <RepositoryUnavailable
          repository={missing}
          otherMissing={[...unavailableRepositoryIds].filter((id) => id !== missing.id).length}
          waiting={Boolean(busy)}
          onLocate={() => locateRepository(missing)}
          onRemove={async () => {
            await forgetRepository({ key: normalizeRepositoryKey(missing.commonDir), name: missing.name, rootPath: missing.path, recent: missing });
            setUnavailableRepository(null);
          }}
          onOpenAnother={() => setUnavailableRepository(null)}
        />
      </TooltipProvider>
    );
  }
  if (!repository) {
    return (
      <TooltipProvider>
        {browserRepositoryDialog}
        {relocationDialogs}
        {onboardingDialogs}
        {settingsOpen && <Suspense fallback={null}><WelcomeSettings preferences={settingsPreferences} onPreference={updateSettingsPreference} open onOpenChange={setSettingsOpen} section={settingsSection} onSectionChange={setSettingsSection} onOnboarding={showOnboarding} /></Suspense>}
        <div className="fixed right-4 top-4 z-40"><DesktopUpdateIndicator /></div>
        {welcome}
      </TooltipProvider>
    );
  }

  const pendingDestructiveCopy = destructiveAction ? destructiveActionCopy(destructiveAction) : null;
  // File tabs only show with files, so this is what still says something is unsaved elsewhere.
  const hasUnsavedFiles = (fileSessions.get(repository.id) ?? emptyFileSession).tabs.some((tab) => tab.dirty);
  const { conflicts, staged, changed } = changeLists;
  const stagedCount = status?.stagedCount ?? 0;
  const changeCount = status?.changes.length ?? 0;
  const sidebarSections: SidebarRailSection<SidebarView>[] = SIDEBAR_VIEWS.map((item) => {
    if (item === 'changes') {
      return {
        id: item, icon: <IconGitCompare />,
        label: stagedCount > 0 ? `Changes · ${stagedCount} staged of ${changeCount}` : changeCount > 0 ? `Changes · ${changeCount}` : 'Changes',
        badge: stagedCount > 0 ? { value: stagedCount, staged: true } : { value: changeCount, staged: false },
      };
    }
    if (item === 'files') return { id: item, icon: <IconFiles />, label: hasUnsavedFiles ? 'Files · unsaved changes' : 'Files', unsaved: hasUnsavedFiles };
    if (item === 'history') return { id: item, icon: <IconHistory />, label: 'History' };
    if (item === 'prs') return { id: item, icon: <IconBrandGithub />, label: pulls?.length ? `GitHub · ${pulls.length} pull ${pulls.length === 1 ? 'request' : 'requests'}` : 'GitHub' };
    return { id: item, icon: <IconSearch />, label: 'Search' };
  });
  // Docked at the bottom of the sidebar on desktop and floating over the list on phones. Its text and plan live here and outlast it.
  const hasCommitPlan = commitPlan.plan !== null || commitPlan.outcome !== null;
  const commitComposer = (
    <StoredCommitComposer
      store={commitMessage}
      open={mobile ? mobilePane === 'list' && view === 'changes' && mobileMainAction({ screen: 'changes', stagedCount, hasCommitPlan }) === 'commit' : view === 'changes' && Boolean(status?.stagedCount || hasCommitPlan)}
      stagedCount={status?.stagedCount ?? 0}
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
      canPush={Boolean(status?.branch && !status.detached && !status.readOnly)}
      plan={commitPlan.plan}
      outcome={commitPlan.outcome}
      changes={status?.changes ?? []}
      phone={mobile}
      textareaRef={commitTextareaRef}
      onGenerate={() => void generateCommitMessage()}
      onCancelGenerate={() => void cancelCommitMessageGeneration()}
      onPlanMode={(mode) => void runCommitPlanTask(() => commitPlan.chooseMode(mode))}
      onActivateGroup={(index) => void runCommitPlanTask(() => commitPlan.activate(index))}
      onDiscardPlan={() => void runCommitPlanTask(() => commitPlan.discard())}
      onDismissOutcome={commitPlan.clear}
      onOpenPath={(path, kind) => { selectViewer({ type: 'diff', path, kind }); }}
      onOpenCommit={(commit) => { selectViewer({ type: 'commit', oid: commit.oid, subject: commit.subject }); }}
      onCommit={(options) => void createCommit(options)}
    />
  );

  return (
    <ShortcutsProvider shortcuts={shortcuts}>
    <TooltipProvider>
      {browserRepositoryDialog}
      {relocationDialogs}
      {onboardingDialogs}
      {welcomeReplay && <div className="welcome-overlay">{welcome}</div>}
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
      <Dialog
        open={agentBranchSwitch !== null}
        onOpenChange={(open) => { if (!open && busy !== 'branch') setAgentBranchSwitch(null); }}
      >
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            {agentBranchSwitch && <AgentMarks agents={agentBranchSwitch.agents} max={4} />}
            <DialogTitle>
              {agentBranchSwitch ? `${listAgents(agentBranchSwitch.agents)} ${agentBranchSwitch.agents.length === 1 ? 'is' : 'are'} working in this folder` : 'An agent is working in this folder'}
            </DialogTitle>
            <DialogDescription>
              The branch belongs to the folder, so switching to {agentBranchSwitch?.label} here also switches it for {agentBranchSwitch?.agents.length === 1 ? 'that agent' : 'those agents'}: {agentBranchSwitch?.agents.length === 1 ? 'it keeps' : 'they keep'} working, but on {agentBranchSwitch?.label}, and uncommitted changes go along. To leave {agentBranchSwitch?.agents.length === 1 ? 'it' : 'them'} on {status?.branch ?? 'the current branch'}, cancel and run agents in their own worktrees.
            </DialogDescription>
            {repository && <div className="destructive-confirmation-detail">{repository.path}</div>}
          </div>
          <div className="undo-commit-actions">
            <Button variant="ghost" onClick={() => setAgentBranchSwitch(null)} disabled={busy === 'branch'}>Cancel</Button>
            <Button onClick={switchBranchDespiteAgents} disabled={busy === 'branch'}>
              <IconGitBranch /> {busy === 'branch' ? 'Switching…' : `Switch to ${agentBranchSwitch?.label ?? 'branch'} anyway`}
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
              <IconRestore /> {undoingCommit ? <ShimmeringText text="Undoing…" /> : 'Undo and stage changes'}
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
            onOpenGitHubSettings={() => { setCreatePrOpen(false); setSettingsSection('github'); setSettingsOpen(true); }}
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
      {authorshipRepositoryId === repository.id && (
        <CommitAuthorshipDialog key={repository.id} repository={repository} open onOpenChange={(open) => { if (!open) setAuthorshipRepositoryId(null); }} />
      )}
      {branchPush.remoteChoice && <PublishRemoteDialog key={branchPush.remoteChoice.id} choice={branchPush.remoteChoice} onSelect={branchPush.selectRemote} />}
      {branchPush.newBranchChoice && <PublishNewBranchDialog key={branchPush.newBranchChoice.id} choice={branchPush.newBranchChoice} onConfirm={branchPush.confirmNewBranch} />}
      <MobileChromeContext.Provider value={mobileChrome}>
      <div className="app-shell" data-mobile-pane={mobilePane} inert={welcomeReplay || undefined}>
        <Toolbar
          onOnboarding={showOnboarding}
          mobileViewer={mobile && mobilePane === 'viewer' ? mobileViewerBar : undefined}
          repository={repository}
          recent={bootstrap.recentRepositories}
          repositoryProjects={bootstrap.repositoryProjects}
          status={status}
          githubInfo={githubInfo}
          branchPullRequest={currentBranchPullRequest}
          branchPullRequestNewCommits={commitsAfterMerge}
          branchSwitchPending={busy === 'branch' || blockedBranchSwitch !== null || agentBranchSwitch !== null}
          onCreatePullRequest={() => setCreatePrOpen(true)}
          upstreamMismatch={upstreamMismatch}
          onOpenPullRequest={(number) => { selectViewer({ type: 'pull-request', number }); }}
          branches={branches}
          worktrees={worktrees}
          worktreeAgents={worktreeAgents}
          preferences={settingsPreferences}
          busy={busy}
          repositorySyncOperations={repositorySyncOperations}
          onOpen={openRepository}
          onRecent={selectRecent}
          remoteProblem={remoteProblem?.repositoryId === repository.id ? remoteProblem : null}
          onRemoteAccessAction={(action) => void handleRemoteAccessAction(action)}
          pendingRepositoryId={pendingRepositoryId}
          repositoryLoadPhase={repositoryLoadPhase}
          repositoryLoadVisible={repositoryLoadVisible}
          repositoryLoadSlow={repositoryLoadSlow}
          onBranch={switchBranch}
          onWorktree={switchWorktree}
          onRefresh={() => void refresh({ manual: true })}
          onPull={() => void pullUpdates()}
          onPush={() => void pushUpdates()}
          onRepositorySync={syncRepository}
          onPreference={updateSettingsPreference}
          onForgetRepository={forgetRepository}
          onRelocateRepository={relocateRepository}
          unavailableRepositoryIds={unavailableRepositoryIds}
          onRepositoryPickerOpen={refreshUnavailableRepositories}
          onOrganizationChange={(organization) => setBootstrap((current) => current ? { ...current, ...organization } : current)}
          onRefsManaged={handleRefsManaged}
          settingsOpen={settingsOpen}
          settingsSection={settingsSection}
          onSettingsOpen={setSettingsOpen}
          onSettingsSection={setSettingsSection}
        />
        {status?.readOnly && <div className="operation-banner">Repository is read-only: {status.operation} is in progress.</div>}

        <RepositoryLinksContext.Provider value={repositoryLinks}>
        <main className={`workspace${pendingRepositoryId && repositoryLoadVisible ? ' workspace-switching' : ''}`} aria-busy={repositoryLoadPhase ? true : undefined}>
          <aside
            className="sidebar"
            data-collapsed={sidebarCollapsed ? '' : undefined}
            ref={sidebarElement}
            style={{ width: sidebarCollapsed ? undefined : bootstrap.preferences.sidebarWidth }}
          >
            {sidebarCollapsed && (
              <SidebarRail
                sections={sidebarSections}
                active={view}
                toggleCombo={shortcuts.toggleSidebar}
                onSelect={showSidebarView}
                onExpand={() => setSidebarLayout({ sidebarCollapsed: false })}
              />
            )}
            <nav className="sidebar-tabs tab-list" aria-label="Repository views">
              {SIDEBAR_VIEWS.map((item, index) => (
                <button
                  key={item}
                  aria-current={view === item ? 'page' : undefined}
                  aria-keyshortcuts={`Control+${index + 1}`}
                  onClick={() => setView(item)}
                >
                  {item === 'changes' ? <IconGitCompare /> : item === 'files' ? <IconFiles /> : item === 'history' ? <IconHistory /> : item === 'prs' ? <IconBrandGithub /> : <IconSearch />}
                  <span className="sidebar-tab-label">{item === 'changes' ? 'Changes' : item === 'files' ? 'Files' : item === 'history' ? 'History' : item === 'prs' ? 'GitHub' : 'Search'}</span>
                  {item === 'changes' && status && status.changes.length > 0 && <span className="plain-count">{status.changes.length}</span>}
                  {item === 'prs' && pulls !== null && pulls.length > 0 && <span className="plain-count">{pulls.length}</span>}
                  {item === 'files' && hasUnsavedFiles && <span className="sidebar-tab-dot" role="img" aria-label="Unsaved files" />}
                  <span className="sidebar-tab-shortcut" data-digit={index + 1} aria-hidden="true" />
                </button>
              ))}
              {!mobile && <SidebarCollapseButton toggleCombo={shortcuts.toggleSidebar} onCollapse={() => setSidebarLayout({ sidebarCollapsed: true })} />}
            </nav>
            <div className="sidebar-body">
              <div className="view-fade">
              {keptSections.has('changes') && <Activity mode={view === 'changes' ? 'visible' : 'hidden'}>
              {!currentSnapshot && (
                <div className="view-loading" role="status"><Spinner className="view-spinner" /><ShimmeringText text="Loading changes…" /></div>
              )}
              {currentSnapshot && (
                <ChangesView
                  conflicts={conflicts}
                  staged={staged}
                  changed={changed}
                  displayMode={bootstrap.preferences.changesLayout}
                  readOnly={Boolean(status?.readOnly)}
                  discardDisabled={Boolean(busy)}
                  changeCount={status?.changes.length ?? 0}
                  insertions={status?.insertions ?? 0}
                  deletions={status?.deletions ?? 0}
                  selection={viewerSelection?.type === 'diff' ? { path: viewerSelection.path, kind: viewerSelection.kind }
                    : viewerSelection?.type === 'conflict' || viewerSelection?.type === 'file' ? { path: viewerSelection.path, kind: null }
                    : null}
                  unpublishedCommits={status?.ahead ?? 0}
                  branchNeedsPublication={needsBranchPublication(status)}
                  publishDisabled={Boolean(busy) || Boolean(status?.readOnly) || repositorySyncOperations.has(repository.id)}
                  onPublish={() => void pushUpdates()}
                  upstreamMismatch={offersNewBranch ? upstreamMismatch : null}
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
              </Activity>}
              {keptSections.has('files') && <Activity mode={view === 'files' ? 'visible' : 'hidden'}>
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
                    onFileIntent={(path) => prefetchFile(repository.id, path, fileStamp(path))}
                    historyState={fileHistoryState}
                    openFiles={fileSessions.get(repository.id) ?? emptyFileSession}
                    onActivateFile={activateFileTab}
                    onCloseFile={(path) => void closeFileTab(path)}
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
              </Activity>}
              {keptSections.has('history') && <Activity mode={view === 'history' ? 'visible' : 'hidden'}>
                <Suspense fallback={sidebarFallback}>
                <HistoryView
                  key={repository.id}
                  repositoryId={repository.id}
                  baseRef={historyQuery.data?.pages[0]?.baseRef}
                  activeOid={viewerSelection?.type === 'commit' || viewerSelection?.type === 'commit-file' ? viewerSelection.oid : null}
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
              </Activity>}
              {keptSections.has('search') && <Activity mode={view === 'search' ? 'visible' : 'hidden'}>
                <Suspense fallback={sidebarFallback}>
                <SearchView
                  repositoryId={repository.id}
                  active={view === 'search'}
                  revision={searchRevision}
                  onOpenFile={(path, line) => { setFileLineTarget(line ? { path, line, reached: false } : null); openFile(path); }}
                  unsavedPathsAmong={unsavedTabsUnder}
                  onReplaced={() => { void refresh({ background: true }); }}
                />
                </Suspense>
              </Activity>}
              {keptSections.has('prs') && <Activity mode={view === 'prs' ? 'visible' : 'hidden'}>
                <Suspense fallback={sidebarFallback}>
                <PullRequestsView
                  repositoryId={repository.id}
                  info={githubInfo}
                  ghStatus={ghStatus}
                  account={githubAccount}
                  onOpenGitHubSettings={() => { setSettingsSection('github'); setSettingsOpen(true); }}
                  pulls={pulls}
                  loading={pullsLoading}
                  error={pullsError}
                  states={pullRequestStates}
                  activeNumber={viewerSelection?.type === 'pull-request' ? viewerSelection.number : null}
                  createDisabledReason={pullRequestCreationDisabledReason ?? (!status
                    ? 'Loading repository status…'
                    : status.detached || status.unborn || !status.branch
                      ? 'Check out a branch first'
                      : null)}
                  onRefresh={() => void loadPulls(pullRequestStates, true)}
                  onStateChange={(state, checked) => {
                    const order: PullRequestState[] = ['OPEN', 'CLOSED', 'MERGED'];
                    const nextStates = order.filter((candidate) => candidate === state ? checked : pullRequestStates.includes(candidate));
                    setPullRequestStates(nextStates);
                  }}
                  onSelect={(number) => { selectViewer({ type: 'pull-request', number }); }}
                  section={pullRequestsSection}
                  onSectionChange={setPullRequestsSection}
                  activeRelease={viewerSelection?.type === 'release' ? viewerSelection.tag : null}
                  onSelectRelease={(tag) => { selectViewer({ type: 'release', tag }); }}
                  activeRun={viewerSelection?.type === 'workflow-run' ? viewerSelection.runId : null}
                  onSelectRun={(runId) => { selectViewer({ type: 'workflow-run', runId }); }}
                  actionsWorkflowId={actionsWorkflowId}
                  onActionsWorkflowChange={setActionsWorkflowId}
                  onCreate={() => setCreatePrOpen(true)}
                  onCopyCommand={(command) => {
                    void writeClipboardText(command)
                      .then(() => sileo.success({ title: 'Command copied', description: command }))
                      .catch(() => sileo.error({ title: 'Could not copy the command' }));
                  }}
                />
                </Suspense>
              </Activity>}
              </div>
            </div>
            {!mobile && commitComposer}
            {!welcomeReplay && (bootstrap.onboardingVersion === 0 || checklistReplay) && <GettingStartedChecklist key={repository.id} repository={repository} onDismiss={dismissChecklist} onSettings={openSettings} />}
          </aside>
          {!mobile && !sidebarCollapsed && (
            <SidebarResizeHandle
              width={bootstrap.preferences.sidebarWidth}
              railWidth={SIDEBAR_RAIL_WIDTH}
              onPreview={previewSidebarWidth}
              onResize={(width) => setSidebarLayout({ sidebarWidth: width })}
              onCollapse={() => setSidebarLayout({ sidebarCollapsed: true })}
            />
          )}
          <section className="viewer-pane">
            {!mobile && (view === 'files' || viewerSelection?.type === 'file') && (
              <OpenFilesStrip
                session={fileSessions.get(repository.id) ?? emptyFileSession}
                onActivate={activateFileTab}
                onPin={(path) => openFile(path, 'pinned')}
                onClose={(path) => void closeFileTab(path)}
                onReorder={reorderFileTab}
                toolsRef={setFileViewerToolbarHost}
              />
            )}
            <div className="viewer-pane-body">
              <ErrorBoundary
                resetKey={viewerSelection}
                fallback={(err) => isModuleLoadError(err) ? (
                  // Retrying already failed, so the part is gone (OpenTig was updated) or the connection is down.
                  <div className="viewer-message flex-col gap-3 text-center">
                    <p>This part of OpenTig couldn't be loaded.</p>
                    <small className="text-muted-foreground">OpenTig may have been updated, or the connection dropped. Reload the page to continue.</small>
                    <Button variant="outline" size="sm" onClick={() => window.location.reload()}><IconRefresh /> Reload</Button>
                  </div>
                ) : (
                  <div className="viewer-message flex-col gap-2 text-center text-destructive">
                    <p>Could not display this content.</p>
                    <small className="text-muted-foreground">{err.message}</small>
                  </div>
                )}
              >
                <Suspense fallback={<div className="viewer-message"><Spinner className="view-spinner" /> <ShimmeringText text="Preparing viewer…" /></div>}>
                  <FileViewerToolbarHostContext.Provider value={fileViewerToolbarHost}>
                    <FileLineTargetContext.Provider value={fileLineTarget}>
                    <LineBlameContext.Provider value={lineBlameSettings}>
                    <Viewer
                      repositoryId={repository.id}
                      selection={viewerSelection}
                      diffView={diffView}
                      wrapLines={wrapLines}
                      theme={theme}
                      revision={refreshVersion}
                      readOnly={Boolean(status?.readOnly)}
                      commits={commits ?? []}
                      githubRepository={githubInfo?.isGitHub ? githubInfo.nameWithOwner : null}
                      undoBlocked={Boolean(status?.operation) || undoingCommit}
                      onUndoCommit={setUndoCommit}
                      draftFor={(path) => readFileDraft(repository.id, path)}
                      fileStamp={fileStamp}
                      onSelect={selectViewer}
                      onOpenFile={openFile}
                      onDiffViewChange={(value) => void updatePreference({ diffView: value })}
                      onWrapLinesChange={changeWrapLines}
                      onDiscardDiff={(path) => discardChanges([path])}
                      onDraftChange={storeFileDraft}
                      onDraftSaved={(path) => {
                        dropFileDraft(repository.id, path);
                        updateFileSession(repository.id, (session) => setTabDirty(session, path, false));
                      }}
                      onUpdateConflict={updateConflictFile}
                      onResolveConflict={resolveConflictFile}
                    />
                    </LineBlameContext.Provider>
                    </FileLineTargetContext.Provider>
                    {mobile && viewerSelection?.type === 'file' && (
                      <MobileFileBar
                        path={viewerSelection.path}
                        files={files}
                        session={fileSessions.get(repository.id) ?? emptyFileSession}
                        revision={filesSnapshotRevision}
                        actions={{ readOnly: Boolean(status?.readOnly || busy), fileClipboardAvailable: capabilities?.fileClipboard === true, revealAvailable: capabilities?.revealInFileManager === true, onOpenFile: openFile, onCopyEntries: copyFileEntries, onCutEntries: cutFileEntries, onCopyPath: copyFilePaths, onCopyContents: copyFileContents, onReveal: revealFileEntry, onPaste: pasteFileEntries, onDeleteEntries: deleteFileEntries }}
                        onActivateFile={activateFileTab}
                        onCloseFile={(path) => void closeFileTab(path)}
                        onLoadDirectory={loadDirectoryEntries}
                        onMove={moveFileEntries}
                        onRename={renameFileEntry}
                        onCreate={createFileEntry}
                      />
                    )}
                  </FileViewerToolbarHostContext.Provider>
                </Suspense>
              </ErrorBoundary>
            </div>
          </section>
        </main>
        </RepositoryLinksContext.Provider>
        {mobile && <div ref={setMobileFloatHost} className="mobile-float">{commitComposer}</div>}
        <nav className="mobile-navigation" aria-label="Repository views">
          {SIDEBAR_VIEWS.map((item) => (
            <button key={item} aria-current={view === item ? 'page' : undefined} onClick={() => { setView(item); setMobilePane('list'); }}>
              {item === 'changes' ? <IconGitCompare /> : item === 'files' ? <IconFiles /> : item === 'history' ? <IconHistory /> : item === 'prs' ? <IconBrandGithub /> : <IconSearch />}
              <span className="mobile-nav-label">{item === 'changes' ? 'Changes' : item === 'files' ? 'Files' : item === 'history' ? 'History' : item === 'prs' ? 'GitHub' : 'Search'}</span>
              {item === 'changes' && view !== 'changes' && Boolean(status?.changes.length) && <span className="mobile-nav-indicator" role="img" aria-label={`${status!.changes.length} changes`} />}
              {item === 'files' && view !== 'files' && hasUnsavedFiles && <span className="mobile-nav-indicator" role="img" aria-label="Unsaved files" />}
            </button>
          ))}
        </nav>
      </div>
      </MobileChromeContext.Provider>
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

/** File tab shortcuts. `Ctrl+1`–`Ctrl+9` stays reserved for sidebar sections. */
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

function requestsSince(before: Record<string, number>, now: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(now).flatMap(([command, count]) => {
    const made = count - (before[command] ?? 0);
    return made > 0 ? [[command, made]] : [];
  }));
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
  if (selection.type === 'release') return typeof selection.tag === 'string';
  if (selection.type === 'workflow-run') {
    return typeof selection.runId === 'number' && (selection.jobId === undefined || typeof selection.jobId === 'number');
  }
  return selection.type === 'pull-request' && typeof selection.number === 'number';
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : 'An unexpected error occurred.'; }
function sentenceCaseLabel(label: string): string {
  return label.length > 0 ? `${label[0]!.toLocaleLowerCase()}${label.slice(1)}` : label;
}
function unconfirmedResultToast(reason: unknown): { title: string; description: string; duration: number } | null {
  return isUnconfirmedResult(reason) ? { title: 'Result not confirmed', description: UNCONFIRMED_RESULT_MESSAGE, duration: 10_000 } : null;
}
/** The repository state of a moved repository, carried from its old id to the new one. */
function rebindBootstrapRepository(current: BootstrapData, previousId: string, selected: RepositoryInfo): BootstrapData {
  const previous = current.recentRepositories.find((item) => item.id === previousId);
  if (!previous) return current;
  const previousKey = normalizeRepositoryKey(previous.commonDir);
  const nextKey = normalizeRepositoryKey(selected.commonDir);
  const destinationAlreadyAssigned = current.repositoryProjects.some((project) => (
    project.repositoryKeys.some((key) => key === nextKey && key !== previousKey)
  ));
  return {
    ...current,
    activeRepository: current.activeRepository?.id === previousId ? selected : current.activeRepository,
    repositoryProjects: current.repositoryProjects.map((project) => ({
      ...project,
      repositoryKeys: [...new Set(project.repositoryKeys.flatMap((key) => (
        key !== previousKey ? [key] : destinationAlreadyAssigned ? [] : [nextKey]
      )))],
    })),
    recentRepositories: current.recentRepositories.flatMap((item) => item.id === previousId
      ? [{ ...selected, lastOpenedAt: item.lastOpenedAt }] : item.id === selected.id ? [] : [item]),
    filesTreeStates: normalizeFilesTreeStates(current.filesTreeStates.map((state) => (
      state.repositoryId === previousId ? { ...state, repositoryId: selected.id } : state
    ))),
    openFilesStates: normalizeOpenFilesStates(current.openFilesStates.map((state) => (
      state.repositoryId === previousId ? { ...state, repositoryId: selected.id } : state
    ))),
  };
}
/** Set while App is mounted: a missing repository folder gets the relocation screen instead of a toast. */
let repositoryMissingHandler: ((title: string, reason: unknown) => void) | null = null;
function isRepositoryMissing(reason: unknown): boolean {
  return serializedErrorFromReason(reason)?.code === 'REPOSITORY_MISSING';
}
function reportError(title: string, reason: unknown): void {
  if (repositoryMissingHandler && isRepositoryMissing(reason)) { repositoryMissingHandler(title, reason); return; }
  sileo.error(unconfirmedResultToast(reason) ?? { title, description: messageOf(reason), duration: 10_000 });
  if (serializedErrorFromReason(reason)) return;
  void opentig.diagnostics.record({ operation: title, message: messageOf(reason), ...connectionCloseCode(reason) }).catch(() => undefined);
}
let lastConnectionLossRecord = 0;
/** A background refresh repeats when the connection returns, so losing one needs no toast. Its retries are one problem, not several. */
function recordConnectionLoss(title: string, reason: unknown): void {
  const now = Date.now();
  if (now - lastConnectionLossRecord < 60_000) return;
  lastConnectionLossRecord = now;
  void opentig.diagnostics.record({ operation: title, level: 'warn', message: messageOf(reason), ...connectionCloseCode(reason) }).catch(() => undefined);
}
function connectionCloseCode(reason: unknown): { code: string } | Record<string, never> {
  return reason instanceof ServerDisconnectedError && reason.closeCode !== undefined ? { code: `WS_CLOSE_${reason.closeCode}` } : {};
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

/**
 * What the client last read of a repository, if it still holds it: status, refs and the file tree are kept
 * for five minutes after their last read (React Query's default). Without a status there is nothing to show.
 */
function knownSnapshot(client: ReturnType<typeof useQueryClient>, repositoryId: string): {
  status: RepositoryStatus; branches: BranchInfo[] | null; worktrees: WorktreeInfo[] | null; files: FileTreeEntry[] | null;
} | null {
  const status = client.getQueryData<RepositoryStatus>(queryKeys.status(repositoryId));
  if (!status) return null;
  return {
    status,
    branches: client.getQueryData<BranchInfo[]>(queryKeys.branches(repositoryId)) ?? null,
    worktrees: client.getQueryData<WorktreeInfo[]>(queryKeys.worktrees(repositoryId)) ?? null,
    files: client.getQueryData<FileTreeEntry[]>(queryKeys.files(repositoryId)) ?? null,
  };
}
