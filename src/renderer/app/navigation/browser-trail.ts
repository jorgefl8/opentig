import { isViewerMemorySnapshot } from '@/features/viewer/viewer-memory';
import type { ViewerSelection } from '@/features/viewer/Viewer';
import { addressOf, locationOf, parseAddress, safePath, type AddressTarget } from './address';
import { EMPTY_MEMORY, MAX_SCROLL_MARKS, SIDEBAR_VIEWS, type EntryMemory, type NavigationEntry, type NavigationLocation, type ScrollMark } from './location';
import { createTrailSignals, MAX_TRAIL_ENTRIES, newEntryKey, type NavigationTrail, type TrailStep } from './trail';

const STATE_KEY = 'opentigNavigation';
/** The last step of this tab's trail, which Forward cannot go past. Kept per tab, through reloads. */
const TOP_KEY = 'opentig.navigation.top';
/**
 * Where each step of this tab's trail leads, by its place in the history, so Back and Forward
 * can list them: a page cannot read the other entries of its history. Kept per tab, through reloads.
 */
const STEPS_KEY = 'opentig.navigation.steps';
/** Steps whose memory is kept in the page as well, so a step left by the browser's own Back has its latest. */
const MAX_KEPT_MEMORIES = 200;
/** How long scrolling waits before its position is written into the history entry. */
const MEMORY_WRITE_DELAY_MS = 800;

/** A step as the lists of Back and Forward know it. A commit's subject is kept to name it. */
interface KnownStep {
  key: string;
  location: NavigationLocation;
}

interface StoredEntry {
  v: 1;
  key: string;
  index: number;
  location: NavigationLocation;
  memory: EntryMemory;
}

export interface BrowserTrail extends NavigationTrail {
  /** The step the page opened on: the history entry's own after a reload, or else the address. */
  initial(): { entry: NavigationEntry | null; malformed: boolean };
  /** Makes the page's step the current one without changing the address, while it is opened. */
  adopt(entry: NavigationEntry): void;
}

/**
 * The trail kept in the browser's own history, for the web build: each step is a
 * history entry whose address says where it is (see `address.ts`) and whose state
 * keeps its location and memory, so the browser's Back, Forward and swipe, a
 * reload, and the app's arrows all walk the same steps. Scrolling and other
 * changes within a step replace its entry; only a step pushes one.
 */
