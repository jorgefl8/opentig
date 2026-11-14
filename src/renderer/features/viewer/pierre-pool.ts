import { preloadHighlighter, type SupportedLanguages } from '@pierre/diffs';
import { WorkerPoolManager } from '@pierre/diffs/worker';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import { isLowEndDevice, type DeviceHints } from '@/lib/low-end-device';
import { OPENTIG_CODE_THEMES } from './diffThemes';
import { resolvePierreLanguage } from './pierreLanguages';

export interface HighlightPoolSettings {
  /** Workers that tokenize off the main thread. */
  poolSize: number;
  /** Highlighted files, and as many diffs, kept for the next time they are shown. */
  cacheEntries: number;
  /** Lines those kept files, and those diffs, may add up to. */
  cacheLines: number;
  /** Up to this size a file or a diff is tokenized where it is drawn, so it is never painted without colors. */
  mainThreadMaxCharacters: number;
}

/**
 * A low-end phone keeps one worker and a short memory. Everything else gets a
 * worker for every two cores, between two and six, and remembers what it has
 * highlighted for the session.
 */
export function highlightPoolSettings(hints: DeviceHints): HighlightPoolSettings {
  if (isLowEndDevice(hints)) return { poolSize: 1, cacheEntries: 20, cacheLines: 10_000, mainThreadMaxCharacters: 2_000 };
  const cores = hints.hardwareConcurrency || 4;
  return { poolSize: Math.max(2, Math.min(6, Math.floor(cores / 2))), cacheEntries: 240, cacheLines: 40_000, mainThreadMaxCharacters: 4_000 };
}

/**
 * The cache counts entries, and one entry can be a file of a few lines or of
 * tens of thousands. Given its entries from the oldest to the newest with the
 * lines each holds, names the ones to drop so the newest that fit in `maxLines`
 * stay. One too long to fit on its own is not kept.
 */
export function highlightCacheOverflow(entries: Iterable<readonly [key: string, lines: number]>, maxLines: number): string[] {
  const oldestFirst = [...entries];
  let lines = 0;
  for (let index = oldestFirst.length - 1; index >= 0; index--) {
    lines += oldestFirst[index]![1];
    if (lines > maxLines) return oldestFirst.slice(0, index + 1).map(([key]) => key);
  }
  return [];
}

function keepCacheWithinLines(manager: WorkerPoolManager, maxLines: number): void {
  manager.subscribeToStatChanges(() => {
    const { fileCache, diffCache } = manager.inspectCaches();
    // Both walk from the least to the most recently used.
    const files: Array<readonly [string, number]> = [];
    fileCache.forEach(({ result }, key) => { files.push([key, result.code.length]); });
    for (const key of highlightCacheOverflow(files, maxLines)) manager.evictFileFromCache(key);
    const diffs: Array<readonly [string, number]> = [];
    diffCache.forEach(({ result }, key) => { diffs.push([key, result.code.additionLines.length + result.code.deletionLines.length]); });
    for (const key of highlightCacheOverflow(diffs, maxLines)) manager.evictDiffFromCache(key);
  });
}

let pool: WorkerPoolManager | undefined;
let settings: HighlightPoolSettings | undefined;

/**
 * The highlighting workers and their cache, for the whole session. Pierre's own
 * provider stops them when the last viewer closes, so the next diff waited for
 * new workers and their grammars, and nothing it had highlighted was left.
 * Returns nothing where workers do not exist; viewers then highlight by themselves.
 */
export function getHighlightPool(): WorkerPoolManager | undefined {
  if (typeof Worker === 'undefined') return undefined;
  // Workers that could not start are replaced the next time a viewer opens.
  if (pool?.getStats().workersFailed) {
    pool.terminate();
    pool = undefined;
  }
  if (pool) return pool;
  settings = highlightPoolSettings(navigator);
  pool = new WorkerPoolManager({
    workerFactory: () => new DiffWorker(),
    poolSize: settings.poolSize,
    totalASTLRUCacheSize: settings.cacheEntries,
    mainThreadMaxCharacters: settings.mainThreadMaxCharacters,
  }, { theme: OPENTIG_CODE_THEMES, tokenizeMaxLineLength: 10_000 });
  keepCacheWithinLines(pool, settings.cacheLines);
  return pool;
}

/** Speculative work, such as highlighting files that are still folded, needs a worker to spare. */
export function highlightPoolHasSpareWorkers(): boolean {
  return (settings?.poolSize ?? 0) > 1;
}

/**
 * Loads grammars where code is drawn. Small files and diffs, and every file
 * being edited, are tokenized there: without its grammar the code is painted
 * plain first and colored a moment later.
 */
export function preloadHighlightLanguages(languages: readonly SupportedLanguages[]): Promise<void> {
  const manager = getHighlightPool();
  return preloadHighlighter({
    themes: [OPENTIG_CODE_THEMES.light, OPENTIG_CODE_THEMES.dark],
    langs: [...languages],
    ...(manager ? { preferredHighlighter: manager.getPreferredHighlighter() } : {}),
  });
}

const COMMON_FILES = ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.json', 'a.css', 'a.html', 'a.md', 'a.yml', 'a.sh', 'a.py'];
let warmed = false;

/**
 * Starts the workers and loads the themes and the usual grammars while the app
 * is idle, one grammar at a time, so the first diff or file of the session is
 * not the one that waits for them.
 */
export function warmHighlighting(idle: (run: () => void) => void): void {
  if (warmed || !getHighlightPool()) return;
  warmed = true;
  const languages = [...new Set(COMMON_FILES.map(resolvePierreLanguage))];
  const next = (index: number) => {
    if (index >= languages.length) return;
    idle(() => { void preloadHighlightLanguages([languages[index]!]).catch(() => undefined).then(() => next(index + 1)); });
  };
  next(0);
}
