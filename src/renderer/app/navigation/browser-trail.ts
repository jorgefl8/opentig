import { isViewerMemorySnapshot } from '@/features/viewer/viewer-memory';
import type { ViewerSelection } from '@/features/viewer/Viewer';
import { addressOf, locationOf, parseAddress, safePath, type AddressTarget } from './address';
import { EMPTY_MEMORY, MAX_SCROLL_MARKS, SIDEBAR_VIEWS, type EntryMemory, type NavigationEntry, type NavigationLocation, type ScrollMark } from './location';
import { createTrailSignals, MAX_TRAIL_ENTRIES, newEntryKey, type NavigationTrail, type TrailStep } from './trail';

const STATE_KEY = 'opentigNavigation';
/**
 * What this tab knows of its trails, kept through reloads: where each step leads, since a page
 * cannot read the other entries of its history, how far each trail goes, and the step last shown.
 * A page load that starts a trail of its own (a pasted address, a bookmark) gives it a new id, kept
 * in each of its history entries, so the steps of one load are never taken for another's.
 */
const STEPS_KEY = 'opentig.navigation.steps';
/** The most steps kept for the tab; the current trail's go last. */
const MAX_KEPT_STEPS = 300;
/** Steps whose memory is kept in the page as well, so a step left by the browser's own Back has its latest. */
const MAX_KEPT_MEMORIES = 200;
/** How long scrolling waits before its position is written into the history entry. */
const MEMORY_WRITE_DELAY_MS = 800;
/** A jump the browser has not made by then never will: its history no longer holds that step. */
const JUMP_ARRIVAL_MS = 1500;

/** A step as the lists of Back and Forward know it. A commit's subject is kept to name it. */
interface KnownStep {
  trail: string;
  index: number;
  key: string;
  location: NavigationLocation;
}

interface PendingJump {
  /** The step it is going to. */
  trail: string;
  target: number;
  /** Running while the jump is waited for; null once it is taken as missed. */
  timer: number | null;
  /** What a jump taken as missed took out of the lists, to put back if it arrives after all. */
  missed: { steps: KnownStep[]; top: number } | null;
}

interface KeptTrails {
  steps: KnownStep[];
  /** The last step of each trail, which Forward cannot go past. */
  tops: Map<string, number>;
  /** The step on screen when the tab last showed one. */
  last: { trail: string; index: number } | null;
}

