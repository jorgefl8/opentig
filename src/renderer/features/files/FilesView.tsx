import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  IconArrowBackUp, IconArrowForwardUp, IconChevronRight, IconClipboard, IconColumns2, IconCopy, IconCut, IconEdit,
  IconExternalLink, IconFileArrowRight, IconFilePlus, IconFiles, IconFileText, IconFolderPlus, IconTrash,
} from '@tabler/icons-react';
import type { FileHistoryState } from '@shared/contracts';
import type { FileTreeEntry } from '@shared/git-types';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { getVsCodeFileIconUrl, getVsCodeFolderIconUrl } from '@/lib/vscode-icons';
import {
  canMovePathsToDirectory, canOpenPinnedDrop, fileHistoryShortcut, filterIgnoredEntries, findEntry, isEditableTarget, mergeLoadedDirectories,
  OPEN_FILES_DROP_HOST_ID, parentDirectory, pathContains, persistableExpandedPaths, reconcileExpandedPaths, replaceLoadedDirectoryLevels,
} from './file-tree';

const FILE_ROW_HEIGHT = 29;
const TREE_PADDING_START = 6;
const ROOT_DROP_ID = 'files-tree-root-drop';
const HOVER_EXPAND_DELAY_MS = 550;
const FILE_DROP_MOTION = { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const;
// How many ancestor folders may stack at the top before the shallowest drop off.
const STICKY_MAX_DEPTH = 6;

type EntryKind = 'file' | 'directory';

interface FilesViewProps {
  active: boolean;
  initialExpandedPaths: readonly string[];
  files: FileTreeEntry[] | null;
  /** Changes for every fresh root snapshot, including identical compact roots. */
  filesSnapshotRevision: number;
  showDotEnvFiles: boolean;
  activePath: string | null;
  readOnly: boolean;
  historyState: FileHistoryState;
  onUndo(): Promise<void>;
  onRedo(): Promise<void>;
  /** A single click previews a file; a double click or Ctrl+click pins its tab. */
  onOpenFile(path: string, mode?: 'preview' | 'pinned'): void;
  onLoadDirectory(path: string): Promise<FileTreeEntry[]>;
  onPersistExpandedPaths(paths: string[]): void;
  onCopyPath(entries: FileTreeEntry[]): Promise<void>;
  onCopyEntries(entries: FileTreeEntry[]): Promise<void>;
  onCutEntries(entries: FileTreeEntry[]): Promise<void>;
  onCopyContents(entry: FileTreeEntry): Promise<void>;
  onPaste(targetDirectory: string): Promise<void>;
  onMoveEntries(entries: FileTreeEntry[], targetDirectory: string): Promise<void>;
  onDeleteEntries(entries: FileTreeEntry[]): Promise<void>;
  onReveal(entry: FileTreeEntry): Promise<void>;
  onRename(entry: FileTreeEntry, newName: string): Promise<void>;
  onCreate(targetDirectory: string, name: string, kind: EntryKind): Promise<void>;
}

interface VisibleFileRow {
  entry: FileTreeEntry;
  depth: number;
}

interface NameDialogState {
  mode: 'rename' | 'new-file' | 'new-folder';
  entry: FileTreeEntry;
}

interface FileDragData {
  sourcePaths: string[];
  entry: FileTreeEntry;
}

interface FileDragPreview {
  entry: FileTreeEntry;
  sourcePaths: string[];
  count: number;
}

const fileTreeCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const candidates = collisions.length > 0 ? collisions : closestCenter(args);
  const row = candidates.find((collision) => collision.id !== ROOT_DROP_ID);
  return row ? [row] : candidates.slice(0, 1);
};

function flattenVisibleFiles(entries: FileTreeEntry[], expandedPaths: ReadonlySet<string>, depth = 0): VisibleFileRow[] {
  const rows: VisibleFileRow[] = [];
  for (const entry of entries) {
    rows.push({ entry, depth });
    if (entry.type === 'directory' && expandedPaths.has(entry.path)) {
      rows.push(...flattenVisibleFiles(entry.children, expandedPaths, depth + 1));
    }
  }
  return rows;
}

// The inclusive range of visible paths between two rows, used for Shift+click.
function pathRange(rows: VisibleFileRow[], from: string, to: string): string[] {
  const start = rows.findIndex((row) => row.entry.path === from);
  const end = rows.findIndex((row) => row.entry.path === to);
  if (start === -1 || end === -1) return [to];
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return rows.slice(lo, hi + 1).map((row) => row.entry.path);
}

// Any entry resolves to the folder that would receive a drop, paste, or new item:
// folders target themselves, files target their parent (top-level files → root).
function targetDirectoryFor(entry: FileTreeEntry): string {
  return entry.type === 'directory' ? entry.path : parentDirectory(entry.path);
}

