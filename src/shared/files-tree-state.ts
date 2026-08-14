export const MAX_FILES_TREE_PATHS = 500;
export const MAX_FILES_TREE_LAZY_PATHS = 20;
export const MAX_FILES_TREE_REPOSITORIES = 20;
export const MAX_FILES_TREE_PATH_LENGTH = 2_048;
export const MAX_FILES_TREE_PATH_CHARACTERS = 64 * 1024;
export const FILES_TREE_SAVE_DEBOUNCE_MS = 750;

export interface FilesTreeState {
  repositoryId: string;
  expandedPaths: string[];
  updatedAt: string;
}

export function normalizeFilesTreePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_FILES_TREE_PATH_LENGTH) return null;
  if (value.includes('\0') || hasControlCharacters(value)) return null;
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
}

export function normalizeExpandedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths = new Set<string>();
  for (const candidate of value) {
    const normalized = normalizeFilesTreePath(candidate);
    if (normalized) paths.add(normalized);
  }
  let characters = 0;
  return [...paths]
    .sort(compareTreePaths)
    .filter((path) => {
      if (characters + path.length > MAX_FILES_TREE_PATH_CHARACTERS) return false;
      characters += path.length;
      return true;
    })
    .slice(0, MAX_FILES_TREE_PATHS);
}

export function normalizeFilesTreeStates(value: unknown): FilesTreeState[] {
  if (!Array.isArray(value)) return [];
  const newest = new Map<string, FilesTreeState>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const input = candidate as Partial<FilesTreeState>;
    if (!isFilesTreeRepositoryId(input.repositoryId) || !isIsoDate(input.updatedAt)) continue;
    const expandedPaths = normalizeExpandedPaths(input.expandedPaths);
    if (expandedPaths.length === 0) continue;
    const state = { repositoryId: input.repositoryId, expandedPaths, updatedAt: input.updatedAt };
    const previous = newest.get(state.repositoryId);
    if (!previous || compareStates(state, previous) < 0) newest.set(state.repositoryId, state);
  }
  return [...newest.values()].sort(compareStates).slice(0, MAX_FILES_TREE_REPOSITORIES);
}

export function upsertFilesTreeState(
  states: readonly FilesTreeState[],
  repositoryId: string,
  expandedPaths: unknown,
  updatedAt: string,
): FilesTreeState[] {
  const retained = states.filter((state) => state.repositoryId !== repositoryId);
  const normalizedPaths = normalizeExpandedPaths(expandedPaths);
  if (!isFilesTreeRepositoryId(repositoryId) || !isIsoDate(updatedAt) || normalizedPaths.length === 0) {
    return normalizeFilesTreeStates(retained);
  }
  return normalizeFilesTreeStates([{ repositoryId, expandedPaths: normalizedPaths, updatedAt }, ...retained]);
}

export function isFilesTreeRepositoryId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

export function compareTreePaths(left: string, right: string): number {
  return pathDepth(left) - pathDepth(right) || compareOrdinal(left, right);
}

function compareStates(left: FilesTreeState, right: FilesTreeState): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.repositoryId.localeCompare(right.repositoryId);
}

function pathDepth(value: string): number {
  return value.split('/').length;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function compareOrdinal(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
