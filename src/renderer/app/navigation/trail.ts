import { EMPTY_MEMORY, type EntryMemory, type NavigationEntry, type NavigationLocation } from './location';

/** The most steps the in-memory trail keeps; the oldest go first. */
export const MAX_TRAIL_ENTRIES = 100;

export interface TrailState {
  canGoBack: boolean;
  canGoForward: boolean;
}

/**
 * The steps the user took, and where in them they are. Moving somewhere new
 * adds a step after the current one and drops what was ahead; Back and Forward
 * walk the steps and hand each one to `onRestore` to be shown again.
 */
export interface NavigationTrail {
  current(): NavigationEntry | null;
  state(): TrailState;
  /** Starts the trail where the app opened, or replaces the step it is on. */
  start(location: NavigationLocation): NavigationEntry;
  /** A new step after the current one; whatever was ahead of it is dropped. */
  push(location: NavigationLocation): NavigationEntry;
  /** The current step has moved without being a step of its own. */
  replace(location: NavigationLocation): void;
  /** Keeps what goes with the current step: scroll positions and the viewer's memory. */
  remember(key: string, memory: Partial<EntryMemory>): void;
  back(): void;
  forward(): void;
  /** Called with the step Back or Forward moved to. */
  onRestore(listener: (entry: NavigationEntry) => void): () => void;
  /** For `useSyncExternalStore`: `state()` returns the same object until it changes. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

let keyCounter = 0;
export function newEntryKey(): string {
  keyCounter += 1;
  return `${Date.now().toString(36)}-${keyCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Notifies listeners, and keeps `state()` the same object while nothing changed. */
export function createTrailSignals() {
  const restoreListeners = new Set<(entry: NavigationEntry) => void>();
  const stateListeners = new Set<() => void>();
  let snapshot: TrailState = { canGoBack: false, canGoForward: false };
  return {
    state: () => snapshot,
    update(next: TrailState) {
      if (next.canGoBack === snapshot.canGoBack && next.canGoForward === snapshot.canGoForward) return;
      snapshot = next;
      for (const listener of [...stateListeners]) listener();
    },
    restore(entry: NavigationEntry) {
      for (const listener of [...restoreListeners]) listener(entry);
    },
    onRestore(listener: (entry: NavigationEntry) => void) {
      restoreListeners.add(listener);
      return () => { restoreListeners.delete(listener); };
    },
    subscribe(listener: () => void) {
      stateListeners.add(listener);
      return () => { stateListeners.delete(listener); };
    },
    clear() {
      restoreListeners.clear();
      stateListeners.clear();
    },
  };
}

/** The trail kept in memory, for the desktop app, where there is no address bar, and the website demo. */
export function createMemoryTrail(limit = MAX_TRAIL_ENTRIES): NavigationTrail {
  const entries: NavigationEntry[] = [];
  let index = -1;
  const signals = createTrailSignals();
  const changed = () => signals.update({ canGoBack: index > 0, canGoForward: index >= 0 && index < entries.length - 1 });
  const move = (to: number) => {
    if (to < 0 || to >= entries.length || to === index) return;
    index = to;
    changed();
    signals.restore(entries[index]!);
  };
  return {
    current: () => entries[index] ?? null,
    state: signals.state,
    start(location) {
      const entry = { key: newEntryKey(), location, memory: EMPTY_MEMORY };
      if (index < 0) { entries.push(entry); index = 0; }
      else entries[index] = entry;
      changed();
      return entry;
    },
    push(location) {
      const entry = { key: newEntryKey(), location, memory: EMPTY_MEMORY };
      entries.splice(index + 1, entries.length, entry);
      index = entries.length - 1;
      while (entries.length > limit) { entries.shift(); index -= 1; }
      changed();
      return entry;
    },
    replace(location) {
      const entry = entries[index];
      if (entry) entries[index] = { ...entry, location };
    },
    remember(key, memory) {
      const position = entries.findIndex((entry) => entry.key === key);
      if (position >= 0) entries[position] = { ...entries[position]!, memory: { ...entries[position]!.memory, ...memory } };
    },
    back: () => move(index - 1),
    forward: () => move(index + 1),
    onRestore: signals.onRestore,
    subscribe: signals.subscribe,
    dispose: signals.clear,
  };
}