export function FilesView({
  active,
  initialExpandedPaths,
  files,
  filesSnapshotRevision,
  showDotEnvFiles,
  activePath,
  readOnly,
  historyState,
  onUndo,
  onRedo,
  onOpenFile,
  onLoadDirectory,
  onPersistExpandedPaths,
  onCopyPath,
  onCopyEntries,
  onCutEntries,
  onCopyContents,
  onPaste,
  onMoveEntries,
  onDeleteEntries,
  onReveal,
  onRename,
  onCreate,
}: FilesViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const revealedPathRef = useRef<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(activePath);
  const [leadPath, setLeadPath] = useState<string | null>(activePath);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(initialExpandedPaths));
  const [draggedPaths, setDraggedPaths] = useState<string[]>([]);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<FileDragPreview | null>(null);
  const [openFilesDropHost, setOpenFilesDropHost] = useState<HTMLElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dialogState, setDialogState] = useState<NameDialogState | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [loadedDirectories, setLoadedDirectories] = useState<Map<string, FileTreeEntry[]>>(new Map());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const loadedDirectoriesRef = useRef(loadedDirectories);
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());
  const directoryRefreshTokenRef = useRef(0);
  const hoverExpansionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverExpansionPathRef = useRef<string | null>(null);
  const lastPersistedPathsRef = useRef(initialExpandedPaths.join('\0'));
  const loadedDirectoryKeys = useMemo(() => new Set(loadedDirectories.keys()), [loadedDirectories]);
  const mergedFiles = useMemo(
    () => files === null ? null : mergeLoadedDirectories(files, loadedDirectories),
    [files, loadedDirectories],
  );
  const visibleFiles = useMemo(
    () => mergedFiles === null ? null : showDotEnvFiles ? mergedFiles : filterIgnoredEntries(mergedFiles),
    [mergedFiles, showDotEnvFiles],
  );

  useEffect(() => { loadedDirectoriesRef.current = loadedDirectories; }, [loadedDirectories]);

  // The tab strip lives above this DndContext. A portal keeps the drop target in
  // this React context while placing its measured DOM rectangle over the strip.
  useEffect(() => {
    setOpenFilesDropHost(document.getElementById(OPEN_FILES_DROP_HOST_ID));
  }, [activePath]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => () => {
    if (hoverExpansionTimerRef.current) clearTimeout(hoverExpansionTimerRef.current);
  }, []);

  // The compact root snapshot cannot describe changes below an expanded ignored
  // folder. Re-read every materialized level, but keep the previous children on
  // screen until all replacements are ready. This catches deletes without making
  // open ignored files disappear briefly on the five-second reconciliation.
  useEffect(() => {
    const token = ++directoryRefreshTokenRef.current;
    const paths = [...loadedDirectoriesRef.current.keys()];
    if (paths.length === 0) return;
    void Promise.all(paths.map(async (path) => ({ path, children: await onLoadDirectory(path) })))
      .then((levels) => {
        if (token !== directoryRefreshTokenRef.current) return;
        const refreshed = new Map(levels.map(({ path, children }) => [path, children]));
        setLoadedDirectories((current) => replaceLoadedDirectoryLevels(current, refreshed));
      });
  }, [filesSnapshotRevision, onLoadDirectory]);

  // A null tree means the initial snapshot is pending, not that restored paths
  // disappeared. Once materialized, keep lazy descendants deferred until their
  // nearest ignored level has actually been read.
  useEffect(() => {
    if (!mergedFiles) {
      loadingDirectoriesRef.current.clear();
      setLoadedDirectories((current) => current.size === 0 ? current : new Map());
      return;
    }
    setExpandedPaths((current) => {
      const next = new Set(reconcileExpandedPaths(mergedFiles, current, loadedDirectoryKeys).retained);
      return setsEqual(current, next) ? current : next;
    });
  }, [loadedDirectoryKeys, mergedFiles]);

  useEffect(() => {
    if (!mergedFiles) return;
    const paths = persistableExpandedPaths(mergedFiles, expandedPaths, loadedDirectoryKeys);
    const serialized = paths.join('\0');
    if (serialized === lastPersistedPathsRef.current) return;
    lastPersistedPathsRef.current = serialized;
    onPersistExpandedPaths(paths);
  }, [expandedPaths, loadedDirectoryKeys, mergedFiles, onPersistExpandedPaths]);

  // Git-ignored folders (node_modules/, dist/…) arrive collapsed and empty so the
  // initial tree stays cheap. The first time one is expanded its level is read on
  // demand; collapsing it drops the cache so the next open sees fresh contents.
  useEffect(() => {
    if (!active || !visibleFiles) return;
    let available = Math.max(0, 2 - loadingDirectoriesRef.current.size);
    for (const path of expandedPaths) {
      if (available === 0) break;
      const entry = findEntry(visibleFiles, path);
      if (!entry || entry.type !== 'directory' || entry.ignored !== true) continue;
      if (entry.children.length > 0 || loadedDirectories.has(path) || loadingDirectoriesRef.current.has(path)) continue;
      loadingDirectoriesRef.current.add(path);
      available -= 1;
      void onLoadDirectory(path)
        // A failed read caches an empty level instead of retrying on every render;
        // the error itself is reported by the caller.
        .catch((): FileTreeEntry[] => [])
        .then((children) => { setLoadedDirectories((current) => new Map(current).set(path, children)); })
        .finally(() => { loadingDirectoriesRef.current.delete(path); });
    }
  }, [active, expandedPaths, loadedDirectories, onLoadDirectory, visibleFiles]);

  useEffect(() => {
    if (active) return;
    setDialogState(null);
    setDraggedPaths([]);
    setDropTargetPath(null);
    setDragPreview(null);
    if (hoverExpansionTimerRef.current) clearTimeout(hoverExpansionTimerRef.current);
    hoverExpansionTimerRef.current = null;
    hoverExpansionPathRef.current = null;
  }, [active]);

  // Prune the selection, anchor, and lead when files disappear (deletes, moves, refresh).
  useEffect(() => {
    if (!visibleFiles) return;
    setSelectedPaths((current) => {
      if (current.size === 0) return current;
      const next = new Set([...current].filter((path) => findEntry(visibleFiles, path)));
      return next.size === current.size ? current : next;
    });
    setAnchorPath((current) => (current && findEntry(visibleFiles, current)) ? current : null);
    setLeadPath((current) => {
      if (current && findEntry(visibleFiles, current)) return current;
      return activePath && findEntry(visibleFiles, activePath) ? activePath : null;
    });
  }, [activePath, visibleFiles]);

  const rows = useMemo(
    () => visibleFiles ? flattenVisibleFiles(visibleFiles, expandedPaths) : [],
    [expandedPaths, visibleFiles],
  );
  // TanStack Virtual intentionally returns an imperative, non-memoizable instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    enabled: active,
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.entry.path ?? index,
    overscan: 12,
    paddingStart: TREE_PADDING_START,
    paddingEnd: 12,
  });

  // Reveal the active file: expand its ancestor folders so a freshly opened or
  // just-created file is never left hidden behind a collapsed directory.
  useEffect(() => {
    if (!active || !activePath || !visibleFiles || !findEntry(visibleFiles, activePath)) return;
    setExpandedPaths((current) => {
      const next = new Set(current);
      let changed = false;
      const parts = activePath.split('/');
      let accumulated = '';
      for (let index = 0; index < parts.length - 1; index += 1) {
        accumulated = accumulated ? `${accumulated}/${parts[index]}` : parts[index]!;
        if (!next.has(accumulated)) { next.add(accumulated); changed = true; }
      }
      return changed ? next : current;
    });
  }, [active, activePath, visibleFiles]);

  // Scroll the active row into view once (per path) after its ancestors expand,
  // without yanking the viewport back on unrelated background refreshes.
  useEffect(() => {
    if (!active) return;
    if (!activePath) { revealedPathRef.current = null; return; }
    if (revealedPathRef.current === activePath) return;
    const index = rows.findIndex((row) => row.entry.path === activePath);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'auto' });
      revealedPathRef.current = activePath;
    }
    // virtualizer is a fresh instance each render and must stay out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activePath, rows]);

  const rowByPath = useMemo(() => {
    const map = new Map<string, VisibleFileRow>();
    for (const row of rows) map.set(row.entry.path, row);
    return map;
  }, [rows]);

  // Sticky scroll: pin the ancestor folders of the top visible row, but only the
  // ones that also lie on the open file's path — scrolling past unrelated folders
  // (e.g. docs) must not pin them.
  const stickyScroll = useMemo(() => {
    const empty = { headers: [] as VisibleFileRow[], push: 0 };
    if (rows.length === 0 || !activePath) return empty;
    const activeAncestors = new Set<string>();
    const activeParts = activePath.split('/');
    let activeAccumulated = '';
    for (let i = 0; i < activeParts.length - 1; i += 1) {
      activeAccumulated = activeAccumulated ? `${activeAccumulated}/${activeParts[i]}` : activeParts[i]!;
      activeAncestors.add(activeAccumulated);
    }
    if (activeAncestors.size === 0) return empty;
    const firstIndex = Math.min(rows.length - 1, Math.max(0, Math.floor((scrollTop - TREE_PADDING_START) / FILE_ROW_HEIGHT)));
    const topRow = rows[firstIndex];
    if (!topRow) return empty;
    const parts = topRow.entry.path.split('/');
    const headers: VisibleFileRow[] = [];
    let accumulated = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      accumulated = accumulated ? `${accumulated}/${parts[i]}` : parts[i]!;
      if (!activeAncestors.has(accumulated)) continue;
      const row = rowByPath.get(accumulated);
      if (row && row.entry.type === 'directory') headers.push(row);
    }
    if (headers.length > STICKY_MAX_DEPTH) headers.splice(0, headers.length - STICKY_MAX_DEPTH);
    if (headers.length === 0) return empty;
    const deepest = headers[headers.length - 1]!;
    const stackHeight = headers.length * FILE_ROW_HEIGHT;
    // The deepest folder's subtree ends at the first later row at its depth or shallower.
    let boundaryTop = Infinity;
    const maxScan = Math.ceil((scrollTop + stackHeight - TREE_PADDING_START) / FILE_ROW_HEIGHT) + 2;
    for (let i = firstIndex; i < rows.length && i <= maxScan; i += 1) {
      if (rows[i]!.depth <= deepest.depth) { boundaryTop = TREE_PADDING_START + i * FILE_ROW_HEIGHT; break; }
    }
    const push = Math.max(0, Math.min(FILE_ROW_HEIGHT, stackHeight - (boundaryTop - scrollTop)));
    return { headers, push };
  }, [rows, rowByPath, scrollTop, activePath]);

  if (visibleFiles === null) {
    return <div className="view-loading" role="status" hidden={!active}><ShimmeringText text="Loading files…" /></div>;
  }

  // When nothing is explicitly selected, mirror the open file so it stays highlighted.
  const highlightedPaths = selectedPaths.size > 0
    ? selectedPaths
    : (activePath ? new Set([activePath]) : new Set<string>());
  const selectionPaths = selectedPaths.size > 0 ? [...selectedPaths] : (activePath ? [activePath] : []);
  const resolveEntries = (paths: Iterable<string>): FileTreeEntry[] => {
    const resolved: FileTreeEntry[] = [];
    for (const path of paths) {
      const entry = findEntry(visibleFiles, path);
      if (entry) resolved.push(entry);
    }
    return resolved;
  };

  const selectOnly = (path: string) => {
    setSelectedPaths(new Set([path]));
    setAnchorPath(path);
    setLeadPath(path);
  };

  // Clicking a sticky ancestor scrolls its folder to the top and selects it.
  const handleStickyClick = (entry: FileTreeEntry) => {
    const index = rows.findIndex((row) => row.entry.path === entry.path);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'start' });
    selectOnly(entry.path);
  };

  const handleRowClick = (entry: FileTreeEntry, mods: { ctrl: boolean; shift: boolean }) => {
    if (mods.shift && (anchorPath || leadPath)) {
      const range = pathRange(rows, anchorPath ?? leadPath!, entry.path);
      setSelectedPaths(new Set(range));
      setLeadPath(entry.path);
      return;
    }
    if (mods.ctrl) {
      setSelectedPaths((current) => {
        const next = new Set(current.size === 0 && activePath ? [activePath] : current);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setAnchorPath(entry.path);
      setLeadPath(entry.path);
      // Ctrl+click keeps its multi-selection role and additionally opens the
      // file in a pinned tab, so it lands beside the current preview instead of
      // replacing it.
      if (entry.type === 'file') onOpenFile(entry.path, 'pinned');
      return;
    }
    selectOnly(entry.path);
    if (entry.type === 'file') onOpenFile(entry.path);
    else toggleExpanded(entry.path);
  };

  // The preceding single click already previewed the file, so the double click
  // only has to pin it; selection and multi-selection are left untouched.
  const handleRowDoubleClick = (entry: FileTreeEntry) => {
    if (entry.type === 'file') onOpenFile(entry.path, 'pinned');
  };

  // Right-clicking outside the current selection collapses it to that single row,
  // matching VS Code; if the row is already selected the whole selection is kept.
  const handleRowContextMenu = (entry: FileTreeEntry) => {
    if (!selectedPaths.has(entry.path)) selectOnly(entry.path);
  };

  // Context-menu targets: the live selection if the clicked row belongs to it,
  // otherwise just that row (resilient to the async selection state update).
  const contextTargets = (entry: FileTreeEntry): FileTreeEntry[] => (
    selectedPaths.has(entry.path) && selectedPaths.size > 0 ? resolveEntries(selectedPaths) : [entry]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    const historyShortcut = fileHistoryShortcut(event.nativeEvent);
    if (historyShortcut === 'undo' && historyState.canUndo && !readOnly) {
      event.preventDefault();
      if (!event.repeat) void onUndo();
      return;
    }
    if (historyShortcut === 'redo' && historyState.canRedo && !readOnly) {
      event.preventDefault();
      if (!event.repeat) void onRedo();
      return;
    }
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = event.key.toLowerCase();
    if (command && key === 'a') {
      event.preventDefault();
      setSelectedPaths(new Set(rows.map((row) => row.entry.path)));
      return;
    }
    const entries = resolveEntries(selectionPaths);
    const lead = leadPath ? findEntry(visibleFiles, leadPath) : null;
    if (command && key === 'c' && entries.length) {
      event.preventDefault();
      void onCopyEntries(entries);
      return;
    }
    if (command && key === 'x' && entries.length && !readOnly) {
      event.preventDefault();
      void onCutEntries(entries);
      return;
    }
    if (command && key === 'v' && !readOnly) {
      event.preventDefault();
      const target = lead ? targetDirectoryFor(lead) : parentDirectory(entries[0]?.path ?? '');
      void onPaste(target);
      return;
    }
    if (event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !readOnly) {
      if (selectedPaths.size === 1) {
        const entry = findEntry(visibleFiles, [...selectedPaths][0]!);
        if (entry) {
          event.preventDefault();
          setDialogState({ mode: 'rename', entry });
        }
      }
      return;
    }
    if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !readOnly && entries.length) {
      event.preventDefault();
      void onDeleteEntries(entries);
    }
  };

  const movePaths = async (sourcePaths: string[], targetDirectory: string) => {
    const entries = resolveEntries(sourcePaths);
    if (entries.length) await onMoveEntries(entries, targetDirectory);
  };
  const toggleExpanded = (path: string, forceOpen = false) => {
    const collapsing = !forceOpen && expandedPaths.has(path);
    const collapsingLazy = collapsing && findEntry(visibleFiles ?? [], path)?.ignored === true;
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (forceOpen || !next.has(path)) {
        if (next.has(path)) return current;
        next.add(path);
      } else if (collapsingLazy) {
        for (const expanded of next) if (pathContains(path, expanded)) next.delete(expanded);
      } else next.delete(path);
      return setsEqual(current, next) ? current : next;
    });
    // Closing a lazily read folder forgets it (and its subtree) so reopening it
    // reads the folder again instead of showing what was there minutes ago.
    if (!collapsing) return;
    setLoadedDirectories((current) => {
      const stale = [...current.keys()].filter((loaded) => pathContains(path, loaded));
      if (stale.length === 0) return current;
      const next = new Map(current);
      for (const entry of stale) next.delete(entry);
      return next;
    });
  };

  const clearHoverExpansion = () => {
    if (hoverExpansionTimerRef.current) clearTimeout(hoverExpansionTimerRef.current);
    hoverExpansionTimerRef.current = null;
    hoverExpansionPathRef.current = null;
  };
  const endDrag = () => {
    clearHoverExpansion();
    setDraggedPaths([]);
    setDropTargetPath(null);
    setDragPreview(null);
  };
  const dragData = (event: DragStartEvent | DragOverEvent | DragEndEvent): FileDragData | null => {
    const data = event.active.data.current as Partial<FileDragData> | undefined;
    return data?.entry && Array.isArray(data.sourcePaths) ? { entry: data.entry, sourcePaths: data.sourcePaths } : null;
  };
  const handleDragStart = (event: DragStartEvent) => {
    const data = dragData(event);
    if (!data) return;
    if (!selectedPaths.has(data.entry.path)) selectOnly(data.entry.path);
    setDraggedPaths(data.sourcePaths);
    setDragPreview({ entry: data.entry, sourcePaths: data.sourcePaths, count: data.sourcePaths.length });
  };
  const handleDragOver = (event: DragOverEvent) => {
    const data = dragData(event);
    if (event.over?.data.current?.openPinned === true) {
      setDropTargetPath(null);
      clearHoverExpansion();
      return;
    }
    const targetDirectory = event.over?.data.current?.targetDirectory;
    if (!data || typeof targetDirectory !== 'string' || !canMovePathsToDirectory(data.sourcePaths, targetDirectory)) {
      setDropTargetPath(null);
      clearHoverExpansion();
      return;
    }
    setDropTargetPath(targetDirectory);
    const expandPath = event.over?.data.current?.expandPath;
    if (typeof expandPath !== 'string' || expandedPaths.has(expandPath)) {
      clearHoverExpansion();
      return;
    }
    if (hoverExpansionPathRef.current === expandPath) return;
    clearHoverExpansion();
    hoverExpansionPathRef.current = expandPath;
    hoverExpansionTimerRef.current = setTimeout(() => {
      toggleExpanded(expandPath, true);
      hoverExpansionTimerRef.current = null;
      hoverExpansionPathRef.current = null;
    }, HOVER_EXPAND_DELAY_MS);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    const data = dragData(event);
    const openPinned = event.over?.data.current?.openPinned === true;
    const targetDirectory = event.over?.data.current?.targetDirectory;
    endDrag();
    if (data && openPinned && canOpenPinnedDrop(data.entry, data.sourcePaths)) {
      onOpenFile(data.entry.path, 'pinned');
      return;
    }
    if (data && typeof targetDirectory === 'string' && canMovePathsToDirectory(data.sourcePaths, targetDirectory)) {
      void movePaths(data.sourcePaths, targetDirectory);
    }
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={fileTreeCollisionDetection}
      autoScroll={{ enabled: true, threshold: { x: 0.1, y: 0.16 }, acceleration: 12 }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={endDrag}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={scrollRef}
        className="files-view virtual-scroll"
        hidden={!active}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {stickyScroll.headers.length > 0 && (
        <div className="files-sticky" aria-hidden="true">
          {stickyScroll.headers.map((row, index) => {
            const isDeepest = index === stickyScroll.headers.length - 1;
            return (
              <button
                key={row.entry.path}
                type="button"
                className="file-tree-row files-sticky-row"
                style={{
                  top: index * FILE_ROW_HEIGHT - (isDeepest ? stickyScroll.push : 0),
                  paddingLeft: 12 + row.depth * 14,
                  zIndex: stickyScroll.headers.length - index,
                }}
                onClick={() => handleStickyClick(row.entry)}
              >
                <IconChevronRight className="folder-chevron open" />
                <VsCodeTreeIcon path={row.entry.path} type="directory" expanded />
                <span>{row.entry.name}</span>
              </button>
            );
          })}
        </div>
        )}
        {visibleFiles.length ? (
        <FileTreeDropSurface
          role="tree"
          aria-label="Files"
          className={`files-tree ${dropTargetPath === '' && draggedPaths.length > 0 ? 'root-drop-target' : ''}`}
          style={{ height: virtualizer.getTotalSize() }}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('.file-tree-row')) return;
            setSelectedPaths(new Set());
            setAnchorPath(null);
            setLeadPath(null);
            event.currentTarget.focus();
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const { entry, depth } = rows[virtualRow.index]!;
            const expanded = entry.type === 'directory' && expandedPaths.has(entry.path);
            const multiSelected = selectedPaths.has(entry.path) && selectedPaths.size > 1;
            return (
              <div
                key={virtualRow.key}
                className="virtual-row"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <FileRow
                  entry={entry}
                  depth={depth}
                  expanded={expanded}
                  pendingChildren={entry.type === 'directory' && entry.ignored === true && entry.children.length === 0 && !loadedDirectories.has(entry.path)}
                  selected={highlightedPaths.has(entry.path)}
                  active={activePath === entry.path}
                  multiSelected={multiSelected}
                  readOnly={readOnly}
                  historyState={historyState}
                  onUndo={onUndo}
                  onRedo={onRedo}
                  draggedPaths={draggedPaths}
                  dropTargetPath={dropTargetPath}
                  onFocus={setLeadPath}
                  onRowClick={handleRowClick}
                  onRowDoubleClick={handleRowDoubleClick}
                  onRowContextMenu={handleRowContextMenu}
                  onOpen={(target) => onOpenFile(target.path)}
                  onOpenPinned={(target) => onOpenFile(target.path, 'pinned')}
                  onCopy={(target) => void onCopyEntries(contextTargets(target))}
                  onCut={(target) => void onCutEntries(contextTargets(target))}
                  onPasteInto={(target) => void onPaste(targetDirectoryFor(target))}
                  onCopyPath={(target) => void onCopyPath(contextTargets(target))}
                  onCopyContents={onCopyContents}
                  onRename={(target) => setDialogState({ mode: 'rename', entry: target })}
                  onNewFile={(target) => setDialogState({ mode: 'new-file', entry: target })}
                  onNewFolder={(target) => setDialogState({ mode: 'new-folder', entry: target })}
                  onReveal={onReveal}
                  onDelete={(target) => void onDeleteEntries(contextTargets(target))}
                  dragPaths={selectedPaths.has(entry.path) && selectedPaths.size > 0 ? [...selectedPaths] : [entry.path]}
                />
              </div>
            );
          })}
        </FileTreeDropSurface>
        ) : <p className="empty-list">No files.</p>}
        <NameDialog state={dialogState} onClose={() => setDialogState(null)} onRename={onRename} onCreate={onCreate} />
      </div>
      <DragOverlay dropAnimation={reducedMotion ? null : FILE_DROP_MOTION}>
        {dragPreview && <FileDragOverlay preview={dragPreview} />}
      </DragOverlay>
      {openFilesDropHost && createPortal(
        <OpenFilesDropTarget visible={Boolean(dragPreview && canOpenPinnedDrop(dragPreview.entry, dragPreview.sourcePaths))} />,
        openFilesDropHost,
      )}
    </DndContext>
  );
}