interface StoredEntry {
  v: 1;
  key: string;
  /** The page load whose trail the entry belongs to; empty in entries written before trails had one. */
  trail: string;
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
export function createBrowserTrail(addressFor: (location: NavigationLocation) => string, { arrivalMs = JUMP_ARRIVAL_MS }: { arrivalMs?: number } = {}): BrowserTrail {
  const signals = createTrailSignals();
  const memories = new Map<string, EntryMemory>();
  let current: NavigationEntry | null = null;
  let trail = '';
  let index = 0;
  let top = 0;
  let writeTimer: number | null = null;
  /**
   * The one jump on its way. Past `arrivalMs` it is taken as missed and its steps leave the lists, but only
   * until it arrives after all, which puts them back: a slow browser is not one that cannot get there.
   */
  let jump: PendingJump | null = null;
  let attached = false;
  /** The address last written, which a pull request's tab can change without the location changing. */
  let writtenUrl: string | null = null;
  let kept = readKeptTrails();
  let keptWritten = '';
  const save = () => {
    const serialized = JSON.stringify({ v: 2, steps: kept.steps, tops: [...kept.tops], last: kept.last });
    if (serialized === keptWritten) return;
    keptWritten = serialized;
    try { window.sessionStorage.setItem(STEPS_KEY, serialized); } catch { /* storage unavailable: the lists know this page's steps only */ }
  };
  /**
   * Continues a trail the history entry names, in a page that was not on it a moment ago: loaded again, or
   * brought back by the browser. What is ahead is offered only as far as the browser is known to still have
   * it, since any page loaded in this tab after the step, the app's or another site's, dropped the rest
   * without telling it. That is up to the step this tab last showed in the trail; and all of it for a reload
   * of that very step, which leaves history as it was.
   */
  const joinTrail = (id: string, position: number, reloaded: boolean) => {
    trail = id;
    index = position;
    const keptTop = Math.max(kept.tops.get(id) ?? position, position);
    const last = kept.last;
    const shownHere = last?.trail === id && last.index === position;
    const known = reloaded && shownHere ? keptTop : last?.trail === id ? Math.min(keptTop, Math.max(last.index, position)) : position;
    top = position;
    setTop(Math.max(position, known));
  };
  /**
   * Starts a trail for this page load. It came after the step last shown, so the browser dropped whatever
   * was ahead of that step, which its trail drops too.
   */
  const startTrail = () => {
    const previous = kept.last;
    if (previous) {
      kept.steps = kept.steps.filter((step) => step.trail !== previous.trail || step.index <= previous.index);
      if ((kept.tops.get(previous.trail) ?? 0) > previous.index) kept.tops.set(previous.trail, previous.index);
    }
    trail = newEntryKey();
    index = 0;
    top = 0;
  };
  const setTop = (value: number) => {
    top = value;
    kept.tops.delete(trail);
    kept.tops.set(trail, value);
    while (kept.tops.size > MAX_KEPT_TRAILS) kept.tops.delete(kept.tops.keys().next().value!);
  };
  /** Notes where the current step leads, and keeps the steps nearest it for a reload, with the other trails' first to go. */
  const know = (entry: { key: string; location: NavigationLocation }) => {
    kept.steps = kept.steps.filter((step) => !(step.trail === trail && (step.index === index || Math.abs(step.index - index) > MAX_TRAIL_ENTRIES)));
    kept.steps.push({ trail, index, key: entry.key, location: entry.location });
    while (kept.steps.length > MAX_KEPT_STEPS) {
      const other = kept.steps.findIndex((step) => step.trail !== trail);
      kept.steps.splice(other >= 0 ? other : 0, 1);
    }
    kept.last = { trail, index };
    if (!kept.tops.has(trail) || kept.tops.get(trail)! < top) setTop(top);
    save();
  };
  const knownAt = (position: number) => kept.steps.find((step) => step.trail === trail && step.index === position);
  /** A new step drops whatever was ahead of it, in the browser's history as in the lists. */
  const forgetFrom = (position: number) => {
    kept.steps = kept.steps.filter((step) => step.trail !== trail || step.index < position);
  };
  /** The page is being left: a jump not yet arrived is not a missed one, and nothing is written for it. */
  const abandonJump = () => {
    if (jump?.timer != null) window.clearTimeout(jump.timer);
    jump = null;
    window.removeEventListener('beforeunload', abandonJump);
  };
  /**
   * A move arrived. Only the jump's own step arriving puts back what its miss took out: any other move,
   * as a Back pressed after a miss, says nothing about the steps the browser did not reach.
   */
  const moveArrived = (stored: StoredEntry | null) => {
    const arrived = jump !== null && stored?.trail === jump.trail && stored.index === jump.target;
    const missed = arrived ? jump?.missed : null;
    abandonJump();
    if (!missed) return;
    const ids = new Set(kept.steps.map((step) => `${step.trail}\n${step.index}`));
    kept.steps.push(...missed.steps.filter((step) => !ids.has(`${step.trail}\n${step.index}`)));
    if (missed.top > top) setTop(missed.top);
  };

  const keep = (key: string, memory: EntryMemory) => {
    memories.delete(key);
    memories.set(key, memory);
    while (memories.size > MAX_KEPT_MEMORIES) memories.delete(memories.keys().next().value!);
  };
  const changed = () => signals.update({ canGoBack: index > 0, canGoForward: index < top });
  const write = (entry: NavigationEntry, mode: 'push' | 'replace') => {
    const stored: StoredEntry = { v: 1, key: entry.key, trail, index, location: storedLocation(entry.location), memory: entry.memory };
    const url = addressFor(entry.location);
    writtenUrl = url;
    know(entry);
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
    moveArrived(stored);
    let entry: NavigationEntry;
    if (stored) {
      if (stored.trail !== trail) joinTrail(stored.trail, stored.index, false);
      index = stored.index;
      if (index > top) setTop(index);
      entry = { key: stored.key, location: stored.location, memory: memories.get(stored.key) ?? stored.memory };
      // What a list said of this step may name a commit by its subject, which the history entry does not keep;
      // a kept step that is not this entry is replaced by it, so the lists say where the browser really is.
      const listed = knownAt(index);
      know(listed?.key === entry.key ? { key: entry.key, location: { ...entry.location, selection: withSubject(entry.location.selection, listed.location.selection) } } : entry);
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
  const onPageHide = () => {
    abandonJump();
    flush();
  };
  /**
   * The browser brought the page back from its cache, as it was when left. Another page load of this tab
   * may have written since, so what the tab keeps is read again before anything is written over it, and the
   * step on screen is joined as any page coming back to it is.
   */
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || !current) return;
    kept = readKeptTrails();
    keptWritten = '';
    joinTrail(trail, index, false);
    know(current);
    changed();
  };

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
      if (stored?.key === entry.key) joinTrail(stored.trail, stored.index, wasReloaded());
      else startTrail();
      know(entry);
      current = entry;
      changed();
    },
    start(location) {
      const stored = readStored(window.history.state);
      if (stored) joinTrail(stored.trail, stored.index, wasReloaded());
      else startTrail();
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
      // Only the steps of this page load's trail that the tab has seen, and only as far as the browser's
      // history still reaches: it keeps a limited number of entries per tab, the oldest going first.
      const ahead = top - index;
      const reachableBack = Math.max(0, Math.min(index, window.history.length - 1 - ahead));
      const step = (position: number): TrailStep | null => {
        const listed = knownAt(position);
        return listed ? { key: listed.key, location: listed.location, memory: memories.get(listed.key) ?? EMPTY_MEMORY, offset: position - index } : null;
      };
      const back: TrailStep[] = [];
      for (let position = index - 1; position >= index - reachableBack && back.length < MAX_TRAIL_ENTRIES; position -= 1) {
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
      // One jump at a time: another asked for before the first arrives is ignored. One taken as missed no
      // longer holds the next back; it gives up its place, and the steps it took out stay out.
      if (jump?.timer != null || !Number.isSafeInteger(offset) || offset === 0 || index + offset < 0 || index + offset > top) return;
      flush();
      const target = index + offset;
      const pending: PendingJump = { trail, target, timer: null, missed: null };
      // A step the browser no longer holds is never reached: nothing moves, so the view and the address still
      // agree, and the step and those past it leave the lists.
      pending.timer = window.setTimeout(() => {
        if (jump !== pending) return;
        pending.timer = null;
        window.removeEventListener('beforeunload', abandonJump);
        const gone = (step: KnownStep) => step.trail === trail && (offset < 0 ? step.index <= target : step.index >= target);
        pending.missed = { steps: kept.steps.filter(gone), top };
        kept.steps = kept.steps.filter((step) => !gone(step));
        if (offset > 0) setTop(target - 1);
        save();
        changed();
        signals.missed();
      }, arrivalMs);
      jump = pending;
      // A step of a page load that is gone loads a page again, which can take longer than the wait.
      window.addEventListener('beforeunload', abandonJump);
      window.history.go(offset);
    },
    onMissedJump: signals.onMissed,
    onRestore: signals.onRestore,
    subscribe: signals.subscribe,
    attach() {
      if (attached) return;
      attached = true;
      // The app puts each step's scroll positions back itself.
      try { window.history.scrollRestoration = 'manual'; } catch { /* not supported */ }
      window.addEventListener('popstate', onPopState);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pageshow', onPageShow);
    },
    detach() {
      abandonJump();
      flush();
      attached = false;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
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

/** Whether this page load is the browser reloading its entry, which leaves the history around it as it was. */
function wasReloaded(): boolean {
  try {
    const [navigation] = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return navigation?.type === 'reload';
  } catch {
    return false;
  }
}

/** The most trails whose last step is kept: a tab rarely has more page loads that history still reaches. */
const MAX_KEPT_TRAILS = 50;
const TRAIL_ID = /^[A-Za-z0-9-]{0,64}$/;

/** What the tab kept of its trails. Written by this page, but read back with the same care as a history entry. */
function readKeptTrails(): KeptTrails {
  const kept: KeptTrails = { steps: [], tops: new Map(), last: null };
  let value: unknown;
  try { value = JSON.parse(window.sessionStorage.getItem(STEPS_KEY) ?? 'null'); }
  catch { return kept; }
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).v !== 2) return kept;
  const record = value as Record<string, unknown>;
  const position = (item: unknown): item is number => Number.isSafeInteger(item) && (item as number) >= 0;
  const trailId = (item: unknown): item is string => typeof item === 'string' && TRAIL_ID.test(item);
  if (Array.isArray(record.steps)) {
    for (const item of record.steps.slice(0, MAX_KEPT_STEPS)) {
      const step = item as Record<string, unknown> | null;
      if (!step || typeof step !== 'object' || !trailId(step.trail) || !position(step.index) || typeof step.key !== 'string' || step.key.length > 64) continue;
      const location = validLocation(step.location);
      if (!location) continue;
      kept.steps.push({ trail: step.trail, index: step.index, key: step.key, location: { ...location, selection: withSubject(location.selection, (step.location as NavigationLocation).selection) } });
    }
  }
  if (Array.isArray(record.tops)) {
    for (const item of record.tops.slice(0, MAX_KEPT_TRAILS)) {
      if (Array.isArray(item) && item.length === 2 && trailId(item[0]) && position(item[1])) kept.tops.set(item[0], item[1]);
    }
  }
  const last = record.last as Record<string, unknown> | null;
  if (last && typeof last === 'object' && trailId(last.trail) && position(last.index)) kept.last = { trail: last.trail, index: last.index };
  return kept;
}

/** A commit's subject, which names it in the lists, when the stored selection had one. */
function withSubject(selection: ViewerSelection, from: ViewerSelection): ViewerSelection {
  if (selection?.type !== 'commit' || from?.type !== 'commit' || from.oid !== selection.oid) return selection;
  return typeof from.subject === 'string' && from.subject.length <= 500 ? { ...selection, subject: from.subject } : selection;
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
  if (stored.trail !== undefined && !(typeof stored.trail === 'string' && TRAIL_ID.test(stored.trail))) return null;
  const location = validLocation(stored.location);
  const memory = validMemory(stored.memory);
  return location && memory ? { v: 1, key: stored.key, trail: typeof stored.trail === 'string' ? stored.trail : '', index: stored.index, location, memory } : null;
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