export function createBrowserTrail(addressFor: (location: NavigationLocation) => string): BrowserTrail {
  const signals = createTrailSignals();
  const memories = new Map<string, EntryMemory>();
  let current: NavigationEntry | null = null;
  let index = 0;
  let top = readTop();
  let writeTimer: number | null = null;
  let attached = false;
  /** The address last written, which a pull request's tab can change without the location changing. */
  let writtenUrl: string | null = null;
  const known = readKnownSteps();
  let knownWritten = '';
  /** Notes where the step at `position` leads, and keeps the steps nearest the current one for a reload. */
  const know = (position: number, entry: { key: string; location: NavigationLocation }) => {
    known.set(position, { key: entry.key, location: entry.location });
    for (const other of [...known.keys()]) if (Math.abs(other - index) > MAX_TRAIL_ENTRIES) known.delete(other);
    const serialized = JSON.stringify([...known]);
    if (serialized === knownWritten) return;
    knownWritten = serialized;
    try { window.sessionStorage.setItem(STEPS_KEY, serialized); } catch { /* storage unavailable: the lists know this page's steps only */ }
  };
  /** A new step drops whatever was ahead of it, in the browser's history as in the lists. */
  const forgetFrom = (position: number) => {
    for (const other of [...known.keys()]) if (other >= position) known.delete(other);
  };

  const keep = (key: string, memory: EntryMemory) => {
    memories.delete(key);
    memories.set(key, memory);
    while (memories.size > MAX_KEPT_MEMORIES) memories.delete(memories.keys().next().value!);
  };
  const changed = () => signals.update({ canGoBack: index > 0, canGoForward: index < top });
  const setTop = (value: number) => {
    top = value;
    try { window.sessionStorage.setItem(TOP_KEY, String(value)); } catch { /* storage unavailable: Forward is known for this page only */ }
  };
  const write = (entry: NavigationEntry, mode: 'push' | 'replace') => {
    const stored: StoredEntry = { v: 1, key: entry.key, index, location: storedLocation(entry.location), memory: entry.memory };
    const url = addressFor(entry.location);
    writtenUrl = url;
    know(index, entry);
    try {
      if (mode === 'push') window.history.pushState({ [STATE_KEY]: stored }, '', url);
      else window.history.replaceState({ [STATE_KEY]: stored }, '', url);
    } catch {
      // A browser that limits how often history may be written keeps the step in memory instead.
    }
  };
  const flush = () => {
    if (writeTimer !== null) { window.clearTimeout(writeTimer); writeTimer = null; }
    if (current) write(current, 'replace');
  };
  const onPopState = (event: PopStateEvent) => {
    if (writeTimer !== null) { window.clearTimeout(writeTimer); writeTimer = null; }
    const stored = readStored(event.state);
    let entry: NavigationEntry;
    if (stored) {
      index = stored.index;
      if (index > top) setTop(index);
      entry = { key: stored.key, location: stored.location, memory: memories.get(stored.key) ?? stored.memory };
      // What a list said of this step may name a commit by its subject, which the history entry does not keep.
      const listed = known.get(index);
      know(index, listed?.key === entry.key ? { key: entry.key, location: { ...entry.location, selection: withSubject(entry.location.selection, listed.location.selection) } } : entry);
    } else {
      // An address typed or edited by hand: a new step after the one it was typed over.
      const parsed = parseAddress(window.location.pathname, window.location.search, window.location.hash);
      if (parsed.kind !== 'target') return;
      index += 1;
      setTop(index);
      forgetFrom(index);
      entry = entryOf(parsed.target);
      write(entry, 'replace');
    }
    current = entry;
    changed();
    signals.restore(entry);
  };
  const onPageHide = () => flush();

  return {
    current: () => current,
    state: signals.state,
    initial() {
      const stored = readStored(window.history.state);
      if (stored) return { entry: { key: stored.key, location: stored.location, memory: stored.memory }, malformed: false };
      const parsed = parseAddress(window.location.pathname, window.location.search, window.location.hash);
      if (parsed.kind === 'target') return { entry: entryOf(parsed.target), malformed: false };
      return { entry: null, malformed: parsed.kind === 'malformed' };
    },
    adopt(entry) {
      const stored = readStored(window.history.state);
      // A reload keeps its place in the trail; a pasted address starts one.
      if (stored?.key === entry.key) {
        index = stored.index;
        if (index > top) setTop(index);
      } else {
        index = 0;
        setTop(0);
        known.clear();
      }
      know(index, entry);
      current = entry;
      changed();
    },
    start(location) {
      const stored = readStored(window.history.state);
      index = stored ? stored.index : 0;
      if (!stored) setTop(0);
      current = { key: newEntryKey(), location, memory: EMPTY_MEMORY };
      write(current, 'replace');
      changed();
      return current;
    },
    push(location) {
      flush();
      index += 1;
      setTop(index);
      forgetFrom(index);
      current = { key: newEntryKey(), location, memory: EMPTY_MEMORY };
      write(current, 'push');
      changed();
      return current;
    },
    replace(location) {
      if (!current) return;
      const same = JSON.stringify(current.location) === JSON.stringify(location);
      current = { ...current, location };
      if (!same || writtenUrl !== addressFor(location)) flush();
    },
    remember(key, memory) {
      const base = current?.key === key ? current.memory : memories.get(key) ?? EMPTY_MEMORY;
      const merged = { ...base, ...memory };
      keep(key, merged);
      if (current?.key !== key) return;
      current = { ...current, memory: merged };
      if (writeTimer === null) writeTimer = window.setTimeout(flush, MEMORY_WRITE_DELAY_MS);
    },
    back() {
      if (index <= 0) return;
      flush();
      window.history.back();
    },
    forward() {
      if (index >= top) return;
      flush();
      window.history.forward();
    },
    steps() {
      // Only the steps this tab has seen are listed; the browser still walks the ones it has not.
      const step = (position: number): TrailStep | null => {
        const listed = known.get(position);
        return listed ? { ...listed, memory: memories.get(listed.key) ?? EMPTY_MEMORY, offset: position - index } : null;
      };
      const back: TrailStep[] = [];
      for (let position = index - 1; position >= 0 && back.length < MAX_TRAIL_ENTRIES; position -= 1) {
        const found = step(position);
        if (found) back.push(found);
      }
      const forward: TrailStep[] = [];
      for (let position = index + 1; position <= top && forward.length < MAX_TRAIL_ENTRIES; position += 1) {
        const found = step(position);
        if (found) forward.push(found);
      }
      return { back, forward };
    },
    go(offset) {
      // The browser moves through its own history, so the address and what its Back and Forward do stay in step.
      if (!Number.isSafeInteger(offset) || offset === 0 || index + offset < 0 || index + offset > top) return;
      flush();
      window.history.go(offset);
    },
    onRestore: signals.onRestore,
    subscribe: signals.subscribe,
    attach() {
      if (attached) return;
      attached = true;
      // The app puts each step's scroll positions back itself.
      try { window.history.scrollRestoration = 'manual'; } catch { /* not supported */ }
      window.addEventListener('popstate', onPopState);
      window.addEventListener('pagehide', onPageHide);
    },
    detach() {
      flush();
      attached = false;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}

/** What a step keeps in the browser's history: only what brings it back, so not a commit's subject. */
function storedLocation(location: NavigationLocation): NavigationLocation {
  const strip = (selection: ViewerSelection): ViewerSelection => selection?.type === 'commit' ? { ...selection, subject: '' } : selection;
  return {
    ...location,
    selection: strip(location.selection),
    fileHistory: location.fileHistory ? { ...location.fileHistory, returnTo: { ...location.fileHistory.returnTo, selection: strip(location.fileHistory.returnTo.selection) } } : null,
  };
}

function readKnownSteps(): Map<number, KnownStep> {
  const steps = new Map<number, KnownStep>();
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STEPS_KEY) ?? '[]');
    if (!Array.isArray(value)) return steps;
    // Written by this page, but read back with the same care as a history entry.
    for (const item of value.slice(0, 2 * MAX_TRAIL_ENTRIES + 1)) {
      if (!Array.isArray(item) || item.length !== 2 || !Number.isSafeInteger(item[0]) || item[0] < 0) continue;
      const step = item[1] as Record<string, unknown> | null;
      if (!step || typeof step !== 'object' || typeof step.key !== 'string' || step.key.length > 64) continue;
      const location = validLocation(step.location);
      if (!location) continue;
      steps.set(item[0], { key: step.key, location: { ...location, selection: withSubject(location.selection, (step.location as NavigationLocation).selection) } });
    }
  } catch {
    // Unreadable or unavailable: the lists start from this page.
  }
  return steps;
}