function FileTreeDropSurface(props: ComponentPropsWithoutRef<'div'>) {
  const { setNodeRef } = useDroppable({ id: ROOT_DROP_ID, data: { targetDirectory: '', expandPath: null } });
  return <div ref={setNodeRef} {...props} />;
}

function OpenFilesDropTarget({ visible }: { visible: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: 'files-open-pinned-drop', data: { openPinned: true } });
  return (
    <div
      ref={setNodeRef}
      className={`open-files-drop-target ${visible ? 'visible' : ''} ${visible && isOver ? 'over' : ''}`}
      aria-hidden="true"
    >
      <IconColumns2 />
      <span>Drop to open beside</span>
    </div>
  );
}

function FileDragOverlay({ preview }: { preview: FileDragPreview }) {
  return (
    <div className="file-drag-overlay">
      <VsCodeTreeIcon path={preview.entry.path} type={preview.entry.type} expanded={false} />
      <span>{preview.entry.name}</span>
      {preview.count > 1 && <strong>{preview.count}</strong>}
    </div>
  );
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

interface FileRowProps {
  entry: FileTreeEntry;
  depth: number;
  expanded: boolean;
  /** An ignored folder whose contents have not been read yet, so "empty" is unknown. */
  pendingChildren: boolean;
  selected: boolean;
  active: boolean;
  multiSelected: boolean;
  readOnly: boolean;
  historyState: FileHistoryState;
  onUndo(): Promise<void>;
  onRedo(): Promise<void>;
  draggedPaths: string[];
  dropTargetPath: string | null;
  onFocus(path: string): void;
  onRowClick(entry: FileTreeEntry, mods: { ctrl: boolean; shift: boolean }): void;
  onRowDoubleClick(entry: FileTreeEntry): void;
  onRowContextMenu(entry: FileTreeEntry): void;
  onOpen(entry: FileTreeEntry): void;
  onOpenPinned(entry: FileTreeEntry): void;
  onCopy(entry: FileTreeEntry): void;
  onCut(entry: FileTreeEntry): void;
  onPasteInto(entry: FileTreeEntry): void;
  onCopyPath(entry: FileTreeEntry): void;
  onCopyContents(entry: FileTreeEntry): Promise<void>;
  onRename(entry: FileTreeEntry): void;
  onNewFile(entry: FileTreeEntry): void;
  onNewFolder(entry: FileTreeEntry): void;
  onReveal(entry: FileTreeEntry): Promise<void>;
  onDelete(entry: FileTreeEntry): void;
  dragPaths: string[];
}

function FileRow({
  entry,
  depth,
  expanded,
  pendingChildren,
  selected,
  active,
  multiSelected,
  readOnly,
  historyState,
  onUndo,
  onRedo,
  draggedPaths,
  dropTargetPath,
  onFocus,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onOpen,
  onOpenPinned,
  onCopy,
  onCut,
  onPasteInto,
  onCopyPath,
  onCopyContents,
  onRename,
  onNewFile,
  onNewFolder,
  onReveal,
  onDelete,
  dragPaths,
}: FileRowProps) {
  const targetDirectory = targetDirectoryFor(entry);
  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: `file-drag:${entry.path}`,
    data: { sourcePaths: dragPaths, entry } satisfies FileDragData,
    disabled: readOnly,
  });
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `file-drop:${entry.path}`,
    data: { targetDirectory, expandPath: entry.type === 'directory' ? entry.path : null },
  });
  const setRowRef = (element: HTMLButtonElement | null) => {
    setDraggableRef(element);
    setDroppableRef(element);
  };
  const isDropTarget = draggedPaths.length > 0 && entry.type === 'directory' && dropTargetPath === entry.path;
  const inDropRegion = draggedPaths.length > 0
    && dropTargetPath !== null
    && dropTargetPath !== ''
    && dropTargetPath !== entry.path
    && pathContains(dropTargetPath, entry.path);
  const row = (
    <button
      type="button"
      ref={setRowRef}
      {...attributes}
      role="treeitem"
      aria-selected={selected}
      aria-current={active ? 'true' : undefined}
      aria-expanded={entry.type === 'directory' ? expanded : undefined}
      className={[
        'file-tree-row',
        entry.ignored ? 'ignored-file' : '',
        draggedPaths.includes(entry.path) || isDragging ? 'dragging' : '',
        isDropTarget ? 'drop-target' : '',
        inDropRegion ? 'drop-target-region' : '',
      ].filter(Boolean).join(' ')}
      style={{ paddingLeft: 12 + depth * 14 }}
      {...listeners}
      onClick={(event) => onRowClick(entry, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey })}
      onDoubleClick={() => onRowDoubleClick(entry)}
      onFocus={() => onFocus(entry.path)}
      onContextMenu={() => onRowContextMenu(entry)}
    >
      {entry.type === 'directory'
        ? <IconChevronRight className={`folder-chevron ${expanded ? 'open' : ''} ${entry.children.length === 0 && !pendingChildren ? 'empty' : ''}`} />
        : <span className="tree-spacer" />}
      <VsCodeTreeIcon path={entry.path} type={entry.type} expanded={expanded} />
      <span>{entry.name}</span>
    </button>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent>
        {entry.type === 'file' && (
          <>
            <ContextMenuItem onClick={() => onOpen(entry)}>
              <IconFileArrowRight aria-hidden="true" /> Open
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onOpenPinned(entry)}>
              <IconColumns2 aria-hidden="true" /> Open to the Side <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+Click</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={readOnly || !historyState.canUndo} onClick={() => void onUndo()}>
          <IconArrowBackUp aria-hidden="true" /> {historyState.undoLabel ? `Undo ${historyState.undoLabel}` : 'Undo'} <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+Z</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly || !historyState.canRedo} onClick={() => void onRedo()}>
          <IconArrowForwardUp aria-hidden="true" /> {historyState.redoLabel ? `Redo ${historyState.redoLabel}` : 'Redo'} <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+Shift+Z</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCopy(entry)}>
          <IconFiles aria-hidden="true" /> Copy <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+C</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly} onClick={() => onCut(entry)}>
          <IconCut aria-hidden="true" /> Cut <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+X</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly} onClick={() => onPasteInto(entry)}>
          <IconClipboard aria-hidden="true" /> Paste <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+V</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={readOnly || multiSelected} onClick={() => onRename(entry)}>
          <IconEdit aria-hidden="true" /> Rename <span className="ml-auto text-[10px] text-muted-foreground">F2</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly || multiSelected} onClick={() => onNewFile(entry)}>
          <IconFilePlus aria-hidden="true" /> New File…
        </ContextMenuItem>
        <ContextMenuItem disabled={readOnly || multiSelected} onClick={() => onNewFolder(entry)}>
          <IconFolderPlus aria-hidden="true" /> New Folder…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCopyPath(entry)}>
          <IconFileText aria-hidden="true" /> Copy path
        </ContextMenuItem>
        <ContextMenuItem disabled={entry.type !== 'file' || multiSelected} onClick={() => void onCopyContents(entry)}>
          <IconCopy aria-hidden="true" /> Copy contents
        </ContextMenuItem>
        <ContextMenuItem disabled={multiSelected} onClick={() => void onReveal(entry)}>
          <IconExternalLink aria-hidden="true" /> Reveal in File Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive data-highlighted:text-destructive" disabled={readOnly} onClick={() => onDelete(entry)}>
          <IconTrash aria-hidden="true" /> Delete <span className="ml-auto text-[10px] text-muted-foreground">Del</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NameDialog({
  state,
  onClose,
  onRename,
  onCreate,
}: {
  state: NameDialogState | null;
  onClose(): void;
  onRename(entry: FileTreeEntry, newName: string): Promise<void>;
  onCreate(targetDirectory: string, name: string, kind: EntryKind): Promise<void>;
}) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!state) return;
    setName(state.mode === 'rename' ? state.entry.name : '');
  }, [state]);

  if (!state) return null;

  const isRename = state.mode === 'rename';
  const kind: EntryKind = state.mode === 'new-folder' ? 'directory' : 'file';
  const destination = targetDirectoryFor(state.entry);
  const title = isRename ? 'Rename' : kind === 'directory' ? 'New Folder' : 'New File';
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !/[\\/]/.test(trimmed) && !(isRename && trimmed === state.entry.name);

  const submit = () => {
    if (!canSubmit) return;
    if (isRename) void onRename(state.entry, trimmed);
    else void onCreate(destination, trimmed, kind);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPopup className="name-dialog">
        <form className="name-dialog-content" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isRename
              ? <>Enter a new name for <code>{state.entry.name}</code>.</>
              : <>Create a new {kind === 'directory' ? 'folder' : 'file'} in <code>{destination || 'the repository root'}</code>.</>}
          </DialogDescription>
          <input
            autoFocus
            className="name-dialog-input"
            value={name}
            maxLength={255}
            placeholder={isRename ? 'New name' : kind === 'directory' ? 'Folder name' : 'File name'}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => {
              if (!isRename) return;
              const dot = state.entry.name.lastIndexOf('.');
              event.target.setSelectionRange(0, dot > 0 ? dot : state.entry.name.length);
            }}
          />
          <div className="name-dialog-actions">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>{isRename ? 'Rename' : 'Create'}</Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function VsCodeTreeIcon({ path, type, expanded = false }: { path: string; type: 'file' | 'directory'; expanded?: boolean }) {
  const src = type === 'file' ? getVsCodeFileIconUrl(path) : getVsCodeFolderIconUrl(path, expanded);
  return <img className="vscode-tree-icon" src={src} alt="" aria-hidden="true" />;
}
