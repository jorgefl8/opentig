import { MAX_OPEN_FILE_TABS, normalizeOpenFilePath, type OpenFilesState, type OpenFileTab } from '../../../shared/open-files-state';

/** Soft warning boundary for the total size of unsaved drafts held in memory. */
export const DRAFT_MEMORY_WARNING_BYTES = 50 * 1024 * 1024;

/**
 * One open working-tree file. Structural metadata only: no file contents, no
 * `FileResult`, no editor objects. Draft text lives in a separate ref-backed map
 * owned by App so keystrokes never touch this state.
 */
export interface RuntimeTab {
  path: string;
  pinned: boolean;
  dirty: boolean;
  /** The file disappeared from disk while its draft was still unsaved. */
  missing: boolean;
  /** Runtime-only activation recency. Never persisted, never affects order. */
  activatedAt: number;
}

export interface FileSession {
  tabs: RuntimeTab[];
  activePath: string | null;
  previewPath: string | null;
  activationCounter: number;
}

export type OpenMode = 'preview' | 'pinned';

export interface OpenResult {
  session: FileSession;
  /** A clean tab closed to stay under the cap, so its draft map entry can go. */
  evictedPath: string | null;
  /** The cap was reached but nothing could be reclaimed; the tab opened anyway. */
  overCap: boolean;
}

export interface CloseResult {
  session: FileSession;
  activePath: string | null;
}

export interface RemoveResult {
  session: FileSession;
  /** Clean tabs that were closed because their file disappeared. */
  closedPaths: string[];
  /** Dirty tabs kept open and flagged missing so their text stays reachable. */
  retainedPaths: string[];
}

export type TabKeyboardAction = 'close' | 'next' | 'previous' | 'move-left' | 'move-right';

export interface KeyboardResult {
  session: FileSession;
  /** App must run the dirty Save / Discard / Cancel flow for this path. */
  closeRequest: string | null;
}

export const emptyFileSession: FileSession = { tabs: [], activePath: null, previewPath: null, activationCounter: 0 };

export function openTab(session: FileSession, rawPath: string, mode: OpenMode = 'preview'): OpenResult {
  const path = normalizeOpenFilePath(rawPath);
  if (!path) return { session, evictedPath: null, overCap: false };

  const existing = session.tabs.find((tab) => tab.path === path);
  if (existing) {
    const pinned = mode === 'pinned' ? true : existing.pinned;
    const tabs = session.tabs.map((tab) => (tab.path === path ? { ...tab, pinned } : tab));
    const previewPath = mode === 'pinned' && session.previewPath === path ? null : session.previewPath;
    return { session: activate({ ...session, tabs, previewPath }, path), evictedPath: null, overCap: false };
  }

  const fresh: RuntimeTab = { path, pinned: mode === 'pinned', dirty: false, missing: false, activatedAt: 0 };

  // A clean preview is a scratch slot: the next preview takes its place instead
  // of growing the strip.
  const previewIndex = mode === 'preview' && session.previewPath
    ? session.tabs.findIndex((tab) => tab.path === session.previewPath && !tab.dirty)
    : -1;
  if (previewIndex >= 0) {
    const replaced = session.tabs[previewIndex]!;
    const tabs = [...session.tabs];
    tabs[previewIndex] = fresh;
    return { session: activate({ ...session, tabs, previewPath: path }, path), evictedPath: replaced.path, overCap: false };
  }

  let tabs = [...session.tabs];
  let evictedPath: string | null = null;
  let overCap = false;
  if (tabs.length >= MAX_OPEN_FILE_TABS) {
    const victim = leastRecentlyActivatedClean(tabs, session.activePath);
    if (victim) {
      evictedPath = victim.path;
      tabs = tabs.filter((tab) => tab.path !== victim.path);
    } else {
      overCap = true;
    }
  }
  tabs.push(fresh);
  const previewPath = mode === 'preview' ? path : session.previewPath;
  const next = activate({ ...session, tabs, previewPath: previewPath === evictedPath ? null : previewPath }, path);
  return { session: next, evictedPath, overCap };
}

