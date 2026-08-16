export const MAX_OPEN_FILE_TABS = 50;
export const MAX_OPEN_FILES_REPOSITORIES = 20;
export const MAX_OPEN_FILE_PATH_LENGTH = 2_048;
export const MAX_OPEN_FILE_PATH_CHARACTERS = 64 * 1024;
export const OPEN_FILES_SAVE_DEBOUNCE_MS = 750;

export interface OpenFileTab {
  path: string;
  pinned: boolean;
}

export interface OpenFilesState {
  repositoryId: string;
  tabs: OpenFileTab[];
  activePath: string | null;
  previewPath: string | null;
  updatedAt: string;
}

export function normalizeOpenFilePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_OPEN_FILE_PATH_LENGTH) return null;
  if (value.includes('\0') || hasControlCharacters(value)) return null;
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
}

/**
 * Tab order is user data: it is chosen by dragging tabs in the header, so unlike
 * the files tree the list is never sorted. Duplicates and overflow are dropped
 * while the surviving entries keep their first-seen order.
 */
export function normalizeOpenFileTabs(value: unknown): OpenFileTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tabs: OpenFileTab[] = [];
  let characters = 0;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const input = candidate as Partial<OpenFileTab>;
    const path = normalizeOpenFilePath(input.path);
    if (!path || seen.has(path)) continue;
    if (characters + path.length > MAX_OPEN_FILE_PATH_CHARACTERS) continue;
    seen.add(path);
    characters += path.length;
    tabs.push({ path, pinned: input.pinned === true });
    if (tabs.length === MAX_OPEN_FILE_TABS) break;
  }
  return tabs;
}

export function normalizeOpenFilesState(value: unknown): OpenFilesState | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<OpenFilesState>;
  if (!isOpenFilesRepositoryId(input.repositoryId) || !isIsoDate(input.updatedAt)) return null;
  const tabs = normalizeOpenFileTabs(input.tabs);
  if (tabs.length === 0) return null;

  // A preview tab is by definition not pinned; a contradictory record loses the
  // preview rather than the tab, and a preview that no longer exists is dropped.
  const previewCandidate = normalizeOpenFilePath(input.previewPath);
  const preview = tabs.find((tab) => tab.path === previewCandidate && !tab.pinned) ?? null;
  const previewPath = preview ? preview.path : null;

  const activeCandidate = normalizeOpenFilePath(input.activePath);
  const active = tabs.find((tab) => tab.path === activeCandidate) ?? tabs[tabs.length - 1];
  const activePath = active ? active.path : null;

  return { repositoryId: input.repositoryId, tabs, activePath, previewPath, updatedAt: input.updatedAt };
}

export function normalizeOpenFilesStates(value: unknown): OpenFilesState[] {
  if (!Array.isArray(value)) return [];
  const newest = new Map<string, OpenFilesState>();
  for (const candidate of value) {
    const state = normalizeOpenFilesState(candidate);
    if (!state) continue;
    const previous = newest.get(state.repositoryId);
    if (!previous || compareStates(state, previous) < 0) newest.set(state.repositoryId, state);
  }
  return [...newest.values()].sort(compareStates).slice(0, MAX_OPEN_FILES_REPOSITORIES);
}

export function upsertOpenFilesState(
  states: readonly OpenFilesState[],
  repositoryId: string,
  tabs: unknown,
  activePath: unknown,
  previewPath: unknown,
  updatedAt: string,
): OpenFilesState[] {
  const retained = states.filter((state) => state.repositoryId !== repositoryId);
  const next = normalizeOpenFilesState({ repositoryId, tabs, activePath, previewPath, updatedAt });
  if (!next) return normalizeOpenFilesStates(retained);
  return normalizeOpenFilesStates([next, ...retained]);
}

export function isOpenFilesRepositoryId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

export function cloneOpenFilesState(state: OpenFilesState): OpenFilesState {
  return { ...state, tabs: state.tabs.map((tab) => ({ ...tab })) };
}

function compareStates(left: OpenFilesState, right: OpenFilesState): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.repositoryId.localeCompare(right.repositoryId);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
