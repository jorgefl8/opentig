import type { ViewerSelection } from '@/features/viewer/Viewer';
import type { ViewerMemorySnapshot } from '@/features/viewer/viewer-memory';

export const SIDEBAR_VIEWS = ['changes', 'files', 'history', 'prs', 'search'] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];

/**
 * Where the user is: the repository, its section, what the viewer shows, and
 * what goes with it. Everything Back must bring back that is not a scroll
 * position or a viewer's own memory lives here.
 */
export interface NavigationLocation {
  repositoryId: string;
  view: SidebarView;
  selection: ViewerSelection;
  /** History narrowed to one file, and where it was opened from, which its own back link returns to. */
  fileHistory: FileHistoryLocation | null;
  /** The line a file was opened on, by a search result or an address. */
  line: number | null;
  /** On a phone, which of the two panes shows. */
  pane: 'list' | 'viewer';
}

export interface FileHistoryLocation {
  path: string;
  returnTo: { view: SidebarView; selection: ViewerSelection };
}

/** A scrolled element, found again by its place under the list or the viewer. */
export interface ScrollMark {
  area: 'list' | 'viewer';
  /** Child indices from the area's root down to the element. */
  path: number[];
  /** The element's tag and first class, so a different element at the same place is not scrolled. */
  identity: string;
  top: number;
  left: number;
}

/** What is kept with a step besides its location: updated while it is current, never a step of its own. */
export interface EntryMemory {
  scroll: ScrollMark[];
  viewer: ViewerMemorySnapshot;
}

export interface NavigationEntry {
  /** Unique for the session, so a restore can tell which entry it was asked for. */
  key: string;
  location: NavigationLocation;
  memory: EntryMemory;
}

export const EMPTY_MEMORY: EntryMemory = { scroll: [], viewer: {} };

/** The most scroll positions kept per step: the list, the viewer, and a few nested scrollers inside them. */
export const MAX_SCROLL_MARKS = 6;

export function sameSelection(a: ViewerSelection, b: ViewerSelection): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  switch (a.type) {
    case 'diff': return b.type === 'diff' && a.path === b.path && a.kind === b.kind;
    case 'conflict': return b.type === 'conflict' && a.path === b.path;
    case 'file': return b.type === 'file' && a.path === b.path;
    case 'commit': return b.type === 'commit' && a.oid === b.oid;
    case 'commit-file': return b.type === 'commit-file' && a.oid === b.oid && a.path === b.path && (a.oldPath ?? null) === (b.oldPath ?? null);
    case 'pull-request': return b.type === 'pull-request' && a.number === b.number;
    case 'release': return b.type === 'release' && a.tag === b.tag;
    case 'workflow-run': return b.type === 'workflow-run' && a.runId === b.runId && (a.jobId ?? null) === (b.jobId ?? null);
  }
}

export function sameLocation(a: NavigationLocation, b: NavigationLocation): boolean {
  return a.repositoryId === b.repositoryId && a.view === b.view && sameSelection(a.selection, b.selection)
    && (a.fileHistory?.path ?? null) === (b.fileHistory?.path ?? null) && a.line === b.line && a.pane === b.pane;
}

/**
 * Whether moving from one location to the other is a step of its own, given
 * whether the user asked for it. Another repository or section always is; what
 * the viewer shows is when the user opened it, and otherwise the step it
 * happened in only changes. A pane on its own is never a step: the phone's
 * arrow walks the trail, and only at its start goes back to the list.
 */
export function isStep(from: NavigationLocation, to: NavigationLocation, asked: boolean): boolean {
  if (from.repositoryId !== to.repositoryId || from.view !== to.view) return true;
  if (!asked) return false;
  return !sameSelection(from.selection, to.selection) || (from.fileHistory?.path ?? null) !== (to.fileHistory?.path ?? null) || from.line !== to.line;
}

/** The documents whose viewer memory belongs to a location: the pull request, run or commit it shows. */
export function viewerDocumentPrefix(location: NavigationLocation): string | null {
  const selection = location.selection;
  if (!selection) return null;
  if (selection.type === 'pull-request') return `${location.repositoryId}:pull:${selection.number}`;
  if (selection.type === 'workflow-run') return `${location.repositoryId}:workflow-run:${selection.runId}`;
  if (selection.type === 'commit') return `${location.repositoryId}:commit:${selection.oid}`;
  return null;
}
