/**
 * How a document was left in the viewer, so opening it again shows it the same
 * way: a pull request's tab, and which files of a diff were folded. Small values
 * only, kept in memory for the session, oldest first out past `MAX_DOCUMENTS`.
 */
const MAX_DOCUMENTS = 100;

class BoundedMemory<Value> {
  private readonly entries = new Map<string, Value>();

  get(key: string): Value | undefined {
    return this.entries.get(key);
  }

  clear(): void {
    this.entries.clear();
  }

  set(key: string, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_DOCUMENTS) this.entries.delete(this.entries.keys().next().value!);
  }
}

const tabs = new BoundedMemory<string>();
const folded = new BoundedMemory<{ folded: ReadonlySet<string>; known: ReadonlySet<string> }>();

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

/** Forgets everything, as a new session would. */
export function forgetViewerMemory(): void {
  tabs.clear();
  folded.clear();
}
