import { type CSSProperties, type ReactNode, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  IconChevronDown, IconChevronRight, IconDeviceDesktop, IconFileArrowRight, IconFolder, IconFolderOpen,
  IconFiles, IconGitBranch, IconGitCompare, IconGitPullRequest, IconHierarchy2, IconHistory,
  IconLayoutColumns, IconLayoutRows, IconList, IconLoader4, IconMinus, IconMoon, IconPlus,
  IconRefresh, IconRestore, IconSettings, IconSparkles, IconSun, IconX,
} from '@tabler/icons-react';
import { Toaster, toast } from 'sonner';
import type { AiHarnessId, AiHarnessStatus, BootstrapData, DiffViewPreference, FileHistoryPathChange, FileHistoryState, GhCliStatus, GitHubRepositoryInfo, Preferences, PullRequestSummary, RecentRepository, RepositoryInfo, RepositoryOrganization, RepositoryProject, ThemePreference, UndoLatestCommitResult } from '../../shared/contracts';
import { normalizeRepositoryKey } from '../../shared/repository-projects';
import type { SerializedAiError } from '../../shared/errors';
import type { BranchInfo, ChangeKind, CommitFile, CommitInfo, FileChange, FileTreeEntry, RepositoryStatus, WorktreeInfo } from '../../shared/git-types';
import { mergeRepositoryChangeScopes, type RepositoryChangeScope } from '../../shared/repository-change';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox, ComboboxContent, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FilesView } from '@/features/files/FilesView';
import { fileSnapshotFingerprint, isEditableTarget, pathContains, selectedFileChanged, snapshotPathPresence } from '@/features/files/file-tree';
import { QuickOpenDialog } from '@/features/files/QuickOpenDialog';
import { isQuickOpenShortcut } from '@/features/files/quick-open';
import { CommitComposer } from '@/features/commit/CommitComposer';
import { CreatePullRequestDialog } from '@/features/pulls/CreatePullRequestDialog';
import { PullRequestsView } from '@/features/pulls/PullRequestsView';
import { LocalRefsDialog } from '@/features/refs/LocalRefsDialog';
import type { LocalRefsTab } from '@/features/refs/local-refs-model';
import { RepositoryProjectsDialog } from '@/features/repositories/RepositoryProjectsDialog';
import { buildRepositoryPickerModel, getRepositoryPickerDisplayOrder, groupRecentRepositories, shortenRepositoryPath, touchRecentRepositories, type RepositoryOption } from '@/features/repositories/repository-select-model';
import type { ViewerSelection } from '@/features/viewer/Viewer';
import { getVsCodeFileIconUrl, getVsCodeFolderIconUrl } from '@/lib/vscode-icons';
import { refreshOperationsForScope } from './refresh-policy';
import { resolveWindowControlsInset } from './window-controls';
import { RefreshCoordinator, type RefreshRequest } from '@/lib/RefreshCoordinator';

const Viewer = lazy(() => import('@/features/viewer/Viewer'));
const SIDEBAR_VIEWS = ['changes', 'files', 'history', 'prs'] as const;
type SidebarView = (typeof SIDEBAR_VIEWS)[number];
interface AppRefreshOptions {
  background?: boolean;
  scope?: RepositoryChangeScope;
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [status, setStatus] = useState<RepositoryStatus | null>(null);
  const [files, setFiles] = useState<FileTreeEntry[] | null>(null);
  // A root snapshot intentionally omits the contents of collapsed ignored
  // folders. Keep a separate revision so a fresh snapshot can still invalidate
  // their lazy cache when that compact root representation is unchanged.
  const [filesSnapshotRevision, setFilesSnapshotRevision] = useState(0);
  const [fileHistoryState, setFileHistoryState] = useState<FileHistoryState>({ canUndo: false, undoLabel: null, canRedo: false, redoLabel: null });
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [view, setView] = useState<SidebarView>('changes');
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [generating, setGenerating] = useState<string | null>(null);
  const [undoCommit, setUndoCommit] = useState<CommitInfo | null>(null);
  const [undoingCommit, setUndoingCommit] = useState(false);
  const [githubInfo, setGithubInfo] = useState<GitHubRepositoryInfo | null>(null);
  const [ghStatus, setGhStatus] = useState<GhCliStatus | null>(null);
  const [pulls, setPulls] = useState<PullRequestSummary[] | null>(null);
  const [pullsLoading, setPullsLoading] = useState(false);
  const [pullsError, setPullsError] = useState<string | null>(null);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // Holding Ctrl reveals the section numbers, so the shortcut is discoverable
  // without a cheat sheet.
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const pullsRequestToken = useRef(0);
  const requestToken = useRef(0);
  const filesRequestToken = useRef(0);
  const filesRef = useRef<FileTreeEntry[] | null>(null);
  const viewerSelectionRef = useRef<ViewerSelection>(null);
  const viewerDirtyRef = useRef(false);
  // A path we just created/renamed/moved the viewer onto; it may be missing from
  // an in-flight (stale) file snapshot, so don't declare it deleted until it appears.
  const pendingViewerPathRef = useRef<string | null>(null);
  const generationRequest = useRef<{ id: string; repositoryId: string } | null>(null);
  const [filesTreeStates] = useState<Map<string, string[]>>(() => new Map());
  const commitTextareaRef = useRef<HTMLTextAreaElement>(null);

  const theme = bootstrap?.preferences.theme ?? 'system';
  const diffView = bootstrap?.preferences.diffView ?? 'unified';
  const wrapLines = bootstrap?.preferences.wrapLines ?? false;
  const uiZoom = bootstrap?.preferences.uiZoom ?? 100;

  useEffect(() => {
    let active = true;
    window.justgit.app.bootstrap().then((data) => {
      if (!active) return;
      filesTreeStates.clear();
      for (const state of data.filesTreeStates) filesTreeStates.set(state.repositoryId, [...state.expandedPaths]);
      setBootstrap(data);
      setRepository(data.activeRepository);
    }).catch((reason) => setError(messageOf(reason)));
    return () => { active = false; };
  }, [filesTreeStates]);