/** A commit's subject, which names it in the lists, when the stored selection had one. */
function withSubject(selection: ViewerSelection, from: ViewerSelection): ViewerSelection {
  if (selection?.type !== 'commit' || from?.type !== 'commit' || from.oid !== selection.oid) return selection;
  return typeof from.subject === 'string' && from.subject.length <= 500 ? { ...selection, subject: from.subject } : selection;
}

function readTop(): number {
  try {
    const value = Number(window.sessionStorage.getItem(TOP_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** A step from an address: its pull request's tab goes with it as the viewer's memory. */
function entryOf(target: AddressTarget): NavigationEntry {
  const location = locationOf(target);
  const selection = target.selection;
  const viewer = selection?.type === 'pull-request' && target.pullTab
    ? { tabs: [[`${target.repositoryId}:pull:${selection.number}`, target.pullTab === 'code' ? 'diff' : target.pullTab]] as Array<[string, string]> }
    : {};
  return { key: newEntryKey(), location, memory: { scroll: [], viewer } };
}

/**
 * A step read back from the browser's history. The state may come from an older
 * version of OpenTig, or have been written by another page of this origin, so
 * its whole shape is checked, with the same rules an address goes through.
 */
function readStored(state: unknown): StoredEntry | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[STATE_KEY];
  if (!value || typeof value !== 'object') return null;
  const stored = value as Record<string, unknown>;
  if (stored.v !== 1 || typeof stored.key !== 'string' || stored.key.length > 64) return null;
  if (typeof stored.index !== 'number' || !Number.isSafeInteger(stored.index) || stored.index < 0) return null;
  const location = validLocation(stored.location);
  const memory = validMemory(stored.memory);
  return location && memory ? { v: 1, key: stored.key, index: stored.index, location, memory } : null;
}

function validLocation(value: unknown): NavigationLocation | null {
  if (!value || typeof value !== 'object') return null;
  const location = value as Record<string, unknown>;
  if (typeof location.repositoryId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(location.repositoryId)) return null;
  if (!isView(location.view) || (location.pane !== 'list' && location.pane !== 'viewer')) return null;
  if (location.line !== null && !(typeof location.line === 'number' && Number.isSafeInteger(location.line) && location.line > 0 && location.line <= 10_000_000)) return null;
  const selection = validSelection(location.selection);
  if (selection === undefined) return null;
  let fileHistory: NavigationLocation['fileHistory'] = null;
  if (location.fileHistory !== null) {
    const history = location.fileHistory as Record<string, unknown> | undefined;
    if (!history || typeof history !== 'object' || typeof history.path !== 'string' || !safePath(history.path)) return null;
    const returnTo = history.returnTo as Record<string, unknown> | undefined;
    const returnSelection = returnTo && typeof returnTo === 'object' ? validSelection(returnTo.selection) : undefined;
    fileHistory = {
      path: history.path,
      returnTo: returnTo && isView(returnTo.view) && returnSelection !== undefined ? { view: returnTo.view, selection: returnSelection } : { view: 'history', selection: null },
    };
  }
  return { repositoryId: location.repositoryId, view: location.view, selection, fileHistory, line: location.line as number | null, pane: location.pane };
}

function isView(value: unknown): value is NavigationLocation['view'] {
  return (SIDEBAR_VIEWS as readonly unknown[]).includes(value);
}

/**
 * A selection read back from history, held to the address rules: written as an
 * address and read back, it must say the same. Undefined when it does not.
 */
function validSelection(value: unknown): ViewerSelection | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as NonNullable<ViewerSelection>;
  try {
    const url = new URL(addressOf({ repositoryId: 'r', view: 'files', selection: candidate, fileHistory: null, line: null, pane: 'viewer' }), 'http://opentig.invalid');
    const parsed = parseAddress(url.pathname, url.search, url.hash);
    if (parsed.kind !== 'target' || !parsed.target.selection) return undefined;
    if (JSON.stringify(comparable(parsed.target.selection)) !== JSON.stringify(comparable(candidate))) return undefined;
  } catch {
    return undefined;
  }
  // A commit's subject is only its label until History has it, and is not kept: the short id stands in.
  if (candidate.type === 'commit') return { type: 'commit', oid: candidate.oid, subject: candidate.oid.slice(0, 8) };
  return candidate;
}

/** What identifies a selection: a commit's subject is only a label, and a file's old path the same as its path is no old path. */
function comparable(selection: NonNullable<ViewerSelection>): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...selection };
  if (selection.type === 'commit') delete fields.subject;
  if (selection.type === 'commit-file' && (!selection.oldPath || selection.oldPath === selection.path)) delete fields.oldPath;
  if (selection.type === 'workflow-run' && !selection.jobId) delete fields.jobId;
  return Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]]));
}

function validMemory(value: unknown): EntryMemory | null {
  if (!value || typeof value !== 'object') return null;
  const memory = value as Record<string, unknown>;
  if (!Array.isArray(memory.scroll) || memory.scroll.length > MAX_SCROLL_MARKS || !memory.scroll.every(isScrollMark)) return null;
  if (!isViewerMemorySnapshot(memory.viewer)) return null;
  return { scroll: memory.scroll, viewer: memory.viewer };
}

function isScrollMark(value: unknown): value is ScrollMark {
  if (!value || typeof value !== 'object') return false;
  const mark = value as Record<string, unknown>;
  const number = (item: unknown) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item < 1e8;
  return (mark.area === 'list' || mark.area === 'viewer') && typeof mark.identity === 'string' && mark.identity.length <= 100
    && Array.isArray(mark.path) && mark.path.length <= 64 && mark.path.every((index) => Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < 100_000)
    && number(mark.top) && number(mark.left);
}
