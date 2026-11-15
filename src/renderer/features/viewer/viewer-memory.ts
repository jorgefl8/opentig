/**
 * How a document was left in the viewer, so opening it again shows it the same
 * way: a pull request's tab, and which files of a diff were folded. Small values
 * only, kept in memory for the session, oldest first out past `MAX_DOCUMENTS`.
 *
 * Going Back also brings a document back as it was at that step: the trail keeps
 * a snapshot of these values with each step (`snapshotViewerMemory`) and puts it
 * back before the document opens again (`restoreViewerMemory`). What a document
 * only shows again when Back asks for it, such as a commit's unfolded files or a
 * run's open job log, is noted as it changes and handed back once.
 */
const MAX_DOCUMENTS = 100;
/** A diff with more files than this is not kept in a step: its folds are left as they are. */
const MAX_SNAPSHOT_FILES = 500;

class BoundedMemory<Value> {
  private readonly entries = new Map<string, Value>();

  get(key: string): Value | undefined {
    return this.entries.get(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  set(key: string, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_DOCUMENTS) this.entries.delete(this.entries.keys().next().value!);
  }

  *matching(prefix: string): Generator<[string, Value]> {
    for (const entry of this.entries) if (entry[0] === prefix || entry[0].startsWith(`${prefix}:`)) yield entry;
  }
}

const tabs = new BoundedMemory<string>();
const folded = new BoundedMemory<{ folded: ReadonlySet<string>; known: ReadonlySet<string> }>();
/** What a document shows now that only Back brings back. */
const views = new BoundedMemory<ViewStateValue>();
/** Put here by Back, read once by the document as it opens. */
const restored = new BoundedMemory<ViewStateValue>();

/** Plain JSON, so a step can keep it in the browser's history. */
export type ViewStateValue = string | number | boolean | null | ViewStateValue[] | { [key: string]: ViewStateValue };

export interface ViewerMemorySnapshot {
  tabs?: Array<[string, string]>;
  folds?: Array<[string, { folded: string[]; known: string[] }]>;
  views?: Array<[string, ViewStateValue]>;
}

export function rememberedTab<Tab extends string>(documentKey: string, allowed: readonly Tab[]): Tab | null {
  const tab = tabs.get(documentKey);
  return tab !== undefined && (allowed as readonly string[]).includes(tab) ? tab as Tab : null;
}

export function rememberTab(documentKey: string, tab: string): void {
  tabs.set(documentKey, tab);
}

/** The files left folded in a diff, by their key; undefined when this diff was never changed by hand. */
export function rememberedFolds(documentKey: string): ReadonlySet<string> | undefined {
  return folded.get(documentKey)?.folded;
}

/** Whether the diff had this file when its folds were remembered. */
export function rememberedKnown(documentKey: string, fileKey: string): boolean {
  return folded.get(documentKey)?.known.has(fileKey) === true;
}

export function rememberFolds(documentKey: string, keys: ReadonlySet<string>, allKeys: readonly string[]): void {
  folded.set(documentKey, { folded: new Set(keys), known: new Set(allKeys) });
}

/** Notes what a document shows now, for the step it is shown in. From here on it opens as the user left it. */
export function noteViewState(documentKey: string, value: ViewStateValue): void {
  views.set(documentKey, value);
  restored.delete(documentKey);
}

/**
 * What Back asked a document to show again as it opens; undefined when it opens as it normally does.
 * It stays until the document changes it or the user goes somewhere new, since a document can be
 * mounted more than once while its code and content arrive.
 */
export function restoredViewState(documentKey: string): ViewStateValue | undefined {
  return restored.get(documentKey);
}

/** The user went somewhere new: what Back had put back no longer applies. */
export function forgetRestoredViewStates(): void {
  restored.clear();
}

/** Everything kept for the documents under `prefix` (`<repository>:pull:24` covers that pull request's tab and folds). */
export function snapshotViewerMemory(prefix: string | null): ViewerMemorySnapshot {
  if (!prefix) return {};
  const snapshot: ViewerMemorySnapshot = {};
  const tabEntries = [...tabs.matching(prefix)];
  if (tabEntries.length) snapshot.tabs = tabEntries;
  const foldEntries = [...folded.matching(prefix)]
    .filter(([, value]) => value.known.size <= MAX_SNAPSHOT_FILES)
    .map(([key, value]): [string, { folded: string[]; known: string[] }] => [key, { folded: [...value.folded], known: [...value.known] }]);
  if (foldEntries.length) snapshot.folds = foldEntries;
  const viewEntries = [...views.matching(prefix)];
  if (viewEntries.length) snapshot.views = viewEntries;
  return snapshot;
}

/** Puts a step's snapshot back, so the documents it covers open as they were left at that step. */
export function restoreViewerMemory(snapshot: ViewerMemorySnapshot): void {
  restored.clear();
  for (const [key, tab] of snapshot.tabs ?? []) tabs.set(key, tab);
  for (const [key, value] of snapshot.folds ?? []) folded.set(key, { folded: new Set(value.folded), known: new Set(value.known) });
  for (const [key, value] of snapshot.views ?? []) {
    views.set(key, value);
    restored.set(key, value);
  }
}

/** Whether a value read back from the browser's history has the snapshot's shape. */
export function isViewerMemorySnapshot(value: unknown): value is ViewerMemorySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const pairs = (list: unknown, check: (item: unknown) => boolean) => list === undefined
    || (Array.isArray(list) && list.length <= MAX_DOCUMENTS && list.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && check(pair[1])));
  const strings = (list: unknown) => Array.isArray(list) && list.length <= MAX_SNAPSHOT_FILES && list.every((item) => typeof item === 'string');
  return pairs(record.tabs, (tab) => typeof tab === 'string')
    && pairs(record.folds, (fold) => Boolean(fold) && typeof fold === 'object' && strings((fold as Record<string, unknown>).folded) && strings((fold as Record<string, unknown>).known))
    && pairs(record.views, () => true);
}

/** Forgets everything, as a new session would. */
export function forgetViewerMemory(): void {
  tabs.clear();
  folded.clear();
  views.clear();
  restored.clear();
}