export function activateTab(session: FileSession, path: string): FileSession {
  if (!session.tabs.some((tab) => tab.path === path)) return session;
  return activate(session, path);
}

export function pinTab(session: FileSession, path: string): FileSession {
  const tab = session.tabs.find((item) => item.path === path);
  if (!tab || tab.pinned) return session;
  return {
    ...session,
    tabs: session.tabs.map((item) => (item.path === path ? { ...item, pinned: true } : item)),
    previewPath: session.previewPath === path ? null : session.previewPath,
  };
}

/** Marking a tab dirty always pins it, so an edited preview is never replaced. */
export function setTabDirty(session: FileSession, path: string, dirty: boolean): FileSession {
  const tab = session.tabs.find((item) => item.path === path);
  if (!tab || tab.dirty === dirty) return session;
  const tabs = session.tabs.map((item) => (item.path === path ? { ...item, dirty, pinned: dirty ? true : item.pinned } : item));
  return { ...session, tabs, previewPath: dirty && session.previewPath === path ? null : session.previewPath };
}

export function setTabMissing(session: FileSession, path: string, missing: boolean): FileSession {
  const tab = session.tabs.find((item) => item.path === path);
  if (!tab || tab.missing === missing) return session;
  return { ...session, tabs: session.tabs.map((item) => (item.path === path ? { ...item, missing } : item)) };
}

export function closeTab(session: FileSession, path: string): CloseResult {
  const index = session.tabs.findIndex((tab) => tab.path === path);
  if (index < 0) return { session, activePath: session.activePath };
  const tabs = session.tabs.filter((tab) => tab.path !== path);
  const previewPath = session.previewPath === path ? null : session.previewPath;
  if (session.activePath !== path) return { session: { ...session, tabs, previewPath }, activePath: session.activePath };
  const neighbor = tabs[index] ?? tabs[index - 1] ?? null;
  const next = { ...session, tabs, previewPath, activePath: neighbor ? neighbor.path : null };
  return { session: neighbor ? activate(next, neighbor.path) : next, activePath: neighbor ? neighbor.path : null };
}

/** Manual reordering. Active, preview, dirty state, and drafts are untouched. */
export function moveTab(session: FileSession, path: string, toIndex: number): FileSession {
  const fromIndex = session.tabs.findIndex((tab) => tab.path === path);
  if (fromIndex < 0) return session;
  const target = Math.max(0, Math.min(session.tabs.length - 1, toIndex));
  if (target === fromIndex) return session;
  const tabs = [...session.tabs];
  const [moved] = tabs.splice(fromIndex, 1);
  tabs.splice(target, 0, moved!);
  return { ...session, tabs };
}

export interface TabPathChange { from: string; to: string }

/**
 * Applies filesystem renames and moves to every affected tab, including tabs
 * nested under a renamed directory. A rename that collides with an already-open
 * tab keeps the earlier tab rather than creating a duplicate.
 */
export function renameTabPaths(session: FileSession, changes: readonly TabPathChange[]): { session: FileSession; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  if (changes.length === 0) return { session, renamed };

  const mapped = session.tabs.map((tab) => {
    const next = applyPathChanges(tab.path, changes);
    if (next !== tab.path) renamed.set(tab.path, next);
    return next === tab.path ? tab : { ...tab, path: next };
  });
  if (renamed.size === 0) return { session, renamed };

  const seen = new Set<string>();
  const tabs: RuntimeTab[] = [];
  for (const tab of mapped) {
    if (seen.has(tab.path)) continue;
    seen.add(tab.path);
    tabs.push(tab);
  }
  const remap = (value: string | null): string | null => {
    if (!value) return null;
    const next = renamed.get(value) ?? value;
    return seen.has(next) ? next : null;
  };
  return { session: { ...session, tabs, activePath: remap(session.activePath), previewPath: remap(session.previewPath) }, renamed };
}

