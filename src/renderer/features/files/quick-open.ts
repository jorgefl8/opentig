import type { FileTreeEntry } from '@shared/git-types';
import { parentDirectory } from './file-tree';

export interface QuickOpenResult {
  path: string;
  name: string;
  parentPath: string;
}

export interface QuickOpenOptions {
  includeIgnored: boolean;
  activePath?: string | null;
  limit?: number;
}

interface IndexedFile {
  result: QuickOpenResult;
  basename: string;
  fullPath: string;
  depth: number;
  ignored: boolean;
  order: number;
}

/** Owned by one immutable file-tree snapshot; never cache repository paths globally. */
export interface QuickOpenIndex {
  readonly files: readonly IndexedFile[];
}

interface RankedResult {
  file: IndexedFile;
  rank: number[];
}

export function collectQuickOpenFiles(entries: FileTreeEntry[], includeIgnored: boolean): QuickOpenResult[] {
  const files: QuickOpenResult[] = [];
  const visit = (items: FileTreeEntry[]) => {
    for (const entry of items) {
      if (!includeIgnored && entry.ignored) continue;
      if (entry.type === 'directory') visit(entry.children);
      else files.push({ path: entry.path, name: entry.name, parentPath: parentDirectory(entry.path) });
    }
  };
  visit(entries);
  return files;
}

export function createQuickOpenIndex(entries: FileTreeEntry[]): QuickOpenIndex {
  const files: IndexedFile[] = [];
  const visit = (items: FileTreeEntry[], parentIgnored: boolean) => {
    for (const entry of items) {
      const ignored = parentIgnored || Boolean(entry.ignored);
      if (entry.type === 'directory') visit(entry.children, ignored);
      else files.push({
        result: { path: entry.path, name: entry.name, parentPath: parentDirectory(entry.path) },
        basename: normalize(entry.name), fullPath: normalize(entry.path),
        depth: pathDepth(entry.path), ignored, order: 0,
      });
    }
  };
  visit(entries, false);
  // Construct collators once instead of allocating locale options per comparison.
  const base = new Intl.Collator(undefined, { sensitivity: 'base' });
  const exact = new Intl.Collator();
  files.sort((a, b) => base.compare(a.result.path, b.result.path) || exact.compare(a.result.path, b.result.path));
  files.forEach((file, order) => { file.order = order; });
  return { files };
}

export function rankQuickOpenFiles(entries: FileTreeEntry[], query: string, options: QuickOpenOptions): QuickOpenResult[] {
  return rankQuickOpenIndex(createQuickOpenIndex(entries), query, options);
}

export function rankQuickOpenIndex(index: QuickOpenIndex, query: string, options: QuickOpenOptions): QuickOpenResult[] {
  const search = searchQuickOpenIndex(index, query, options);
  let step = search.next();
  while (!step.done) step = search.next();
  return step.value;
}

/** Same ranking pass, with a paint opportunity before work and between 4 ms slices. */
export async function rankQuickOpenIndexAsync(
  index: QuickOpenIndex, query: string, options: QuickOpenOptions, signal: AbortSignal,
): Promise<QuickOpenResult[] | null> {
  const search = searchQuickOpenIndex(index, query, options);
  while (await yieldToBrowser(signal)) {
    const deadline = performance.now() + 4;
    do {
      if (signal.aborted) return null;
      const step = search.next();
      if (step.done) return step.value;
    } while (performance.now() < deadline);
  }
  return null;
}

function yieldToBrowser(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve(!signal.aborted);
    };
    const timer = setTimeout(finish, 0);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function* searchQuickOpenIndex(
  index: QuickOpenIndex,
  query: string,
  { includeIgnored, activePath = null, limit = 100 }: QuickOpenOptions,
): Generator<void, QuickOpenResult[]> {
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (!cappedLimit) return [];
  const normalizedQuery = normalize(query).trim();
  if (!normalizedQuery) {
    const results: QuickOpenResult[] = [];
    if (activePath !== null) {
      for (const file of index.files) {
        if (results.length >= cappedLimit) break;
        if (file.result.path === activePath && (includeIgnored || !file.ignored)) results.push(file.result);
      }
    }
    for (const file of index.files) {
      if (results.length >= cappedLimit) break;
      if (file.result.path !== activePath && (includeIgnored || !file.ignored)) results.push(file.result);
    }
    return results;
  }
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const heap: RankedResult[] = [];
  for (let position = 0; position < index.files.length; position += 1) {
    const file = index.files[position]!;
    if (includeIgnored || !file.ignored) {
      const rank = matchRank(file.basename, file.fullPath, normalizedQuery, compactQuery);
      if (rank) retainBest(heap, { file, rank }, cappedLimit);
    }
    if ((position + 1) % 256 === 0) yield;
  }
  return heap.sort(compareResults).map((item) => item.file.result);
}

function compareResults(a: RankedResult, b: RankedResult): number {
  return compareRank(a.rank, b.rank) || a.file.depth - b.file.depth || a.file.order - b.file.order;
}

/** Max-heap: only the best k matches survive; path order preserves stable ties. */
function retainBest(heap: RankedResult[], item: RankedResult, limit: number): void {
  if (heap.length < limit) {
    let position = heap.length;
    heap.push(item);
    while (position > 0) {
      const parent = Math.floor((position - 1) / 2);
      if (compareResults(heap[parent]!, item) >= 0) break;
      heap[position] = heap[parent]!;
      position = parent;
    }
    heap[position] = item;
    return;
  }
  if (compareResults(item, heap[0]!) >= 0) return;
  let position = 0;
  while (position * 2 + 1 < heap.length) {
    const left = position * 2 + 1;
    const right = left + 1;
    const child = right < heap.length && compareResults(heap[right]!, heap[left]!) > 0 ? right : left;
    if (compareResults(heap[child]!, item) <= 0) break;
    heap[position] = heap[child]!;
    position = child;
  }
  heap[position] = item;
}

function matchRank(basename: string, fullPath: string, query: string, compactQuery: string): number[] | null {
  if (basename === query) return [0, 0, 0, 0];
  if (basename.startsWith(query)) return [1, 0, basename.length - query.length, 0];
  const basenameIndex = basename.indexOf(query);
  if (basenameIndex >= 0) return [2, basenameIndex, basename.length - query.length, 0];
  const pathIndex = fullPath.indexOf(query);
  if (pathIndex >= 0) return [3, pathIndex, fullPath.length - query.length, 0];
  const basenameFuzzy = subsequenceRank(basename, compactQuery);
  if (basenameFuzzy) return [4, ...basenameFuzzy];
  const pathFuzzy = subsequenceRank(fullPath, compactQuery);
  return pathFuzzy ? [5, ...pathFuzzy] : null;
}

function subsequenceRank(candidate: string, query: string): number[] | null {
  if (!query) return null;
  let previous = -1;
  let start = -1;
  let gaps = 0;
  let contiguous = 0;
  for (const character of query) {
    const index = candidate.indexOf(character, previous + 1);
    if (index < 0) return null;
    if (start < 0) start = index;
    if (previous >= 0) {
      gaps += index - previous - 1;
      if (index === previous + 1) contiguous += 1;
    }
    previous = index;
  }
  return [gaps, -contiguous, start, candidate.length - query.length];
}

function compareRank(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').toLocaleLowerCase();
}

function pathDepth(filePath: string): number {
  return filePath.split('/').length;
}
