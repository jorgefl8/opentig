import type { FileTreeEntry } from '@shared/git-types';
import { filterIgnoredEntries, parentDirectory } from './file-tree';

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

interface RankedResult extends QuickOpenResult {
  rank: number[];
}

export function collectQuickOpenFiles(entries: FileTreeEntry[], includeIgnored: boolean): QuickOpenResult[] {
  const files: QuickOpenResult[] = [];
  const visit = (items: FileTreeEntry[]) => {
    for (const entry of items) {
      if (entry.type === 'directory') visit(entry.children);
      else files.push({ path: entry.path, name: entry.name, parentPath: parentDirectory(entry.path) });
    }
  };
  visit(includeIgnored ? entries : filterIgnoredEntries(entries));
  return files;
}

export function rankQuickOpenFiles(
  entries: FileTreeEntry[],
  query: string,
  { includeIgnored, activePath = null, limit = 100 }: QuickOpenOptions,
): QuickOpenResult[] {
  const candidates = collectQuickOpenFiles(entries, includeIgnored);
  const normalizedQuery = normalize(query).trim();
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (!normalizedQuery) {
    return candidates
      .sort((a, b) => a.path === activePath ? -1 : b.path === activePath ? 1 : comparePaths(a.path, b.path))
      .slice(0, cappedLimit);
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  return candidates
    .map((candidate): RankedResult | null => {
      const basename = normalize(candidate.name);
      const fullPath = normalize(candidate.path);
      const rank = matchRank(basename, fullPath, normalizedQuery, compactQuery);
      return rank ? { ...candidate, rank } : null;
    })
    .filter((candidate): candidate is RankedResult => candidate !== null)
    .sort((a, b) => compareRank(a.rank, b.rank)
      || pathDepth(a.path) - pathDepth(b.path)
      || comparePaths(a.path, b.path))
    .slice(0, cappedLimit)
    .map((candidate) => ({ path: candidate.path, name: candidate.name, parentPath: candidate.parentPath }));
}

export function isQuickOpenShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p';
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

function comparePaths(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b);
}