  useEffect(() => {
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
      });
      document.documentElement.style.setProperty('--window-controls-inset', `${inset.right}px`);
      document.documentElement.style.setProperty('--window-controls-inset-left', `${inset.left}px`);
    };
    apply();
    overlay?.addEventListener('geometrychange', apply);
    window.addEventListener('resize', apply);
    return () => {
      overlay?.removeEventListener('geometrychange', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      void window.justgit.app.setTitleBarTheme(dark).catch(() => undefined);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    window.justgit.app.setZoomFactor(uiZoom / 100);
  }, [uiZoom]);

  useEffect(() => {
    if (!bootstrap?.performanceAutomation) return;
    window.__justgitPerformanceAutomation = true;
    window.__justgitPerformanceResults = [];
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (!action || typeof action !== 'object') return;
      const record = action as Record<string, unknown>;
      if (record.type === 'refresh') {
        setRefreshVersion((version) => version + 1);
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
    window.addEventListener('justgit:performance-action', handleAction);
    return () => {
      window.removeEventListener('justgit:performance-action', handleAction);
      delete window.__justgitPerformanceAutomation;
      delete window.__justgitPerformanceResults;
    };
  }, [bootstrap?.performanceAutomation]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    viewerSelectionRef.current = viewerSelection;
  }, [viewerSelection]);

  const applyFilesSnapshot = useCallback((nextFiles: FileTreeEntry[]) => {
    const previous = filesRef.current;
    const same = previous !== null && fileSnapshotFingerprint(previous) === fileSnapshotFingerprint(nextFiles);
    filesRef.current = same && previous ? previous : nextFiles;
    if (!same) setFiles(nextFiles);
    setFilesSnapshotRevision((revision) => revision + 1);

    const active = viewerSelectionRef.current;
    if (active?.type !== 'file') return;
    const presence = snapshotPathPresence(nextFiles, active.path);
    if (presence === 'missing') {
      if (pendingViewerPathRef.current === active.path) return;
      viewerSelectionRef.current = null;
      setViewerSelection(null);
      toast.info('File no longer exists', { description: active.path });
      return;
    }
    if (pendingViewerPathRef.current === active.path) pendingViewerPathRef.current = null;
    if (presence === 'present' && previous && selectedFileChanged(previous, nextFiles, active.path)) {
      setRefreshVersion((version) => version + 1);
    }
  }, []);

  const refreshFilesOnly = useCallback(async () => {
    if (!repository) return;
    const token = ++filesRequestToken.current;
    try {
      const nextFiles = await window.justgit.repository.getFiles(repository.id);
      if (token === filesRequestToken.current) applyFilesSnapshot(nextFiles);
    } catch (reason) {
      if (token === filesRequestToken.current) setError(messageOf(reason));
    }
  }, [applyFilesSnapshot, repository]);

  // Folders the file tree leaves collapsed (git-ignored trees) are read one level
  // at a time, the first time the user opens them.
  const loadDirectoryEntries = useCallback(async (directoryPath: string): Promise<FileTreeEntry[]> => {
    if (!repository) return [];
    try {
      return await window.justgit.repository.getDirectoryEntries(repository.id, directoryPath);
    } catch (reason) {
      toast.error('Could not read folder', { description: messageOf(reason) });
      return [];
    }
  }, [repository]);

  const refreshFileHistoryState = useCallback(async () => {
    if (!repository) return;
    setFileHistoryState(await window.justgit.repository.fileHistoryState(repository.id));
  }, [repository]);

  useEffect(() => {
    if (!repository) { setFileHistoryState({ canUndo: false, undoLabel: null, canRedo: false, redoLabel: null }); return; }
    void refreshFileHistoryState();
  }, [refreshFileHistoryState, repository]);

  const performRefresh = useCallback(async (request: RefreshRequest<RepositoryChangeScope>) => {
    if (!repository) return;
    const { background, scope } = request;
    const operations = refreshOperationsForScope(scope, view);
    const token = ++requestToken.current;
    const filesToken = operations.files ? ++filesRequestToken.current : null;
    if (!background) setBusy('refresh');
    setError(null);
    try {
      const [nextStatus, nextBranches, nextWorktrees, nextFiles, nextHistory] = await Promise.all([
        window.justgit.repository.getStatus(repository.id),
        operations.branches ? window.justgit.refs.listBranches(repository.id) : Promise.resolve(null),
        operations.worktrees ? window.justgit.refs.listWorktrees(repository.id) : Promise.resolve(null),
        operations.files ? window.justgit.repository.getFiles(repository.id) : Promise.resolve(null),
        operations.history ? window.justgit.commits.list(repository.id) : Promise.resolve(null),
      ]);
      if (token !== requestToken.current) return;
      setStatus(nextStatus);
      if (nextBranches) setBranches(nextBranches);
      if (nextWorktrees) setWorktrees(nextWorktrees);
      if (nextFiles && filesToken === filesRequestToken.current) {
        applyFilesSnapshot(nextFiles);
      }
      if (nextHistory) {
        setCommits(nextHistory.commits);
        setNextCursor(nextHistory.nextCursor);
      }
      setRefreshVersion((version) => version + 1);
    } catch (reason) {
      if (token === requestToken.current) setError(messageOf(reason));
    } finally {
      if (!background && token === requestToken.current) setBusy(null);
    }
  }, [applyFilesSnapshot, repository, view]);
  // `performRefresh` changes identity whenever the active view changes, so the
  // coordinator reads it through a ref instead of being rebuilt: a new
  // coordinator would re-run the repository reset effect below on every tab
  // switch and wipe state nothing refetches (GitHub info, files, history).
  const performRefreshRef = useRef(performRefresh);
  useEffect(() => { performRefreshRef.current = performRefresh; }, [performRefresh]);
  // The callback only reads its refs when a queued refresh executes; constructing
  // the coordinator does not invoke it during render.
  const refreshCoordinator = useMemo(() => new RefreshCoordinator<RepositoryChangeScope>(
    // eslint-disable-next-line react-hooks/refs
    (request) => performRefreshRef.current(request),
    mergeRepositoryChangeScopes,
  ), []);

  const refresh = useCallback((options?: AppRefreshOptions) => refreshCoordinator.request({
    background: options?.background === true,
    scope: options?.scope ?? 'unknown',
  }), [refreshCoordinator]);

  useEffect(() => () => refreshCoordinator.invalidate(), [refreshCoordinator]);

  useEffect(() => {
    requestToken.current += 1;
    filesRequestToken.current += 1;
    refreshCoordinator.invalidate();
    commitFilesCache.clear();
    filesRef.current = null;
    setFiles(null);
    setCommits(null);
    setNextCursor(null);
    pullsRequestToken.current += 1;
    setGithubInfo(null);
    setGhStatus(null);
    setPulls(null);
    setPullsError(null);
    setPullsLoading(false);
    setCreatePrOpen(false);
    setQuickOpen(false);
  }, [refreshCoordinator, repository?.id]);

  useEffect(() => {
    if (!repository) return;
    let active = true;
    // Local parse of the origin remote; no gh invocation and no network.
    window.justgit.github.repositoryInfo(repository.id)
      .then((info) => { if (active) setGithubInfo(info); })
      .catch(() => { if (active) setGithubInfo({ isGitHub: false, nameWithOwner: null }); });
    return () => { active = false; };
  }, [repository]);

  const loadPulls = useCallback(async (forceStatus = false) => {
    if (!repository) return;
    const token = ++pullsRequestToken.current;
    setPullsLoading(true);
    setPullsError(null);
    try {
      const nextGhStatus = await window.justgit.github.status(forceStatus);
      if (token !== pullsRequestToken.current) return;
      setGhStatus(nextGhStatus);
      if (!nextGhStatus.installed || nextGhStatus.authStatus === 'unauthenticated') return;
      const list = await window.justgit.github.listPullRequests(repository.id);
      if (token !== pullsRequestToken.current) return;
      setPulls(list);
    } catch (reason) {
      if (token === pullsRequestToken.current) setPullsError(messageOf(reason));
    } finally {
      if (token === pullsRequestToken.current) setPullsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    if (view !== 'prs' || !githubInfo?.isGitHub || pullsLoading || pullsError) return;
    const ready = ghStatus !== null && ghStatus.installed && ghStatus.authStatus !== 'unauthenticated';
    if (ghStatus === null || (ready && pulls === null)) void loadPulls();
  }, [ghStatus, githubInfo, loadPulls, pulls, pullsError, pullsLoading, view]);

  useEffect(() => {
    setViewerSelection(null);
    void refresh();
  }, [refresh, repository?.id, view]);

  useEffect(() => window.justgit.events.onRepositoryChanged((repositoryId, scope) => {
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
    window.addEventListener('justgit:performance-action', handleBurst);
    return () => window.removeEventListener('justgit:performance-action', handleBurst);
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

  const recordOpenedRepository = useCallback((selected: RepositoryInfo) => {
    setRepository(selected);
    setBootstrap((current) => current ? {
      ...current,
      activeRepository: selected,
      recentRepositories: touchRecentRepositories(current.recentRepositories, selected, current.repositoryProjects),
    } : current);
  }, []);

  const openRepository = useCallback(async () => {
    try {
      const selected = await window.justgit.repository.select();
      if (!selected) return;
      recordOpenedRepository(selected);
    } catch (reason) { setError(messageOf(reason)); }
  }, [recordOpenedRepository]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); void openRepository(); }
      if (event.ctrlKey && event.key.toLowerCase() === 'r') { event.preventDefault(); void refresh(); }
      if (repository && event.ctrlKey && !event.altKey && !event.metaKey) {
        const section = SIDEBAR_VIEWS[Number(event.key) - 1];
        if (section) { event.preventDefault(); setView(section); }
      }
      if (repository && !event.repeat && isQuickOpenShortcut(event)) {
        if (!quickOpen && document.querySelector('[data-slot="dialog-popup"]')) return;
        event.preventDefault();
        setQuickOpen(true);
        void refreshFilesOnly();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openRepository, quickOpen, refresh, refreshFilesOnly, repository]);

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
      const preferences = await window.justgit.app.setPreferences(partial);
      setBootstrap((current) => current ? { ...current, preferences } : current);
    } catch (reason) { setError(messageOf(reason)); }
  };

  const persistFilesTreeExpandedPaths = useCallback((paths: string[]) => {
    if (!repository) return;
    filesTreeStates.set(repository.id, [...paths]);
    void window.justgit.app.setFilesTreeExpandedPaths(repository.id, paths)
      .catch((reason) => setError(messageOf(reason)));
  }, [filesTreeStates, repository]);

  const runIndexOperation = async (mode: 'stage' | 'unstage', paths: string[]) => {
    if (!repository || !status || paths.length === 0) return;
    const previous = status;
    setStatus(optimisticStatus(status, paths, mode));
    setBusy(mode);
    setError(null);
    try {
      if (mode === 'stage') await window.justgit.index.stage(repository.id, paths);
      else await window.justgit.index.unstage(repository.id, paths);
      await refresh({ background: true });
    } catch (reason) {
      setStatus(previous);
      setError(messageOf(reason));
    } finally { setBusy(null); }
  };

  const discardChanges = async (paths: string[]) => {
    if (!repository || paths.length === 0) return;
    setBusy('discard');
    setError(null);
    try {
      await window.justgit.index.discard(repository.id, paths);
      await refresh({ background: true });
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  };

  const selectViewer = useCallback((selection: ViewerSelection): boolean => {
    const current = viewerSelectionRef.current;
    const same = JSON.stringify(current) === JSON.stringify(selection);
    if (!same && viewerDirtyRef.current && !window.confirm('You have unsaved file changes. Discard them and continue?')) {
      return false;
    }
    viewerDirtyRef.current = false;
    viewerSelectionRef.current = selection;
    setViewerSelection(selection);
    return true;
  }, []);

  const handleViewerDirtyChange = useCallback((dirty: boolean) => {
    viewerDirtyRef.current = dirty;
  }, []);

  const openFile = (path: string) => {
    return selectViewer({ type: 'file', path });
  };

  const reconcileViewerPaths = (changes: FileHistoryPathChange[], removedPaths: string[]) => {
    const current = viewerSelectionRef.current;
    if (current?.type !== 'file') return;
    if (removedPaths.some((item) => pathContains(item, current.path))) {
      viewerSelectionRef.current = null;
      setViewerSelection(null);
      return;
    }
    const change = changes.find((item) => pathContains(item.from, current.path));
    if (!change) return;
    const nextSelection = { type: 'file', path: `${change.to}${current.path.slice(change.from.length)}` } as const;
    pendingViewerPathRef.current = nextSelection.path;
    viewerSelectionRef.current = nextSelection;
    setViewerSelection(nextSelection);
    setRefreshVersion((version) => version + 1);
  };

  const performFileHistory = async (direction: 'undo' | 'redo') => {
    if (!repository || busy || status?.readOnly) return;
    const active = viewerSelectionRef.current;
    if (active?.type === 'file' && viewerDirtyRef.current) {
      toast.info(`Save the open file before ${direction === 'undo' ? 'undoing' : 'redoing'} a Files operation`, { description: active.path });
      return;
    }
    setBusy(`${direction}-file`);
    try {
      const result = direction === 'undo'
        ? await window.justgit.repository.undoFileOperation(repository.id)
        : await window.justgit.repository.redoFileOperation(repository.id);
      setFileHistoryState(result.state);
      if (result.status === 'empty') return;
      if (result.status === 'conflict') {
        toast.error(`Could not ${direction} ${result.label}`, { description: result.message, duration: 10_000 });
        return;
      }
      if (result.status === 'recycle-bin') {
        toast.info(`${result.label} cannot be undone in JustGit`, { description: 'Restore it from the Recycle Bin.' });
        return;
      }
      reconcileViewerPaths(result.pathChanges, result.removedPaths);
      await refresh({ background: true });
      toast.success(`${direction === 'undo' ? 'Undid' : 'Redid'} ${result.label}`);
    } catch (reason) {
      toast.error(`Could not ${direction} Files operation`, { description: messageOf(reason), duration: 10_000 });
    } finally { setBusy(null); }
  };

  const copyFilePaths = async (entries: FileTreeEntry[]) => {
    if (!repository || entries.length === 0) return;
    try {
      const paths = await Promise.all(entries.map((entry) => window.justgit.repository.getAbsolutePath(repository.id, entry.path)));
      await window.justgit.clipboard.writeText(paths.join('\n'));
      toast.success(paths.length === 1 ? 'Path copied' : `${paths.length} paths copied`, {
        description: entries.length === 1 ? entries[0]!.path : undefined,
      });
    } catch (reason) {
      toast.error('Could not copy path', { description: messageOf(reason) });
    }
  };

  const copyFileContents = async (entry: FileTreeEntry) => {
    if (!repository || entry.type !== 'file') return;
    try {
      const result = await window.justgit.repository.readFile(repository.id, entry.path);
      if (result.binary) {
        toast.info('Binary files cannot be copied as text', { description: entry.path });
        return;
      }
      if (result.tooLarge) {
        toast.info('File is too large to copy safely', { description: entry.path });
        return;
      }
      await window.justgit.clipboard.writeText(result.content);
      toast.success('File copied', { description: entry.path });
    } catch (reason) {
      toast.error('Could not copy file', { description: messageOf(reason) });
    }
  };

  const copyFileEntries = async (entries: FileTreeEntry[]) => {
    if (!repository || entries.length === 0) return;
    try {
      await window.justgit.repository.copyEntries(repository.id, entries.map((entry) => entry.path));
      toast.success(
        entries.length === 1 ? (entries[0]!.type === 'directory' ? 'Folder copied' : 'File copied') : `${entries.length} items copied`,
        { description: 'Select a destination folder in Files and press Ctrl+V.' },
      );
    } catch (reason) {
      toast.error('Could not copy item', { description: messageOf(reason) });
    }
  };

  const cutFileEntries = async (entries: FileTreeEntry[]) => {
    if (!repository || busy || status?.readOnly || entries.length === 0) return;
    const active = viewerSelectionRef.current;
    if (active?.type === 'file' && entries.some((entry) => pathContains(entry.path, active.path)) && viewerDirtyRef.current) {
      toast.info('Save the open file before cutting it', { description: active.path });
      return;
    }
    try {
      await window.justgit.repository.cutEntries(repository.id, entries.map((entry) => entry.path));
      toast.success(
        entries.length === 1 ? (entries[0]!.type === 'directory' ? 'Folder cut' : 'File cut') : `${entries.length} items cut`,
        { description: 'Select a destination folder in Files and press Ctrl+V.' },
      );
    } catch (reason) {
      toast.error('Could not cut item', { description: messageOf(reason) });
    }
  };

  const pasteFileEntries = async (targetDirectory: string) => {
    if (!repository || busy || status?.readOnly) return;
    setBusy('paste-file');
    try {
      const result = await window.justgit.repository.pasteEntries(repository.id, targetDirectory);
      if (result.status === 'empty') {
        toast.info('Clipboard does not contain files or an image');
        return;
      }
      await refresh({ background: true });
      await refreshFileHistoryState();
      const destination = targetDirectory || repository.name;
      toast.success(
        result.source === 'image'
          ? 'Clipboard image pasted'
          : result.source === 'cut'
            ? `${result.created.length} ${result.created.length === 1 ? 'item' : 'items'} moved`
            : `${result.created.length} ${result.created.length === 1 ? 'item' : 'items'} pasted`,
        { description: destination, action: { label: 'Undo', onClick: () => void performFileHistory('undo') } },
      );
    } catch (reason) {
      toast.error('Could not paste item', { description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const moveFileEntries = async (entries: FileTreeEntry[], targetDirectory: string) => {
    if (!repository || busy || status?.readOnly || entries.length === 0) return;
    const active = viewerSelectionRef.current;
    if (active?.type === 'file' && entries.some((entry) => pathContains(entry.path, active.path)) && viewerDirtyRef.current) {
      toast.info('Save the open file before moving it', { description: active.path });
      return;
    }
    setBusy('move-file');
    try {
      const result = await window.justgit.repository.moveEntries(repository.id, entries.map((entry) => entry.path), targetDirectory);
      const moved = result.moved.length;
      const conflicts = result.conflicts.length;
      reconcileViewerPaths(result.moved, []);
      await refresh({ background: true });
      await refreshFileHistoryState();
      if (conflicts > 0) {
        toast.error(conflicts === 1 ? 'An item with that name already exists' : `${conflicts} items already exist in the destination`);
      }
      if (moved > 0) {
        toast.success(moved === 1 ? 'Item moved' : `${moved} items moved`, { description: targetDirectory || repository.name, action: { label: 'Undo', onClick: () => void performFileHistory('undo') } });
      }
    } catch (reason) {
      toast.error('Could not move item', { description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const deleteFileEntries = async (entries: FileTreeEntry[]) => {
    if (!repository || busy || status?.readOnly || entries.length === 0) return;
    setBusy('delete-file');
    try {
      const result = await window.justgit.repository.deleteEntries(repository.id, entries.map((entry) => entry.path));
      if (result.deleted === 0) return;
      const active = viewerSelectionRef.current;
      if (active?.type === 'file' && entries.some((entry) => pathContains(entry.path, active.path))) {
        viewerSelectionRef.current = null;
        setViewerSelection(null);
      }
      await refreshFilesOnly();
      await refreshFileHistoryState();
      toast.success(result.deleted === 1 ? 'Moved to Recycle Bin' : `${result.deleted} items moved to Recycle Bin`, result.recovery === 'undo'
        ? { description: 'Undo available', action: { label: 'Undo', onClick: () => void performFileHistory('undo') } }
        : { description: 'Restore from the Recycle Bin' });
    } catch (reason) {
      toast.error('Could not delete item', { description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const revealFileEntry = async (entry: FileTreeEntry) => {
    if (!repository) return;
    try {
      await window.justgit.repository.revealEntry(repository.id, entry.path);
    } catch (reason) {
      toast.error('Could not reveal item', { description: messageOf(reason) });
    }
  };

  const renameFileEntry = async (entry: FileTreeEntry, newName: string) => {
    if (!repository || busy || status?.readOnly) return;
    const active = viewerSelectionRef.current;
    if (active?.type === 'file' && pathContains(entry.path, active.path) && viewerDirtyRef.current) {
      toast.info('Save the open file before renaming it', { description: active.path });
      return;
    }
    setBusy('rename-file');
    try {
      const result = await window.justgit.repository.renameEntry(repository.id, entry.path, newName);
      if (result.status === 'noop') return;
      if (result.status === 'conflict') {
        toast.error('An item with that name already exists', { description: result.path });
        return;
      }
      if (active?.type === 'file' && pathContains(result.from, active.path)) {
        const suffix = active.path.slice(result.from.length);
        const nextSelection = { type: 'file', path: `${result.to}${suffix}` } as const;
        pendingViewerPathRef.current = nextSelection.path;
        viewerSelectionRef.current = nextSelection;
        setViewerSelection(nextSelection);
        setRefreshVersion((version) => version + 1);
      }
      await refresh({ background: true });
      await refreshFileHistoryState();
      toast.success(entry.type === 'directory' ? 'Folder renamed' : 'File renamed', { description: `${result.from} → ${result.to}`, action: { label: 'Undo', onClick: () => void performFileHistory('undo') } });
    } catch (reason) {
      toast.error('Could not rename item', { description: messageOf(reason), duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const createFileEntry = async (targetDirectory: string, name: string, kind: 'file' | 'directory') => {
    if (!repository || busy || status?.readOnly) return;
    setBusy('create-file');
    try {
      const result = await window.justgit.repository.createEntry(repository.id, targetDirectory, name, kind);
      if (result.status === 'conflict') {
        toast.error('An item with that name already exists', { description: result.path });
        return;
      }
      if (result.kind === 'file') {
        pendingViewerPathRef.current = result.path;
        openFile(result.path);
      }
      await refreshFilesOnly();
      await refreshFileHistoryState();
      toast.success(result.kind === 'directory' ? 'Folder created' : 'File created', { description: result.path, action: { label: 'Undo', onClick: () => void performFileHistory('undo') } });
    } catch (reason) {
      toast.error('Could not create item', { description: messageOf(reason), duration: 10_000 });
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
      if (mode === 'stage') await window.justgit.index.stageAll(repository.id);
      else await window.justgit.index.unstageAll(repository.id);
      await refresh({ background: true });
    } catch (reason) { setStatus(previous); setError(messageOf(reason)); }
    finally { setBusy(null); }
  };

  const createCommit = async (options?: { push?: boolean }) => {
    if (!repository || !status?.stagedCount || !commitMessage.trim()) return;
    setBusy('commit'); setError(null);
    let committed = false;
    try {
      const result = await window.justgit.commits.create(repository.id, commitMessage);
      const subject = commitMessage.split(/\r?\n/, 1)[0] ?? commitMessage;
      setCommitMessage('');
      setViewerSelection({ type: 'commit', oid: result.oid, subject });
      await refresh({ background: true });
      committed = true;
    } catch (reason) { setError(messageOf(reason)); }
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
    await window.justgit.ai.cancelGeneration(active.id).catch(() => undefined);
  };

  const generateCommitMessage = async () => {
    if (!bootstrap || !repository || !status?.stagedCount || status.readOnly || generating) return;
    const harness = bootstrap.preferences.commitMessageHarness;
    const model = bootstrap.preferences.commitMessageModels[harness] ?? 'default';
    const requestId = crypto.randomUUID();
    generationRequest.current = { id: requestId, repositoryId: repository.id };
    setGenerating(requestId);
    try {
      const result = await window.justgit.ai.generateCommitMessage({ repositoryId: repository.id, harness, model, requestId });
      if (generationRequest.current?.id !== requestId || generationRequest.current.repositoryId !== repository.id) return;
      setCommitMessage(result.message);
      toast.success(`Message generated with ${harnessLabel(result.harness)}`, {
        description: result.contextWasTruncated ? 'A truncated version of the staged diff was used.' : undefined,
      });
    } catch (reason) {
      const detail = aiDetail(reason);
      if (detail?.code === 'AI_CANCELLED') {
        toast.info('Generation canceled');
      } else {
        const settingsAction = detail?.code === 'AI_CLI_NOT_FOUND' || detail?.code === 'AI_AUTH_REQUIRED' || detail?.code === 'AI_MODEL_UNAVAILABLE';
        toast.error(aiErrorTitle(detail), {
          description: detail?.message ?? messageOf(reason),
          duration: 10_000,
          ...(settingsAction ? { action: { label: 'Open settings', onClick: openAiSettings } } : {}),
        });
      }
    } finally {
      if (generationRequest.current?.id === requestId) generationRequest.current = null;
      setGenerating((current) => current === requestId ? null : current);
    }
  };

  useEffect(() => {
    const active = generationRequest.current;
    if (active && active.repositoryId !== repository?.id) void window.justgit.ai.cancelGeneration(active.id);
  }, [repository?.id]);

  useEffect(() => () => {
    const active = generationRequest.current;
    if (active) void window.justgit.ai.cancelGeneration(active.id);
  }, []);

  const selectRecent = async (id: string | null) => {
    if (!id || id === repository?.id) return;
    try { recordOpenedRepository(await window.justgit.repository.openRecent(id)); }
    catch (reason) { setError(messageOf(reason)); }
  };

  const switchBranch = async (name: string | null) => {
    if (!repository || !name || name === status?.branch) return;
    setBusy('branch');
    try { await window.justgit.refs.switchBranch(repository.id, name); await refresh({ background: true }); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  };

  const switchWorktree = async (targetPath: string | null) => {
    if (!repository || !targetPath || targetPath === repository.path) return;
    setBusy('worktree');
    try { recordOpenedRepository(await window.justgit.refs.selectWorktree(repository.id, targetPath)); }
    catch (reason) { setError(messageOf(reason)); }
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
      const page = await window.justgit.commits.list(repository.id, nextCursor);
      setCommits((items) => [...(items ?? []), ...page.commits]);
      setNextCursor(page.nextCursor);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  };

  const undoLatestCommit = async () => {
    if (!repository || !undoCommit || undoingCommit) return;
    const selected = undoCommit;
    setUndoingCommit(true);
    try {
      const result = await window.justgit.commits.undoLatest(repository.id, selected.oid);
      if (result.status === 'success') {
        setUndoCommit(null);
        setViewerSelection(null);
        setView('changes');
        if (!commitMessage.trim()) {
          setCommitMessage(result.message);
        } else {
          toast.success('Commit undone', {
            description: 'Its changes are staged again. Your draft was preserved.',
            action: { label: 'Use previous message', onClick: () => setCommitMessage(result.message) },
          });
          await refresh({ background: true });
          window.setTimeout(() => commitTextareaRef.current?.focus(), 0);
          return;
        }
        toast.success('Commit undone', { description: 'Its changes are staged again.' });
        await refresh({ background: true });
        window.setTimeout(() => commitTextareaRef.current?.focus(), 0);
        return;
      }
      setUndoCommit(null);
      const copy = undoBlockedCopy(result);
      toast.error(copy.title, { description: copy.description, duration: 10_000 });
      await refresh({ background: true });
    } catch (reason) {
      toast.error('Could not undo commit', { description: messageOf(reason), duration: 10_000 });
    } finally {
      setUndoingCommit(false);
    }
  };

  const showConflicts = (files: string[]) => {
    setView('changes');
    const first = files[0];
    if (first) setViewerSelection({ type: 'conflict', path: first });
  };

  const resolveConflictFile = async (path: string, content: string): Promise<boolean> => {
    if (!repository || busy) return false;
    setBusy('resolve-conflict');
    setError(null);
    try {
      await window.justgit.index.resolveConflict(repository.id, path, content);
      toast.success('Conflict marked as resolved', { description: path });
      setViewerSelection({ type: 'diff', path, kind: 'staged' });
      await refresh({ background: true });
      return true;
    } catch (reason) {
      const message = messageOf(reason);
      setError(message);
      toast.error('Could not resolve conflict', { description: message, duration: 10_000 });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const updateConflictFile = async (path: string, content: string): Promise<boolean> => {
    if (!repository) return false;
    try {
      await window.justgit.index.updateConflict(repository.id, path, content);
      return true;
    } catch (reason) {
      const message = messageOf(reason);
      setError(message);
      toast.error('Could not apply selection', { description: message, duration: 10_000 });
      return false;
    }
  };

  const pullUpdates = async () => {
    if (!repository || !status || status.behind === 0 || busy) return;
    setBusy('pull');
    setError(null);
    const toastId = toast.loading(`Pulling ${status.behind} ${status.behind === 1 ? 'commit' : 'commits'}…`);
    try {
      const result = await window.justgit.refs.pull(repository.id);
      await refresh({ background: true });
      if (result.status === 'success') {
        toast.success(`${result.commits} ${result.commits === 1 ? 'commit pulled' : 'commits pulled'}`, {
          id: toastId,
          description: result.restoredLocalChanges ? 'Your local changes and staged changes were restored.' : undefined,
        });
      } else if (result.status === 'up-to-date') {
        toast.success('Branch is already up to date', { id: toastId });
      } else if (result.status === 'blocked-conflicts') {
        toast.error('Could not pull changes', {
          id: toastId,
          description: `Resolve ${result.files.length === 1 ? 'the pending conflict' : `${result.files.length} pending conflicts`} before updating.`,
          duration: 10_000,
          action: { label: 'View conflicts', onClick: () => showConflicts(result.files) },
        });
      } else if (result.status === 'stash-conflict') {
        toast.error(result.updated ? 'Update completed with local conflicts' : 'Could not restore local changes', {
          id: toastId,
          description: 'The safety stash was preserved. Resolve the conflicts to continue.',
          duration: Infinity,
          action: { label: 'View conflicts', onClick: () => showConflicts(result.files) },
        });
      } else if (result.status === 'restore-failed') {
        toast.error('Could not automatically restore local changes', {
          id: toastId,
          description: result.recoveredChanges
            ? 'Some changes are visible and the safety stash was preserved. Do not continue until you review them.'
            : 'The worktree is still clean and the safety stash remains intact.',
          duration: Infinity,
        });
      } else if (result.status === 'diverged') {
        toast.error('Branch has diverged', {
          id: toastId,
          description: `${result.ahead} ahead and ${result.behind} behind. Choose rebase or merge before continuing.`,
          duration: 10_000,
        });
      } else if (result.status === 'no-upstream') {
        toast.error('Branch has no upstream configured', { id: toastId, duration: 10_000 });
      } else {
        toast.error('A Git operation is in progress', {
          id: toastId,
          description: `Finish or cancel ${result.operation} before updating.`,
          duration: 10_000,
        });
      }
    } catch (reason) {
      const message = messageOf(reason);
      setError(message);
      toast.error('Could not pull changes', { id: toastId, description: message, duration: 10_000 });
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
    setBusy('push');
    setError(null);
    const toastId = toast.loading('Pushing commits…');
    try {
      const result = await window.justgit.refs.push(repository.id);
      await refresh({ background: true });
      if (result.status === 'success') {
        toast.success(`${result.commits} ${result.commits === 1 ? 'commit pushed' : 'commits pushed'}`, { id: toastId });
      } else if (result.status === 'up-to-date') {
        toast.success('No commits pending push', { id: toastId });
      } else if (result.status === 'blocked-conflicts') {
        toast.error('Could not push commits', {
          id: toastId,
          description: `Resolve ${result.files.length === 1 ? 'the pending conflict' : `${result.files.length} pending conflicts`} before continuing.`,
          duration: 10_000,
          action: { label: 'View conflicts', onClick: () => showConflicts(result.files) },
        });
      } else if (result.status === 'blocked-operation') {
        toast.error('A Git operation is in progress', {
          id: toastId,
          description: `Finish or cancel ${result.operation} before pushing.`,
          duration: 10_000,
        });
      } else if (result.status === 'no-upstream') {
        toast.error('Branch has no upstream configured', {
          id: toastId,
          description: 'Configure a remote branch before pushing.',
          duration: 10_000,
        });
      } else if (result.status === 'diverged') {
        toast.error('The remote contains new changes', {
          id: toastId,
          description: `${result.ahead} ahead and ${result.behind} behind. Pull and resolve the changes before pushing.`,
          duration: 10_000,
        });
      } else {
        toast.error('Could not push commits', {
          id: toastId,
          description: result.message,
          duration: 10_000,
        });
      }
    } catch (reason) {
      const message = messageOf(reason);
      setError(message);
      toast.error('Could not push commits', { id: toastId, description: message, duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  if (!bootstrap) return <div className="splash"><IconLoader4 className="spinner" /><span>Loading JustGit…</span></div>;
  if (!repository) return <Welcome recent={bootstrap.recentRepositories} onOpen={openRepository} onRecent={(id) => void selectRecent(id)} error={error} />;

  const conflicts = status?.changes.filter((change) => change.conflict) ?? [];
  const staged = status?.changes.filter((change) => change.staged && !change.conflict) ?? [];
  const changed = status?.changes.filter((change) => change.unstaged && !change.conflict) ?? [];
  const conflictFiles = conflicts.map((change) => change.path);

  return (
    <TooltipProvider>
      <Toaster theme={theme} richColors closeButton position="bottom-right" />
      <QuickOpenDialog
        open={quickOpen}
        files={files}
        includeIgnored={bootstrap.preferences.showDotEnvFiles}
        activePath={viewerSelection?.type === 'file' ? viewerSelection.path : null}
        onOpenChange={setQuickOpen}
        onOpenFile={openFile}
      />
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
      <CreatePullRequestDialog
        open={createPrOpen}
        onOpenChange={setCreatePrOpen}
        repositoryId={repository.id}
        branches={branches}
        status={status}
        preferences={bootstrap.preferences}
        pushBusy={busy === 'push'}
        onPush={() => void pushUpdates()}
        onCreated={(prNumber) => {
          setCreatePrOpen(false);
          void loadPulls();
          if (prNumber !== null) selectViewer({ type: 'pull-request', number: prNumber });
        }}
      />
      <div className="app-shell">
        <Toolbar
          repository={repository}
          recent={bootstrap.recentRepositories}
          repositoryProjects={bootstrap.repositoryProjects}
          status={status}
          branches={branches}
          worktrees={worktrees}
          preferences={bootstrap.preferences}
          busy={busy}
          onOpen={openRepository}
          onRecent={selectRecent}
          onBranch={switchBranch}
          onWorktree={switchWorktree}
          onRefresh={() => void refresh()}
          onPull={() => void pullUpdates()}
          onPush={() => void pushUpdates()}
          onPreference={(partial) => void updatePreference(partial)}
          onOrganizationChange={(organization) => setBootstrap((current) => current ? { ...current, ...organization } : current)}
          onRefsManaged={handleRefsManaged}
          settingsOpen={settingsOpen}
          settingsSection={settingsSection}
          onSettingsOpen={setSettingsOpen}
          onSettingsSection={setSettingsSection}
        />
        {status?.readOnly && <div className="operation-banner">Repository is read-only: {status.operation} is in progress.</div>}
        {conflictFiles.length > 0 && (
          <div className="conflict-banner">
            <span>{conflictFiles.length === 1 ? 'There is 1 pending conflict.' : `There are ${conflictFiles.length} pending conflicts.`}</span>
            <Button variant="ghost" size="xs" onClick={() => showConflicts(conflictFiles)}>View conflicts</Button>
          </div>
        )}
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)} aria-label="Close">×</button></div>}
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
                  {item === 'changes' ? <IconGitCompare /> : item === 'files' ? <IconFiles /> : item === 'history' ? <IconHistory /> : <IconGitPullRequest />}
                  <span className="sidebar-tab-label">{item === 'changes' ? 'Changes' : item === 'files' ? 'Files' : item === 'history' ? 'History' : 'PRs'}</span>
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
                  diffView={diffView}
                  onDiffView={(value) => void updatePreference({ diffView: value })}
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
              <FilesView
                   key={repository.id}
                   active={view === 'files'}
                   initialExpandedPaths={filesTreeStates.get(repository.id) ?? []}
                   files={files}
                  filesSnapshotRevision={filesSnapshotRevision}
                  showDotEnvFiles={bootstrap.preferences.showDotEnvFiles}
                  activePath={viewerSelection?.type === 'file' ? viewerSelection.path : null}
                  readOnly={Boolean(status?.readOnly || busy)}
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
              {view === 'history' && (
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
              )}
              {view === 'prs' && (
                <PullRequestsView
                  info={githubInfo}
                  ghStatus={ghStatus}
                  pulls={pulls}
                  loading={pullsLoading}
                  error={pullsError}
                  activeNumber={viewerSelection?.type === 'pull-request' ? viewerSelection.number : null}
                  createDisabledReason={!status
                    ? 'Loading repository status…'
                    : status.detached || status.unborn || !status.branch
                      ? 'Check out a branch first'
                      : null}
                  onRefresh={() => void loadPulls(true)}
                  onSelect={(pr) => { selectViewer({ type: 'pull-request', number: pr.number }); }}
                  onCreate={() => setCreatePrOpen(true)}
                  onCopyCommand={(command) => {
                    void window.justgit.clipboard.writeText(command)
                      .then(() => toast.success('Command copied', { description: command }))
                      .catch(() => toast.error('Could not copy the command'));
                  }}
                />
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
                  onSelect={selectViewer}
                  onDiffViewChange={(value) => void updatePreference({ diffView: value })}
                  onWrapLinesChange={(value) => void updatePreference({ wrapLines: value })}
                  onDirtyChange={handleViewerDirtyChange}
                  onUpdateConflict={updateConflictFile}
                  onResolveConflict={resolveConflictFile}
                />
              </Suspense>
            </ErrorBoundary>
          </section>
        </main>
        <CommitComposer
          open={view === 'changes' && Boolean(status?.stagedCount)}
          stagedCount={status?.stagedCount ?? 0}
          message={commitMessage}
          generating={Boolean(generating)}
          harness={harnessLabel(bootstrap.preferences.commitMessageHarness)}
          busy={busy}
          readOnly={Boolean(status?.readOnly)}
          canPush={Boolean(status?.upstream)}
          textareaRef={commitTextareaRef}
          onMessage={setCommitMessage}
          onGenerate={() => void generateCommitMessage()}
          onCancelGenerate={() => void cancelCommitMessageGeneration()}
          onCommit={(options) => void createCommit(options)}
        />
      </div>
    </TooltipProvider>
  );
}

interface ToolbarProps {
  repository: RepositoryInfo; recent: BootstrapData['recentRepositories']; repositoryProjects: RepositoryProject[]; status: RepositoryStatus | null;
  branches: BranchInfo[]; worktrees: WorktreeInfo[]; preferences: Preferences; busy: string | null;
  onOpen(): void; onRecent(id: string | null): void; onBranch(name: string | null): void; onWorktree(path: string | null): void;
  onRefresh(): void; onPreference(partial: Partial<Preferences>): void;
  onOrganizationChange(organization: RepositoryOrganization): void;
  onRefsManaged(recentRepositories: RecentRepository[] | null): void;
  onPull(): void; onPush(): void;
  settingsOpen: boolean; settingsSection: SettingsSection;
  onSettingsOpen(open: boolean): void; onSettingsSection(section: SettingsSection): void;
}

const MANAGE_PROJECTS_VALUE = '__justgit_manage_projects__';
// A sentinel that can never equal a filesystem path, so it cannot collide with
// a real worktree even on a repository with unusual directory names.
const MANAGE_WORKTREES_VALUE = '\0__justgit_manage_worktrees__';

function Toolbar(props: ToolbarProps) {
  const { onRecent } = props;
  const [repositorySelectOpen, setRepositorySelectOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);
  const [refsTab, setRefsTab] = useState<LocalRefsTab>('branches');
  const repositoryNumberBuffer = useRef('');
  const repositoryNumberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A pending delete/remove must not race a switcher action.
  const [refsBusy, setRefsBusy] = useState(false);
  const openRefsManager = (tab: LocalRefsTab) => { setRefsTab(tab); setRefsOpen(true); };
  const currentWorktree = props.worktrees.find((item) => samePath(item.path, props.repository.path));
  const picker = useMemo(() => buildRepositoryPickerModel(props.recent, props.repositoryProjects), [props.recent, props.repositoryProjects]);
  const visibleRepositories = useMemo(() => getRepositoryPickerDisplayOrder(picker), [picker]);
  const repositoryIndex = useMemo(
    () => new Map(visibleRepositories.map((repository, index) => [repository.key, index + 1])),
    [visibleRepositories],
  );
  const currentRepositoryKey = normalizeRepositoryKey(props.repository.commonDir);

  const clearRepositoryNumberShortcut = useCallback(() => {
    repositoryNumberBuffer.current = '';
    if (repositoryNumberTimer.current !== null) {
      clearTimeout(repositoryNumberTimer.current);
      repositoryNumberTimer.current = null;
    }
  }, []);

  const selectRepositoryAt = useCallback((oneBasedIndex: number) => {
    const repository = visibleRepositories[oneBasedIndex - 1];
    if (!repository) return false;
    clearRepositoryNumberShortcut();
    setRepositorySelectOpen(false);
    onRecent(repository.recent.id);
    return true;
  }, [clearRepositoryNumberShortcut, onRecent, visibleRepositories]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isEditableTarget(event.target)) return;

      if (!repositorySelectOpen && event.key.toLowerCase() === 'q') {
        const anotherPopupIsOpen = document.querySelector(
          '[data-slot="dialog-popup"][data-open], [data-slot="select-content"][data-open], [data-slot="combobox-content"][data-open]',
        );
        if (projectsOpen || refsOpen || props.settingsOpen || anotherPopupIsOpen) return;
        event.preventDefault();
        setRepositorySelectOpen(true);
        return;
      }

      if (!repositorySelectOpen) return;
      // The same key that opened the switcher closes it again.
      if (event.key.toLowerCase() === 'q') {
        event.preventDefault();
        event.stopPropagation();
        clearRepositoryNumberShortcut();
        setRepositorySelectOpen(false);
        return;
      }
      if (event.key === 'Enter' && repositoryNumberBuffer.current) {
        event.preventDefault();
        event.stopPropagation();
        selectRepositoryAt(Number(repositoryNumberBuffer.current));
        return;
      }
      if (!/^\d$/.test(event.key)) return;

      event.preventDefault();
      event.stopPropagation();
      const availableIndices = visibleRepositories.map((_, index) => String(index + 1));
      let nextBuffer = repositoryNumberBuffer.current + event.key;
      if (!availableIndices.some((index) => index.startsWith(nextBuffer))) nextBuffer = event.key;
      if (!availableIndices.some((index) => index.startsWith(nextBuffer))) {
        clearRepositoryNumberShortcut();
        return;
      }

      repositoryNumberBuffer.current = nextBuffer;
      if (repositoryNumberTimer.current !== null) clearTimeout(repositoryNumberTimer.current);
      const exactMatch = availableIndices.includes(nextBuffer);
      const hasLongerMatch = availableIndices.some((index) => index !== nextBuffer && index.startsWith(nextBuffer));
      if (exactMatch && !hasLongerMatch) {
        selectRepositoryAt(Number(nextBuffer));
      } else if (exactMatch) {
        repositoryNumberTimer.current = setTimeout(() => selectRepositoryAt(Number(nextBuffer)), 650);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearRepositoryNumberShortcut();
    };
  }, [clearRepositoryNumberShortcut, projectsOpen, props.settingsOpen, refsOpen, repositorySelectOpen, selectRepositoryAt, visibleRepositories]);

  // The row already shows the tail of the path, so no hover tooltip repeats it.
  const repositoryItem = (group: RepositoryOption) => (
    <SelectItem key={group.key} value={group.key} className="repo-select-item">
      <IconFolder className="repo-select-item-icon" />
      <span className="repo-select-item-copy">
        <strong>{group.name}</strong>
        <small>{shortenRepositoryPath(group.rootPath)}</small>
      </span>
      <Kbd className="repo-select-index">{repositoryIndex.get(group.key)}</Kbd>
    </SelectItem>
  );
  return (
    <header className="toolbar">
      <div className="toolbar-brand" aria-label="JustGit">
        <IconGitBranch aria-hidden="true" />
        <span>JustGit</span>
      </div>
      <Select open={repositorySelectOpen} onOpenChange={(open) => {
        setRepositorySelectOpen(open);
        if (!open) clearRepositoryNumberShortcut();
      }} value={currentRepositoryKey} onValueChange={(key) => {
        if (key === MANAGE_PROJECTS_VALUE) { setProjectsOpen(true); return; }
        onRecent(picker.repositories.find((group) => group.key === key)?.recent.id ?? null);
      }}>
        <SelectTrigger
          className="repo-select max-w-[240px]"
          aria-label="Select project or repository"
          aria-keyshortcuts="Q"
        >
          <IconFolderOpen />
          <SelectValue>{props.repository.repositoryName}</SelectValue>
          <Kbd className="repo-select-shortcut" aria-hidden="true">Q</Kbd>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="w-max max-w-[min(380px,calc(100vw-24px))] p-1">
          {picker.projectSections.map((section) => (
            <SelectGroup key={section.id} className="repo-select-group p-0">
              <SelectLabel className="repo-select-label"><IconFolder aria-hidden="true" /><span>{section.name}</span></SelectLabel>
              {section.repositories.map(repositoryItem)}
            </SelectGroup>
          ))}
          {picker.unassigned.length > 0 && (
            <SelectGroup className="repo-select-group p-0">
              <SelectLabel className="repo-select-label plain"><span>Repositories</span></SelectLabel>
              {picker.unassigned.map(repositoryItem)}
            </SelectGroup>
          )}
          <SelectItem value={MANAGE_PROJECTS_VALUE} className="repo-select-manage"><IconSettings /><span>Manage projects…</span></SelectItem>
        </SelectContent>
      </Select>
      <RepositoryProjectsDialog open={projectsOpen} onOpenChange={setProjectsOpen} projects={props.repositoryProjects} repositories={picker.repositories} onOrganizationChange={props.onOrganizationChange} />
      <Button variant="outline" size="sm" onClick={props.onOpen}>Open…</Button>
      <div className="toolbar-spacer" />
      {props.status && (props.status.ahead > 0 || props.status.behind > 0 || props.status.insertions > 0 || props.status.deletions > 0 || props.busy === 'push' || props.busy === 'pull') && (
        <div className="branch-stats" aria-label="Branch and local changes summary">
          {(props.status.behind > 0 || props.busy === 'pull') && (
            <Tooltip>
              <TooltipTrigger render={<button className="branch-sync" disabled={Boolean(props.busy)} onClick={props.onPull} aria-label={`Pull ${props.status.behind} commits`} />}>
                {props.busy === 'pull' ? <IconLoader4 className="animate-spin" /> : <span>↓{props.status.behind}</span>}
              </TooltipTrigger>
              <TooltipContent>{props.busy === 'pull' ? 'Pulling changes…' : `Pull ${props.status.behind} ${props.status.behind === 1 ? 'commit' : 'commits'}`}</TooltipContent>
            </Tooltip>
          )}
          {(props.status.ahead > 0 || props.busy === 'push') && (
            <Tooltip>
              <TooltipTrigger render={<button className="branch-push" disabled={Boolean(props.busy)} onClick={props.onPush} aria-label={`Push ${props.status.ahead} commits`} />}>
                {props.busy === 'push' ? <IconLoader4 className="animate-spin" /> : <span>↑{props.status.ahead}</span>}
              </TooltipTrigger>
              <TooltipContent>{props.busy === 'push' ? 'Pushing commits…' : `Push ${props.status.ahead} ${props.status.ahead === 1 ? 'commit' : 'commits'}`}</TooltipContent>
            </Tooltip>
          )}
          {(props.status.insertions > 0 || props.status.deletions > 0) && (
            <Tooltip>
              <TooltipTrigger render={<span className="line-stats" />}>
                <strong className="line-additions">+{props.status.insertions}</strong>
                <span>/</span>
                <strong className="line-deletions">-{props.status.deletions}</strong>
              </TooltipTrigger>
              <TooltipContent>Lines added and removed in the worktree</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      <Select value={currentWorktree?.path ?? props.repository.path} onValueChange={(value) => {
        if (value === MANAGE_WORKTREES_VALUE) { openRefsManager('worktrees'); return; }
        props.onWorktree(value);
      }} disabled={refsBusy}>
        <SelectTrigger size="sm" className="max-w-[190px]"><IconHierarchy2 /><SelectValue>{currentWorktree?.path.split(/[\\/]/).pop() ?? props.repository.name}</SelectValue></SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false} className="w-max max-w-[min(280px,calc(100vw-24px))]">
          {props.worktrees.map((item) => <SelectItem key={item.path} value={item.path} disabled={Boolean(item.locked || item.prunable || item.bare)}><span className="min-w-0 flex-1 truncate">{item.path.split(/[\\/]/).pop()} {item.branch ? `· ${item.branch}` : '· detached'}</span></SelectItem>)}
          <SelectItem value={MANAGE_WORKTREES_VALUE} className="repo-select-manage"><IconSettings /><span>Manage worktrees…</span></SelectItem>
        </SelectContent>
      </Select>
      <BranchCombobox
        branches={props.branches}
        currentLabel={props.status?.branch ?? 'Detached HEAD'}
        disabled={props.status?.readOnly || refsBusy}
        onBranch={props.onBranch}
        onManage={() => openRefsManager('branches')}
      />
      <LocalRefsDialog
        open={refsOpen}
        tab={refsTab}
        repositoryId={props.repository.id}
        onOpenChange={setRefsOpen}
        onTabChange={setRefsTab}
        onOpenWorktree={(path) => { setRefsOpen(false); props.onWorktree(path); }}
        onMutated={props.onRefsManaged}
        onBusyChange={setRefsBusy}
      />
      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={props.onRefresh} disabled={props.busy === 'refresh'} />}>{props.busy === 'refresh' ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}</TooltipTrigger><TooltipContent>Refresh (Ctrl+R)</TooltipContent></Tooltip>
      <SettingsDialog
        preferences={props.preferences}
        onPreference={props.onPreference}
        open={props.settingsOpen}
        onOpenChange={props.onSettingsOpen}
        section={props.settingsSection}
        onSectionChange={props.onSettingsSection}
      />
    </header>
  );
}

interface BranchItem { value: string; label: string; search: string; disabled: boolean; hint?: string | undefined }
const BRANCH_GROUP_LIMIT = 5;

function BranchCombobox({ branches, currentLabel, disabled, onBranch, onManage }: {
  branches: BranchInfo[]; currentLabel: string; disabled?: boolean | undefined; onBranch(name: string | null): void; onManage(): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState({ local: BRANCH_GROUP_LIMIT, remote: BRANCH_GROUP_LIMIT });
  const resetView = () => setVisible({ local: BRANCH_GROUP_LIMIT, remote: BRANCH_GROUP_LIMIT });

  const { items, locals, remotes, currentValue } = useMemo(() => {
    const locals: BranchItem[] = [];
    const remotes: BranchItem[] = [];
    let currentValue = '';
    for (const branch of branches) {
      if (branch.remote) {
        if (branch.fullName.endsWith('/HEAD')) continue;
        remotes.push({ value: branch.fullName, label: branch.name, search: (branch.name + " " + branch.fullName).toLowerCase(), disabled: false });
      } else {
        if (branch.current) currentValue = branch.fullName;
        const otherWorktree = Boolean(branch.worktreePath && !branch.current);
        locals.push({ value: branch.fullName, label: branch.name, search: (branch.name + " " + branch.fullName).toLowerCase(), disabled: otherWorktree, hint: otherWorktree ? 'another worktree' : undefined });
      }
    }
    // Keep the checked-out branch at the top so it stays visible within the cap.
    locals.sort((a, b) => (a.value === currentValue ? -1 : b.value === currentValue ? 1 : 0));
    return { items: [...locals, ...remotes], locals, remotes, currentValue };
  }, [branches]);

  const capGroup = (list: BranchItem[], count: number) => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? list.filter((item) => item.label.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle))
      : list;
    return { shown: matched.slice(0, count), hidden: Math.max(0, matched.length - count) };
  };

  const localView = capGroup(locals, visible.local);
  const remoteView = capGroup(remotes, visible.remote);
  const noResults = localView.shown.length === 0 && remoteView.shown.length === 0;
  const selectedItem = items.find((item) => item.value === currentValue) ?? null;

  return (
    <Combobox
      items={items}
      value={selectedItem}
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) { setQuery(''); resetView(); } }}
      inputValue={query}
      onInputValueChange={(value) => { setQuery(value); resetView(); }}
      filter={null}
      disabled={disabled}
      itemToStringLabel={(item: BranchItem | null) => item?.label ?? ''}
      itemToStringValue={(item: BranchItem | null) => item?.value ?? ''}
      isItemEqualToValue={(a: BranchItem | null, b: BranchItem | null) => a?.value === b?.value}
      onValueChange={(item: BranchItem | null) => { if (item && item.value !== currentValue) onBranch(item.value); }}
    >
      <ComboboxTrigger size="sm" className="max-w-[220px]">
        <IconGitBranch />
        <span className="block min-w-0 flex-1 overflow-hidden text-left text-ellipsis whitespace-nowrap">{currentLabel}</span>
      </ComboboxTrigger>
      <ComboboxContent align="end" className="w-[min(300px,calc(100vw-24px))] max-w-[calc(100vw-24px)]">
        <ComboboxInput placeholder="Search branches…" />
        {noResults ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</div>
        ) : (
          <ComboboxList>
            {localView.shown.length > 0 && (
              <ComboboxGroup>
                <ComboboxGroupLabel>Local</ComboboxGroupLabel>
                {localView.shown.map((item) => (
                  <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.hint && <small className="shrink-0 text-muted-foreground">· {item.hint}</small>}
                  </ComboboxItem>
                ))}
                {localView.hidden > 0 && <BranchMoreRow count={localView.hidden} onClick={() => setVisible((v) => ({ ...v, local: v.local + BRANCH_GROUP_LIMIT }))} />}
              </ComboboxGroup>
            )}
            {remoteView.shown.length > 0 && (
              <ComboboxGroup>
                <ComboboxGroupLabel>Remote</ComboboxGroupLabel>
                {remoteView.shown.map((item) => (
                  <ComboboxItem key={item.value} value={item}>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </ComboboxItem>
                ))}
                {remoteView.hidden > 0 && <BranchMoreRow count={remoteView.hidden} onClick={() => setVisible((v) => ({ ...v, remote: v.remote + BRANCH_GROUP_LIMIT }))} />}
              </ComboboxGroup>
            )}
          </ComboboxList>
        )}
        <button
          type="button"
          className="branch-combobox-manage"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { setOpen(false); onManage(); }}
        >
          <IconSettings /> Manage local branches…
        </button>
      </ComboboxContent>
    </Combobox>
  );
}

function BranchMoreRow({ count, onClick }: { count: number; onClick(): void }) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <IconChevronDown className="size-3.5" /> Show {count} more {count === 1 ? 'branch' : 'branches'}
    </button>
  );
}

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: IconSettings },
  { id: 'ai', label: 'AI commit messages', icon: IconSparkles },
] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof IconSun }[] = [
  { value: 'system', label: 'System', icon: IconDeviceDesktop },
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
];

function SettingsDialog({ preferences, onPreference, open, onOpenChange, section, onSectionChange }: {
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
}) {
  const [statuses, setStatuses] = useState<AiHarnessStatus[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);

  const loadStatuses = useCallback(async (forceRefresh = false) => {
    setLoadingStatuses(true);
    try { setStatuses(await window.justgit.ai.statuses(forceRefresh)); }
    catch (reason) { toast.error('Could not check local AI', { description: messageOf(reason) }); }
    finally { setLoadingStatuses(false); }
  }, []);

  useEffect(() => {
    if (open && section === 'ai' && statuses.length === 0) void loadStatuses();
  }, [loadStatuses, open, section, statuses.length]);

  const selectedHarness = preferences.commitMessageHarness;
  const selectedStatus = statuses.find((status) => status.id === selectedHarness);
  const selectedModel = preferences.commitMessageModels[selectedHarness] ?? 'default';
  const modelOptions = selectedStatus?.models ?? [{ id: 'default', label: 'Default (CLI)' }];
  const visibleModels = modelOptions.some((model) => model.id === selectedModel)
    ? modelOptions
    : [...modelOptions, { id: selectedModel, label: `${selectedModel} (unavailable)` }];
  const title = section === 'general' ? 'General' : 'AI commit messages';
  const description = section === 'general' ? 'JustGit appearance and behavior.' : 'Local harness and model used to suggest messages.';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger render={<DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Settings" />} />}><IconSettings /></TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      <DialogPopup className="settings-dialog">
        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title">Settings</div>
            {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`settings-nav-item ${section === id ? 'active' : ''}`} onClick={() => onSectionChange(id)} aria-current={section === id}>
                <Icon /> {label}
              </button>
            ))}
          </aside>
          <section className="settings-panel">
            <header className="settings-panel-header">
              <div>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </div>
              <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close settings" />}><IconX /></DialogClose>
            </header>
            <div className="settings-panel-body">
              {section === 'general' ? <>
              <div className="settings-field">
                <div className="settings-field-label">
                  <strong>Theme</strong>
                  <span>Choose a light, dark, or system appearance.</span>
                </div>
                <div className="settings-theme-options" role="radiogroup" aria-label="Theme">
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" role="radio" aria-checked={preferences.theme === value} className={`settings-theme-option ${preferences.theme === value ? 'active' : ''}`} onClick={() => onPreference({ theme: value })}>
                      <Icon /> <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field settings-field-separated">
                <div className="settings-field-label">
                  <strong>Interface size</strong>
                  <span>Adjust the zoom for text, icons, and the rest of the application.</span>
                </div>
                <div className="settings-zoom-control">
                  <input type="range" min="80" max="130" step="10" value={preferences.uiZoom} onChange={(event) => onPreference({ uiZoom: Number(event.target.value) })} aria-label="Interface zoom" />
                  <output>{preferences.uiZoom}%</output>
                </div>
              </div>
              <div className="settings-field settings-field-separated settings-toggle-row">
                <div className="settings-field-label">
                  <strong>Wrap lines in viewer</strong>
                  <span>Wrap long lines to fit the available width.</span>
                </div>
                <button type="button" role="switch" aria-label="Wrap lines in viewer" aria-checked={preferences.wrapLines} className="settings-switch" onClick={() => onPreference({ wrapLines: !preferences.wrapLines })}><span /></button>
              </div>
              <div className="settings-field settings-field-separated settings-toggle-row">
                <div className="settings-field-label">
                  <strong>Show files ignored by Git</strong>
                  <span>Include files excluded by <code>.gitignore</code> rules in the Files view.</span>
                </div>
                <button type="button" role="switch" aria-label="Show files ignored by Git" aria-checked={preferences.showDotEnvFiles} className="settings-switch" onClick={() => onPreference({ showDotEnvFiles: !preferences.showDotEnvFiles })}><span /></button>
              </div>
              </> : <>
                <div className="ai-settings-heading">
                  <div className="settings-field-label">
                    <strong>Harness local</strong>
                    <span>JustGit uses the selected CLI session. It does not copy or store credentials.</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void loadStatuses(true)} disabled={loadingStatuses}>
                    {loadingStatuses ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} {loadingStatuses ? <ShimmeringText text="Checking…" /> : 'Check again'}
                  </Button>
                </div>
                <div className="ai-harness-list" role="radiogroup" aria-label="Harness for commit messages">
                  {(['codex', 'claude', 'opencode'] as const).map((harness) => {
                    const harnessStatus = statuses.find((status) => status.id === harness);
                    const selected = selectedHarness === harness;
                    return (
                      <button key={harness} type="button" role="radio" aria-checked={selected} className={`ai-harness-card ${selected ? 'active' : ''}`} onClick={() => onPreference({ commitMessageHarness: harness })}>
                        <span className="ai-harness-card-main">
                          <strong>{harnessLabel(harness)}</strong>
                          <small>{harnessStatus?.version || (loadingStatuses ? 'Checking…' : 'Status not checked')}</small>
                        </span>
                        <Badge variant={availabilityBadgeVariant(harnessStatus)} className={`ai-status-badge ${harnessStatus?.availability ?? 'unknown'}`}>
                          {availabilityLabel(harnessStatus)}
                        </Badge>
                        {harnessStatus?.message && <span className="ai-harness-message">{harnessStatus.message}</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="settings-field settings-field-separated">
                  <div className="settings-field-label">
                    <strong>Modelo de {harnessLabel(selectedHarness)}</strong>
                    <span>Default lets the CLI choose. JustGit remembers a separate selection for each harness.</span>
                  </div>
                  <Select value={selectedModel} onValueChange={(model) => onPreference({ commitMessageModels: { ...preferences.commitMessageModels, [selectedHarness]: model } })}>
                    <SelectTrigger className="ai-model-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{visibleModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {selectedStatus?.authStatus === 'unauthenticated' && <p className="ai-login-hint">Sign in from a terminal with <code>{loginCommand(selectedHarness)}</code> and check again.</p>}
                  {selectedStatus && !selectedStatus.installed && <p className="ai-login-hint">Install {harnessLabel(selectedHarness)} and check its availability again.</p>}
                </div>
                <p className="ai-privacy-note">Only the truncated staged diff, its summary, the branch, and recent subjects are sent to the selected harness. The generated message always remains pending your review.</p>
              </>}
            </div>
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

interface SegmentedOption<T extends string> { value: T; icon: ReactNode; label: string; tip: string }

function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange(value: T): void; options: SegmentedOption<T>[]; label: string;
}) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      style={{ '--seg-count': options.length, '--seg-index': activeIndex } as CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={
              <button
                type="button"
                role="radio"
                aria-checked={active}
                className={`segmented-option ${active ? 'active' : ''}`}
                onClick={() => onChange(option.value)}
              />
            }>
              {option.icon}
              <span>{option.label}</span>
            </TooltipTrigger>
            <TooltipContent>{option.tip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

interface ChangesViewProps {
  conflicts: FileChange[]; staged: FileChange[]; changed: FileChange[]; readOnly: boolean;
  diffView: DiffViewPreference; onDiffView(value: DiffViewPreference): void;
  onSelect(path: string, kind: 'staged' | 'unstaged'): void; onOpenFile(path: string): void; onDiscard(paths: string[]): void;
  onConflict(path: string): void;
  onStage(paths: string[]): void; onUnstage(paths: string[]): void; onStageAll(): void; onUnstageAll(): void;
}

function ChangesView(props: ChangesViewProps) {
  const [displayMode, setDisplayMode] = useState<'list' | 'tree'>('tree');
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className="changes-view">
      <div className="changes-view-toolbar">
        <Segmented<'list' | 'tree'>
          label="Change layout"
          value={displayMode}
          onChange={setDisplayMode}
          options={[
            { value: 'tree', icon: <IconHierarchy2 />, label: 'Tree', tip: 'Group by folders' },
            { value: 'list', icon: <IconList />, label: 'List', tip: 'Flat file list' },
          ]}
        />
        <Segmented<DiffViewPreference>
          label="Diff view"
          value={props.diffView}
          onChange={props.onDiffView}
          options={[
            { value: 'unified', icon: <IconLayoutRows />, label: 'Unified', tip: 'Diff in one column' },
            { value: 'split', icon: <IconLayoutColumns />, label: 'Split', tip: 'Side-by-side diff' },
          ]}
        />
      </div>
      <div ref={scrollRef} className="changes-scroll">
        <ConflictSection scrollRef={scrollRef} changes={props.conflicts} onSelect={props.onConflict} onOpenFile={props.onOpenFile} />
        <ChangeSection scrollRef={scrollRef} displayMode={displayMode} title="Staged Changes" changes={props.staged} onSelect={(path) => props.onSelect(path, 'staged')} onOpenFile={props.onOpenFile} action="unstage" disabled={props.readOnly} onAction={props.onUnstage} onDiscard={props.onDiscard} onAll={props.onUnstageAll} />
        <ChangeSection scrollRef={scrollRef} displayMode={displayMode} title="Changes" changes={props.changed} onSelect={(path) => props.onSelect(path, 'unstaged')} onOpenFile={props.onOpenFile} action="stage" disabled={props.readOnly} onAction={props.onStage} onDiscard={props.onDiscard} onAll={props.onStageAll} />
      </div>
    </div>
  );
}

function ConflictSection({ scrollRef, changes, onSelect, onOpenFile }: { scrollRef: React.RefObject<HTMLDivElement | null>; changes: FileChange[]; onSelect(path: string): void; onOpenFile(path: string): void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const sortedChanges = useMemo(() => [...changes].sort((a, b) => a.path.localeCompare(b.path)), [changes]);
  const scrollMargin = useVirtualScrollMargin(listRef, scrollRef);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: sortedChanges.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    getItemKey: (index) => sortedChanges[index]?.path ?? index,
    scrollMargin,
    overscan: 8,
  });
  if (changes.length === 0) return null;
  return (
    <section className="change-section conflict-section">
      <div className="section-heading"><span>Conflicts</span><Badge variant="destructive">{changes.length}</Badge></div>
      <div ref={listRef} role="list" aria-label="Conflicts" className="change-list virtual-list" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div key={virtualRow.key} className="virtual-row" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start - scrollMargin}px)` }}>
            <ConflictRow change={sortedChanges[virtualRow.index]!} onSelect={onSelect} onOpenFile={onOpenFile} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ConflictRow({ change, onSelect, onOpenFile }: { change: FileChange; onSelect(path: string): void; onOpenFile(path: string): void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const normalized = change.path.replace(/[\\/]+$/, '');
  const slash = normalized.lastIndexOf('/');
  const name = slash < 0 ? normalized : normalized.slice(slash + 1);
  const directory = slash < 0 ? '' : normalized.slice(0, slash);
  return (
    <div ref={rowRef} role="listitem" className="change-row conflict-row">
      <Tooltip>
        <TooltipTrigger render={<button className="file-label" onClick={() => onSelect(change.path)} aria-label={`Resolve conflict in ${change.path}`} />}>
          <VsCodeTreeIcon path={normalized} type="file" />
          <span className="change-file-text"><span>{name}</span>{directory && <small>{directory}</small>}</span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>Resolve {change.path}</TooltipContent>
      </Tooltip>
      <span className="change-row-actions">
        <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => onOpenFile(change.path)} aria-label="Open file" />}><IconFileArrowRight /></TooltipTrigger><TooltipContent>Open file</TooltipContent></Tooltip>
      </span>
      <span className="status-code conflict">C</span>
    </div>
  );
}

interface ChangeSectionProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  displayMode: 'list' | 'tree'; title: string; changes: FileChange[]; disabled: boolean; action: 'stage' | 'unstage';
  onSelect(path: string): void; onOpenFile(path: string): void; onAction(paths: string[]): void; onDiscard(paths: string[]): void; onAll(): void;
}

function ChangeSection({ scrollRef, displayMode, title, changes, disabled, action, onSelect, onOpenFile, onAction, onDiscard, onAll }: ChangeSectionProps) {
  const tree = useMemo(() => buildChangeTree(changes), [changes]);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const sortedChanges = useMemo(() => [...changes].sort((a, b) => a.path.localeCompare(b.path)), [changes]);
  const treeRows = useMemo(() => flattenChangeTree(tree, collapsedPaths), [collapsedPaths, tree]);
  const rows: ChangeVirtualRow[] = displayMode === 'list'
    ? sortedChanges.map((change) => ({ kind: 'file', change, depth: 0 }))
    : treeRows;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useVirtualScrollMargin(listRef, scrollRef);
  const rowHeight = displayMode === 'list' ? 38 : 30;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => {
      const row = rows[index];
      return row?.kind === 'directory' ? `directory:${row.node.path}` : `${action}:${row?.change.path ?? index}`;
    },
    scrollMargin,
    overscan: 10,
  });
  return (
    <section className="change-section">
      <div className="section-heading">
        <span>{title}</span><Badge variant="secondary">{changes.length}</Badge>
        <div className="heading-actions">
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled || changes.length === 0} onClick={onAll} />}>{action === 'stage' ? <IconPlus /> : <IconMinus />}</TooltipTrigger><TooltipContent>{action === 'stage' ? 'Stage all' : 'Unstage all'}</TooltipContent></Tooltip>
        </div>
      </div>
      {changes.length === 0 ? <p className="empty-list">No changes</p> : (
        <div
          ref={listRef}
          role={displayMode === 'list' ? 'list' : 'tree'}
          aria-label={title}
          className={`${displayMode === 'list' ? 'change-list' : 'change-tree'} virtual-list`}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            return (
              <div key={virtualRow.key} className="virtual-row" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start - scrollMargin}px)` }}>
                {row.kind === 'directory' ? (
                  <ChangeTreeFolderRow
                    node={row.node}
                    depth={row.depth}
                    expanded={!collapsedPaths.has(row.node.path)}
                    disabled={disabled}
                    action={action}
                    onToggle={() => setCollapsedPaths((current) => {
                      const next = new Set(current);
                      if (next.has(row.node.path)) next.delete(row.node.path);
                      else next.add(row.node.path);
                      return next;
                    })}
                    onDiscard={onDiscard}
                    onAction={onAction}
                  />
                ) : (
                  <ChangeFileRow change={row.change} disabled={disabled} action={action} depth={row.depth} showDirectory={displayMode === 'list'} onSelect={onSelect} onOpenFile={onOpenFile} onDiscard={onDiscard} onAction={onAction} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface ChangeTreeEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  change: FileChange | null;
  children: ChangeTreeEntry[];
}

type ChangeVirtualRow =
  | { kind: 'directory'; node: ChangeTreeEntry; depth: number }
  | { kind: 'file'; change: FileChange; depth: number };

function flattenChangeTree(nodes: ChangeTreeEntry[], collapsedPaths: ReadonlySet<string>, depth = 0): ChangeVirtualRow[] {
  const rows: ChangeVirtualRow[] = [];
  for (const node of nodes) {
    if (node.type === 'file' && node.change) {
      rows.push({ kind: 'file', change: node.change, depth });
      continue;
    }
    rows.push({ kind: 'directory', node, depth });
    if (!collapsedPaths.has(node.path)) rows.push(...flattenChangeTree(node.children, collapsedPaths, depth + 1));
  }
  return rows;
}

function useVirtualScrollMargin(listRef: React.RefObject<HTMLDivElement | null>, scrollRef: React.RefObject<HTMLDivElement | null>): number {
  const [margin, setMargin] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    const scroll = scrollRef.current;
    if (!list || !scroll) return;
    const measure = () => {
      const next = list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      setMargin((current) => current === next ? current : next);
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const section of scroll.children) observer.observe(section);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [listRef, scrollRef]);
  return margin;
}

function ChangeTreeFolderRow({ node, depth, expanded, disabled, action, onToggle, onDiscard, onAction }: {
  node: ChangeTreeEntry; depth: number; expanded: boolean; disabled: boolean; action: 'stage' | 'unstage';
  onToggle(): void; onDiscard(paths: string[]): void; onAction(paths: string[]): void;
}) {
  const paths = collectChangePaths(node);
  return (
    <div role="treeitem" aria-expanded={expanded} className="tree-folder" style={{ paddingLeft: 8 + depth * 14 }}>
      <button className="folder-toggle" onClick={onToggle} aria-label={expanded ? 'Collapse folder' : 'Expand folder'}><IconChevronRight className={`folder-chevron ${expanded ? 'open' : ''}`} /></button>
      <VsCodeTreeIcon path={node.path} type="directory" expanded={expanded} />
      <button className="folder-name" onClick={onToggle}>{node.name}</button>
      <ChangeActions paths={paths} action={action} disabled={disabled} onDiscard={onDiscard} onAction={onAction} />
    </div>
  );
}

function ChangeFileRow({ change, disabled, action, depth = 0, showDirectory = false, onSelect, onOpenFile, onDiscard, onAction }: {
  change: FileChange; disabled: boolean; action: 'stage' | 'unstage'; depth?: number; showDirectory?: boolean;
  onSelect(path: string): void; onOpenFile(path: string): void; onDiscard(paths: string[]): void; onAction(paths: string[]): void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const normalizedPath = change.path.replace(/[\\/]+$/, '');
  const slash = normalizedPath.lastIndexOf('/');
  const name = slash < 0 ? normalizedPath : normalizedPath.slice(slash + 1);
  const directory = slash < 0 ? '' : normalizedPath.slice(0, slash);
  const directorySummary = change.path.endsWith('/') || change.path.endsWith('\\');
  return (
    <div ref={rowRef} role={showDirectory ? 'listitem' : 'treeitem'} className="change-row" style={{ paddingLeft: 12 + depth * 14 }}>
      {!showDirectory && <span className="tree-spacer" />}
      <Tooltip>
        <TooltipTrigger render={<button className="file-label" onClick={() => onSelect(change.path)} aria-label={`View changes for ${change.path}`} />}>
          <VsCodeTreeIcon path={normalizedPath} type={directorySummary ? 'directory' : 'file'} />
          <span className="change-file-text"><span>{name}</span>{showDirectory && directory && <small>{directory}</small>}</span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>{change.path}</TooltipContent>
      </Tooltip>
      <span className="change-row-actions">
        {!directorySummary && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled} onClick={() => onOpenFile(change.path)} aria-label="Open file" />}><IconFileArrowRight /></TooltipTrigger><TooltipContent>Open file</TooltipContent></Tooltip>}
        <ChangeActions paths={[change.path]} action={action} disabled={disabled} onDiscard={onDiscard} onAction={onAction} />
      </span>
      <span className={`status-code ${change.conflict ? 'conflict' : ''}`} data-kind={change.kind}>{changeStatusCode(change.kind)}</span>
    </div>
  );
}

function ChangeActions({ paths, action, disabled, onDiscard, onAction }: {
  paths: string[]; action: 'stage' | 'unstage'; disabled: boolean;
  onDiscard(paths: string[]): void; onAction(paths: string[]): void;
}) {
  return (
    <span className="change-actions">
      {action === 'stage' && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button change-action-discard" disabled={disabled} onClick={() => onDiscard(paths)} aria-label="Discard changes" />}><IconRestore /></TooltipTrigger><TooltipContent>Discard changes</TooltipContent></Tooltip>}
      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled} onClick={() => onAction(paths)} aria-label={action === 'stage' ? 'Stage changes' : 'Unstage changes'} />}>{action === 'stage' ? <IconPlus /> : <IconMinus />}</TooltipTrigger><TooltipContent>{action === 'stage' ? 'Stage changes' : 'Unstage changes'}</TooltipContent></Tooltip>
    </span>
  );
}

function VsCodeTreeIcon({ path, type, expanded = false }: { path: string; type: 'file' | 'directory'; expanded?: boolean }) {
  const src = type === 'file' ? getVsCodeFileIconUrl(path) : getVsCodeFolderIconUrl(path, expanded);
  return <img className="vscode-tree-icon" src={src} alt="" aria-hidden="true" draggable={false} />;
}

interface HistoryViewProps {
  repositoryId: string; upstream: string | null; readOnly: boolean; operation: string | null;
  commits: CommitInfo[] | null; nextCursor: string | null; loading: boolean; undoing: boolean;
  onSelectCommit(commit: CommitInfo): void; onSelectFile(oid: string, file: CommitFile): void; onUndo(commit: CommitInfo): void; onMore(): void;
}

function HistoryView({ repositoryId, upstream, readOnly, operation, commits, nextCursor, loading, undoing, onSelectCommit, onSelectFile, onUndo, onMore }: HistoryViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
  const commitVirtualizer = useVirtualizer({
    count: commits?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 66,
    getItemKey: (index) => commits?.[index]?.oid ?? index,
    overscan: 8,
  });
  if (commits === null) {
    return <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading history…" /></div>;
  }
  return (
    <div className="history-list">
      {!upstream && commits.length > 0 && <div className="history-upstream-notice" role="status">Configure an upstream to distinguish local from published commits.</div>}
      <div ref={scrollRef} className="history-scroll" role="list" aria-label="Commit history">
        {commits.length === 0 ? <p className="empty-list">This repository has no commits yet.</p> : (
          <div
            className="virtual-list"
            style={{ height: commitVirtualizer.getTotalSize() + (nextCursor ? 52 : 0) }}
          >
            {commitVirtualizer.getVirtualItems().map((virtualRow) => {
              const commit = commits[virtualRow.index]!;
              return (
                <div
                  key={virtualRow.key}
                  ref={commitVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="virtual-row"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <CommitRow
                    repositoryId={repositoryId}
                    upstream={upstream}
                    commit={commit}
                    expanded={expandedCommits.has(commit.oid)}
                    onExpandedChange={(expanded) => setExpandedCommits((current) => {
                      const next = new Set(current);
                      if (expanded) next.add(commit.oid);
                      else next.delete(commit.oid);
                      return next;
                    })}
                    canUndo={!readOnly && !operation && !undoing && commit.upstreamState === 'local-only' && commit.isHead && commit.parentCount === 1}
                    onSelectCommit={onSelectCommit}
                    onSelectFile={onSelectFile}
                    onUndo={onUndo}
                  />
                </div>
              );
            })}
            {nextCursor && (
              <Button
                variant="ghost"
                className="history-more"
                style={{ top: commitVirtualizer.getTotalSize() }}
                disabled={loading}
                onClick={onMore}
              >
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Commit contents are immutable per oid, so cached file lists never go stale.
const commitFilesCache = new Map<string, CommitFile[]>();

function CommitRow({ repositoryId, upstream, commit, expanded, onExpandedChange, canUndo, onSelectCommit, onSelectFile, onUndo }: {
  repositoryId: string; upstream: string | null; commit: CommitInfo; expanded: boolean; canUndo: boolean;
  onExpandedChange(expanded: boolean): void;
  onSelectCommit(commit: CommitInfo): void; onSelectFile(oid: string, file: CommitFile): void; onUndo(commit: CommitInfo): void;
}) {
  const cacheKey = `${repositoryId}:${commit.oid}`;
  const [files, setFiles] = useState<CommitFile[] | null>(() => commitFilesCache.get(cacheKey) ?? null);
  const [filesError, setFilesError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || files || filesError) return;
    let active = true;
    window.justgit.commits.files(repositoryId, commit.oid).then((value) => {
      if (!active) return;
      commitFilesCache.set(cacheKey, value);
      while (commitFilesCache.size > 100) commitFilesCache.delete(commitFilesCache.keys().next().value as string);
      setFiles(value);
    }).catch((reason) => { if (active) setFilesError(messageOf(reason)); });
    return () => { active = false; };
  }, [cacheKey, commit.oid, expanded, files, filesError, repositoryId]);

  const refs = parseDecorations(commit.decorations);
  const shownRefs = refs.slice(0, 3);
  const hiddenRefs = refs.slice(3);
  const additions = files?.reduce((total, file) => total + file.additions, 0) ?? 0;
  const deletions = files?.reduce((total, file) => total + file.deletions, 0) ?? 0;

  const copyOid = async () => {
    try { await window.justgit.clipboard.writeText(commit.oid); toast.success('Hash copied', { description: commit.oid }); }
    catch { toast.error('Could not copy hash'); }
  };

  return (
    <div className="commit-item" role="listitem">
      <div className="commit-header">
        <button className="commit-expand" aria-expanded={expanded} aria-label={expanded ? 'Collapse commit' : 'Expand commit'} onClick={() => onExpandedChange(!expanded)}>
          <IconChevronRight className={`folder-chevron ${expanded ? 'open' : ''}`} />
        </button>
        <div className="commit-main">
          <Tooltip>
            <TooltipTrigger render={<button className="commit-subject" onClick={() => onSelectCommit(commit)} />}>{commit.subject || '(no subject)'}</TooltipTrigger>
            <TooltipContent side="right">View the full commit diff</TooltipContent>
          </Tooltip>
          <span className="commit-meta">
            <Tooltip>
              <TooltipTrigger render={<button className="commit-oid" onClick={() => void copyOid()} aria-label={`Copiar hash ${commit.shortOid}`} />}>{commit.shortOid}</TooltipTrigger>
              <TooltipContent>Copy full hash</TooltipContent>
            </Tooltip>
            <span className="commit-author">{commit.author}</span>
            <span aria-hidden="true">·</span>
            <Tooltip>
              <TooltipTrigger render={<span className="commit-date" />}>{formatRelativeDate(commit.date)}</TooltipTrigger>
              <TooltipContent>{formatDate(commit.date)}</TooltipContent>
            </Tooltip>
          </span>
          {(refs.length > 0 || commit.parentCount > 1 || commit.upstreamState === 'local-only') && (
            <span className="commit-refs">
              {commit.upstreamState === 'local-only' && (
                <Tooltip>
                  <TooltipTrigger render={<span className="ref-chip local-only" />}>Local only</TooltipTrigger>
                  <TooltipContent>{commit.isHead ? `Not in ${upstream ?? 'the upstream'} according to the latest known remote state.` : 'Not published. To avoid rewriting multiple commits, only the latest can be undone.'}</TooltipContent>
                </Tooltip>
              )}
              {commit.parentCount > 1 && <span className="ref-chip merge">merge</span>}
              {shownRefs.map((ref) => <span key={`${ref.kind}:${ref.label}`} className={`ref-chip ${ref.kind}`}>{ref.label}</span>)}
              {hiddenRefs.length > 0 && (
                <Tooltip>
                  <TooltipTrigger render={<span className="ref-chip more" />}>+{hiddenRefs.length}</TooltipTrigger>
                  <TooltipContent>{hiddenRefs.map((ref) => ref.label).join(' · ')}</TooltipContent>
                </Tooltip>
              )}
            </span>
          )}
        </div>
        {canUndo && (
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button commit-undo" onClick={(event) => { event.stopPropagation(); onUndo(commit); }} aria-label={`Undo commit ${commit.shortOid}`} />}><IconRestore /></TooltipTrigger>
            <TooltipContent>Undo commit and keep its changes staged</TooltipContent>
          </Tooltip>
        )}
      </div>
      {expanded && (
        <div className="commit-files">
          {filesError && <div className="commit-files-message error">{filesError}</div>}
          {!files && !filesError && <div className="commit-files-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading files…" /></div>}
          {files && files.length === 0 && <div className="commit-files-message">This commit does not modify its own files (merge).</div>}
          {files && files.length > 0 && (
            <>
              <div className="commit-files-summary">
                {files.length} {files.length === 1 ? 'file' : 'files'}
                {(additions > 0 || deletions > 0) && <> · <span className="add">+{additions}</span> <span className="del">−{deletions}</span></>}
              </div>
              {files.map((file) => (
                <CommitFileRow key={file.path} file={file} onSelect={() => onSelectFile(commit.oid, file)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CommitFileRow({ file, onSelect }: { file: CommitFile; onSelect(): void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const slash = file.path.lastIndexOf('/');
  const name = slash < 0 ? file.path : file.path.slice(slash + 1);
  const oldName = file.oldPath?.split('/').pop();
  return (
    <div ref={rowRef} className="commit-file-row">
      <Tooltip>
        <TooltipTrigger render={<button className="commit-file-label" onClick={onSelect} aria-label={`Ver el diff de ${file.path}`} />}>
          <VsCodeTreeIcon path={file.path} type="file" />
          <span className="commit-file-text">
            <span>{name}</span>
            {oldName && <small className="commit-file-rename">{oldName} →</small>}
          </span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</TooltipContent>
      </Tooltip>
      <span className="commit-file-stats">
        {file.binary ? <span className="binary">bin</span> : (
          <>
            {file.additions > 0 && <span className="add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="del">−{file.deletions}</span>}
          </>
        )}
      </span>
      <span className="status-code" data-kind={file.kind}>{changeStatusCode(file.kind)}</span>
    </div>
  );
}

type RefChipInfo = { label: string; kind: 'head' | 'branch' | 'remote' | 'tag' };

function parseDecorations(decorations: string[]): RefChipInfo[] {
  return decorations.map((decoration) => {
    if (decoration.startsWith('tag: ')) return { label: decoration.slice(5), kind: 'tag' as const };
    if (decoration.startsWith('HEAD -> ')) return { label: decoration.slice(8), kind: 'head' as const };
    if (decoration === 'HEAD') return { label: 'HEAD', kind: 'head' as const };
    return { label: decoration, kind: decoration.includes('/') ? 'remote' as const : 'branch' as const };
  });
}

const RELATIVE_DATE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60],
];

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE_DATE.format(Math.trunc(seconds / size), unit);
  }
  return 'right now';
}

function Welcome({ recent, onOpen, onRecent, error }: { recent: BootstrapData['recentRepositories']; onOpen(): void; onRecent(id: string): void; error: string | null }) {
  const repositories = groupRecentRepositories(recent);
  return (
    <div className="welcome">
      <h1>JustGit</h1><p>Open a repository to review changes, explore files, and create commits.</p>
      <Button size="lg" onClick={onOpen}><IconFolderOpen /> Open repository</Button>
      {error && <div className="welcome-error">{error}</div>}
      {repositories.length > 0 && <section><h2>Recent</h2>{repositories.map((item) => <button key={item.key} onClick={() => onRecent(item.recent.id)}><IconFolder /><span><strong>{item.name}</strong><small>{item.rootPath}</small></span></button>)}</section>}
      <small className="shortcut">Ctrl+O to open · Ctrl+R to refresh</small>
    </div>
  );
}

interface MutableChangeTreeEntry extends Omit<ChangeTreeEntry, 'children'> { children: Map<string, MutableChangeTreeEntry> }

function buildChangeTree(changes: FileChange[]): ChangeTreeEntry[] {
  const root = new Map<string, MutableChangeTreeEntry>();
  for (const change of changes) {
    const parts = change.path.split('/').filter(Boolean);
    let level = root;
    let accumulated = '';
    parts.forEach((part, index) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.get(part);
      if (!node) {
        node = { name: part, path: accumulated, type: isFile ? 'file' : 'directory', change: isFile ? change : null, children: new Map() };
        level.set(part, node);
      } else if (isFile) {
        node.change = change;
        node.type = 'file';
      }
      level = node.children;
    });
  }
  const serialize = (nodes: Map<string, MutableChangeTreeEntry>): ChangeTreeEntry[] => [...nodes.values()]
    .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    .map((node) => ({ name: node.name, path: node.path, type: node.type, change: node.change, children: serialize(node.children) }));
  return serialize(root);
}

function collectChangePaths(node: ChangeTreeEntry): string[] {
  if (node.type === 'file') return node.change ? [node.change.path] : [];
  return node.children.flatMap(collectChangePaths);
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
function harnessLabel(harness: AiHarnessId): string { return harness === 'codex' ? 'Codex' : harness === 'claude' ? 'Claude Code' : 'OpenCode'; }
function availabilityLabel(status: AiHarnessStatus | undefined): string {
  if (!status) return 'Not checked';
  if (!status.installed) return 'Not installed';
  if (status.authStatus === 'unauthenticated') return 'Not authenticated';
  if (status.availability === 'ready') return 'Available';
  return 'Check';
}
function availabilityBadgeVariant(status: AiHarnessStatus | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  if (!status.installed || status.authStatus === 'unauthenticated' || status.availability === 'error') return 'destructive';
  return status.availability === 'ready' ? 'default' : 'secondary';
}
function loginCommand(harness: AiHarnessId): string { return harness === 'codex' ? 'codex login' : harness === 'claude' ? 'claude auth login' : 'opencode auth login'; }
function changeStatusCode(kind: ChangeKind): string {
  return ({ modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U', conflicted: 'C', 'type-changed': 'T' } as const)[kind];
}
function samePath(left: string, right: string): boolean { return left.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase() === right.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase(); }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