/**
 * Reconciles tabs whose files are gone. Clean tabs close; a dirty tab stays open
 * and is flagged missing so its unsaved text can still be read and copied.
 */
export function removeTabsUnder(session: FileSession, removedPaths: readonly string[]): RemoveResult {
  if (removedPaths.length === 0) return { session, closedPaths: [], retainedPaths: [] };
  const closedPaths: string[] = [];
  const retainedPaths: string[] = [];
  let next = session;
  for (const tab of session.tabs) {
    if (!removedPaths.some((removed) => isSameOrUnder(removed, tab.path))) continue;
    if (tab.dirty) {
      if (!tab.missing) retainedPaths.push(tab.path);
      next = setTabMissing(next, tab.path, true);
    } else {
      closedPaths.push(tab.path);
      next = closeTab(next, tab.path).session;
    }
  }
  return { session: next, closedPaths, retainedPaths };
}

/** Marks tabs present again after a snapshot shows their files back on disk. */
export function markTabsPresent(session: FileSession, presentPaths: ReadonlySet<string>): FileSession {
  let next = session;
  for (const tab of session.tabs) {
    if (tab.missing && presentPaths.has(tab.path)) next = setTabMissing(next, tab.path, false);
  }
  return next;
}

export function restoreSession(state: OpenFilesState | null | undefined): FileSession {
  if (!state) return emptyFileSession;
  const tabs = state.tabs.map((tab, index) => ({ path: tab.path, pinned: tab.pinned, dirty: false, missing: false, activatedAt: index + 1 }));
  if (tabs.length === 0) return emptyFileSession;
  const activePath = tabs.some((tab) => tab.path === state.activePath) ? state.activePath : null;
  const previewPath = tabs.some((tab) => tab.path === state.previewPath && !tab.pinned) ? state.previewPath : null;
  return { tabs, activePath, previewPath, activationCounter: tabs.length + 1 };
}

/** Serializes to the persisted shape: no dirty text, no runtime-only fields. */
export function serializeSession(session: FileSession): { tabs: OpenFileTab[]; activePath: string | null; previewPath: string | null } {
  return {
    tabs: session.tabs.map((tab) => ({ path: tab.path, pinned: tab.pinned })),
    activePath: session.activePath,
    previewPath: session.previewPath,
  };
}

/**
 * Shortest parent suffix that tells duplicate basenames apart, so `index.ts`
 * from two folders reads as `index.ts — src/a` and `index.ts — src/b`.
 */
export function tabLabels(tabs: readonly RuntimeTab[]): Map<string, { name: string; suffix: string | null }> {
  const byName = new Map<string, string[]>();
  for (const tab of tabs) {
    const name = basename(tab.path);
    const group = byName.get(name);
    if (group) group.push(tab.path);
    else byName.set(name, [tab.path]);
  }
  const labels = new Map<string, { name: string; suffix: string | null }>();
  for (const [name, paths] of byName) {
    if (paths.length === 1) {
      labels.set(paths[0]!, { name, suffix: null });
      continue;
    }
    for (const path of paths) {
      labels.set(path, { name, suffix: disambiguatingSuffix(path, paths) });
    }
  }
  return labels;
}

export function applyKeyboardAction(session: FileSession, action: TabKeyboardAction): KeyboardResult {
  const index = session.tabs.findIndex((tab) => tab.path === session.activePath);
  if (index < 0) return { session, closeRequest: null };
  switch (action) {
    case 'close':
      return { session, closeRequest: session.activePath };
    case 'next':
    case 'previous': {
      const step = action === 'next' ? 1 : -1;
      const target = session.tabs[(index + step + session.tabs.length) % session.tabs.length]!;
      return { session: activate(session, target.path), closeRequest: null };
    }
    case 'move-left':
    case 'move-right': {
      const target = index + (action === 'move-left' ? -1 : 1);
      if (target < 0 || target >= session.tabs.length) return { session, closeRequest: null };
      return { session: moveTab(session, session.tabs[index]!.path, target), closeRequest: null };
    }
  }
}

