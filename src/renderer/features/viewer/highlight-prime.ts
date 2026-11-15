import type { FileContents, FileDiffMetadata } from '@pierre/diffs';
import { DIFF_PARSE_WORKER_THRESHOLD } from './diff-parser';
import { fileHighlightKey } from './highlight-cache-key';
import { buildDiffFileEntries } from './patch-utils';
import { loadPierreEditor } from './pierre-editor';
import { getHighlightPool, preloadHighlightLanguages } from './pierre-pool';
import { resolvePierreLanguage } from './pierreLanguages';

/** How long a new document may hold the previous one on screen to arrive with its colors. */
export const HIGHLIGHT_PRIME_BUDGET_MS = 120;
/** The files of a diff that are highlighted before it is shown; the rest are below the fold. */
const PRIMED_DIFF_FILES = 4;

/** The part of Pierre's pool that highlights ahead of a viewer. */
export interface HighlightPrimer {
  isWorkingPool(): boolean;
  primeFileHighlightCache(file: FileContents): Promise<void>;
  primeDiffHighlightCache(diff: FileDiffMetadata): Promise<void>;
}

/** Settles when `work` does, whichever way, or when the budget runs out. Late work still lands in the cache. */
export function withinBudget(work: Promise<unknown>, budgetMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, budgetMs);
    const done = () => { clearTimeout(timer); resolve(); };
    work.then(done, done);
  });
}

/**
 * Gets a file ready to be shown already colored. A file being edited is
 * tokenized by its editor where it is drawn, which needs the grammar and the
 * editor there first. A read-only one takes its colors from the pool's cache.
 */
export function prepareFileHighlight(path: string, content: string, editable: boolean, pool: HighlightPrimer | undefined = getHighlightPool(), budgetMs = HIGHLIGHT_PRIME_BUDGET_MS): Promise<void> {
  const lang = resolvePierreLanguage(path);
  const work: Promise<unknown>[] = [preloadHighlightLanguages([lang])];
  if (editable) work.push(loadPierreEditor());
  else if (pool?.isWorkingPool()) work.push(pool.primeFileHighlightCache({ name: path, lang, contents: content, cacheKey: fileHighlightKey(path, content) }));
  return withinBudget(Promise.allSettled(work), budgetMs);
}

/**
 * Highlights the first files of a diff that opens unfolded. A patch large
 * enough to be parsed in a worker is left to its workspace: it would be parsed
 * twice, and it shows its own progress.
 */
export function prepareDiffHighlight(patch: string, pool: HighlightPrimer | undefined = getHighlightPool(), budgetMs = HIGHLIGHT_PRIME_BUDGET_MS): Promise<void> {
  if (!pool?.isWorkingPool() || !patch || patch.length >= DIFF_PARSE_WORKER_THRESHOLD) return Promise.resolve();
  let diffs: FileDiffMetadata[];
  try { diffs = buildDiffFileEntries(patch).slice(0, PRIMED_DIFF_FILES).map((file) => file.fileDiff); }
  catch { return Promise.resolve(); }
  return withinBudget(Promise.allSettled(diffs.map((diff) => pool.primeDiffHighlightCache(diff))), budgetMs);
}