/** UTF-16 in-memory cost, cheap enough to run on every draft change. */
export function draftBytes(content: string): number {
  return content.length * 2;
}

export function isSameOrUnder(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

/**
 * Open tabs with unsaved changes at or under the given paths, including tabs
 * that are not on screen. Any operation that rewrites, moves, or deletes files
 * has to consult this rather than whichever file the viewer happens to show.
 */
export function dirtyTabsUnder(session: FileSession, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  return session.tabs
    .filter((tab) => tab.dirty && paths.some((parent) => isSameOrUnder(parent, tab.path)))
    .map((tab) => tab.path);
}

export function dirtyTabs(session: FileSession): string[] {
  return session.tabs.filter((tab) => tab.dirty).map((tab) => tab.path);
}

// --- Strip geometry -------------------------------------------------------
// The strip lives in the window drag region and hides its scrollbar, so its
// scrolling is computed here and unit tested without a DOM.

export interface StripMetrics { scrollLeft: number; clientWidth: number; scrollWidth: number }

/** Returns the horizontal delta to apply, or null to leave the event alone. */
export function horizontalWheelDelta(metrics: StripMetrics, deltaX: number, deltaY: number): number | null {
  if (metrics.scrollWidth <= metrics.clientWidth) return null;
  if (Math.abs(deltaX) > Math.abs(deltaY)) return null;
  return deltaY === 0 ? null : deltaY;
}

export function edgeFades(metrics: StripMetrics): { start: boolean; end: boolean } {
  if (metrics.scrollWidth <= metrics.clientWidth) return { start: false, end: false };
  const maxScroll = metrics.scrollWidth - metrics.clientWidth;
  return { start: metrics.scrollLeft > 1, end: metrics.scrollLeft < maxScroll - 1 };
}

export interface TabRect { left: number; width: number }

/** Index a tab dropped at `pointerX` should take, given the measured tabs. */
export function dropIndex(rects: readonly TabRect[], pointerX: number): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]!;
    if (pointerX < rect.left + rect.width / 2) return index;
  }
  return rects.length === 0 ? 0 : rects.length - 1;
}

// --- internals ------------------------------------------------------------

function activate(session: FileSession, path: string): FileSession {
  const activationCounter = session.activationCounter + 1;
  return {
    ...session,
    tabs: session.tabs.map((tab) => (tab.path === path ? { ...tab, activatedAt: activationCounter } : tab)),
    activePath: path,
    activationCounter,
  };
}

function leastRecentlyActivatedClean(tabs: readonly RuntimeTab[], activePath: string | null): RuntimeTab | null {
  let victim: RuntimeTab | null = null;
  for (const tab of tabs) {
    if (tab.dirty || tab.path === activePath) continue;
    if (!victim || tab.activatedAt < victim.activatedAt) victim = tab;
  }
  return victim;
}

function applyPathChanges(value: string, changes: readonly TabPathChange[]): string {
  for (const change of changes) {
    if (!change.from || !change.to) continue;
    if (value === change.from) return change.to;
    if (value.startsWith(`${change.from}/`)) return `${change.to}${value.slice(change.from.length)}`;
  }
  return value;
}

function basename(value: string): string {
  const index = value.lastIndexOf('/');
  return index < 0 ? value : value.slice(index + 1);
}

function disambiguatingSuffix(path: string, siblings: readonly string[]): string | null {
  const segments = path.split('/');
  const others = siblings.filter((item) => item !== path).map((item) => item.split('/'));
  for (let depth = 1; depth < segments.length; depth += 1) {
    const suffix = segments.slice(Math.max(0, segments.length - 1 - depth), segments.length - 1).join('/');
    const collides = others.some((other) => other.slice(Math.max(0, other.length - 1 - depth), other.length - 1).join('/') === suffix);
    if (!collides) return suffix;
  }
  return segments.slice(0, -1).join('/') || null;
}
