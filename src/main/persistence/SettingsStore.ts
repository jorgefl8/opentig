import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AiHarnessId, MonoFontPreference, Preferences, RecentRepository, RepositoryInfo, RepositoryOrganization, RepositoryProject, UiFontPreference } from '../../shared/contracts';
import { GitOperationError } from '../../shared/errors';
import { sanitizeShortcutOverrides } from '../../shared/shortcuts';
import { FILES_TREE_SAVE_DEBOUNCE_MS, normalizeFilesTreeStates, type FilesTreeState, upsertFilesTreeState } from '../../shared/files-tree-state';
import { cloneOpenFilesState, normalizeOpenFilesStates, OPEN_FILES_SAVE_DEBOUNCE_MS, type OpenFilesState, upsertOpenFilesState } from '../../shared/open-files-state';
import { MAX_PROJECT_NAME_LENGTH, MAX_REPOSITORIES_PER_PROJECT, MAX_REPOSITORY_KEY_LENGTH, MAX_REPOSITORY_PROJECTS, normalizeRepositoryKey, UNASSIGNED_RECENT_LIMIT } from '../../shared/repository-projects';
import { DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS, normalizeRemoteFetchIntervalSeconds } from '../../shared/remote-fetch';
import { backupPathFor, writeFileAtomically } from './atomicWrite';

export const SETTINGS_SCHEMA_VERSION = 1;
export type SettingsRecovery = 'backup' | 'defaults';

interface WindowBounds { width: number; height: number; x?: number; y?: number }
interface SettingsData {
  version: number;
  recentRepositories: RecentRepository[];
  repositoryProjects: RepositoryProject[];
  filesTreeStates: FilesTreeState[];
  openFilesStates: OpenFilesState[];
  activeRepositoryId: string | null;
  preferences: Preferences;
  windowBounds: WindowBounds;
}

/** UI state that is written in the background instead of on every interaction. */
type BackgroundChannel = 'filesTree' | 'openFiles';

const defaults: SettingsData = {
  version: SETTINGS_SCHEMA_VERSION,
  recentRepositories: [],
  repositoryProjects: [],
  filesTreeStates: [],
  openFilesStates: [],
  activeRepositoryId: null,
  preferences: {
    theme: 'system', diffView: 'unified', changesLayout: 'tree', wrapLines: false, sidebarWidth: 400, showDotEnvFiles: true, uiZoom: 100,
    uiFont: 'geist', monoFont: 'inconsolata',
    commitMessageHarness: 'codex', commitMessageModels: { codex: 'default', claude: 'default', opencode: 'default' },
    shortcutOverrides: {}, doubleControlShortcutEnabled: true,
    remoteFetchIntervalSeconds: DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS,
  },
  windowBounds: { width: 1280, height: 800 },
};

// Disk input is intentionally permissive. Each field is repaired independently
// so one legacy or corrupt preference never resets valid sibling settings.
const settingsRecordSchema = z.looseObject({
  version: z.unknown().optional(),
  recentRepositories: z.unknown().optional(), repositoryProjects: z.unknown().optional(), filesTreeStates: z.unknown().optional(),
  openFilesStates: z.unknown().optional(), activeRepositoryId: z.unknown().optional(), preferences: z.unknown().optional(), windowBounds: z.unknown().optional(),
});
const preferencesRecordSchema = z.looseObject({});
const windowBoundsRecordSchema = z.looseObject({});
const projectRecordSchema = z.looseObject({});
const recentRepositorySchema = z.looseObject({ id: z.string(), name: z.string(), path: z.string(), lastOpenedAt: z.string() });

export class SettingsStore {
  private data: SettingsData = structuredClone(defaults);
  private loaded = false;
  private pendingWrite: Promise<void> = Promise.resolve();
  private readonly backgroundTimers = new Map<BackgroundChannel, ReturnType<typeof setTimeout>>();
  private readonly backgroundDirty = new Set<BackgroundChannel>();
  private lastBackgroundWriteError: unknown = null;

  constructor(
    private readonly filePath: string,
    private readonly onRecovery?: (kind: SettingsRecovery) => void,
    private readonly defaultDoubleControlShortcutEnabled = true,
  ) {
    this.data.preferences.doubleControlShortcutEnabled = defaultDoubleControlShortcutEnabled;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const primary = await readJsonDocument(this.filePath);
    let recovery: SettingsRecovery | null = null;
    if (primary.ok) {
      this.data = validate(primary.value, this.defaultDoubleControlShortcutEnabled);
    } else {
      const backup = await readJsonDocument(backupPathFor(this.filePath));
      if (backup.ok) {
        this.data = validate(backup.value, this.defaultDoubleControlShortcutEnabled);
        recovery = 'backup';
      } else {
        this.data = structuredClone(defaults);
        this.data.preferences.doubleControlShortcutEnabled = this.defaultDoubleControlShortcutEnabled;
        if (primary.reason === 'invalid' || backup.reason === 'invalid') recovery = 'defaults';
      }
    }
    this.loaded = true;
    if (recovery) this.onRecovery?.(recovery);
    const snapshot = this.snapshot();
    if (recovery || !primary.ok || primary.raw !== snapshot) {
      await this.enqueueWrite();
      return;
    }
    const backup = await readJsonDocument(backupPathFor(this.filePath));
    if (!backup.ok || backup.raw !== snapshot) await writeFileAtomically(backupPathFor(this.filePath), snapshot, { parseJson: true });
  }

  get recentRepositories(): RecentRepository[] { return [...this.data.recentRepositories]; }
  get repositoryProjects(): RepositoryProject[] { return this.data.repositoryProjects.map(cloneProject); }
  get filesTreeStates(): FilesTreeState[] { return this.data.filesTreeStates.map(cloneFilesTreeState); }
  get openFilesStates(): OpenFilesState[] { return this.data.openFilesStates.map(cloneOpenFilesState); }
  get activeRepositoryId(): string | null { return this.data.activeRepositoryId; }
  get preferences(): Preferences {
    return { ...this.data.preferences, commitMessageModels: { ...this.data.preferences.commitMessageModels }, shortcutOverrides: { ...this.data.preferences.shortcutOverrides } };
  }
  get windowBounds(): WindowBounds { return { ...this.data.windowBounds }; }

  async touchRepository(repository: Omit<RecentRepository, 'lastOpenedAt'>): Promise<void> {
    const recent = { ...repository, lastOpenedAt: new Date().toISOString() };
    this.data.recentRepositories = [recent, ...this.data.recentRepositories.filter((item) => item.id !== repository.id)];
    this.data.activeRepositoryId = repository.id;
    this.pruneRecentRepositories();
    await this.save();
  }

  /**
   * Rebinds one saved worktree after its directory moved. The new location is
   * validated by RepositoryService before this method runs, so every persisted
   * reference can move in one atomic settings write.
   */
  async relocateRepository(previousId: string, repository: RepositoryInfo): Promise<void> {
    const previous = this.data.recentRepositories.find((item) => item.id === previousId);
    if (!previous) throw projectError('Unknown repository.');

    const previousKey = normalizeRepositoryKey(previous.commonDir);
    const nextKey = normalizeRepositoryKey(repository.commonDir);
    const destinationAlreadyAssigned = this.data.repositoryProjects.some((project) => (
      project.repositoryKeys.some((key) => key === nextKey && key !== previousKey)
    ));

    this.data.repositoryProjects = this.data.repositoryProjects.map((project) => {
      const repositoryKeys = project.repositoryKeys.flatMap((key) => {
        if (key !== previousKey) return [key];
        return destinationAlreadyAssigned ? [] : [nextKey];
      });
      return { ...project, repositoryKeys: [...new Set(repositoryKeys)] };
    });
    this.data.filesTreeStates = normalizeFilesTreeStates(this.data.filesTreeStates.map((state) => (
      state.repositoryId === previousId ? { ...state, repositoryId: repository.id } : state
    )));
    this.data.openFilesStates = normalizeOpenFilesStates(this.data.openFilesStates.map((state) => (
      state.repositoryId === previousId ? { ...state, repositoryId: repository.id } : state
    )));
    this.data.recentRepositories = [
      { ...repository, lastOpenedAt: new Date().toISOString() },
      ...this.data.recentRepositories.filter((item) => item.id !== previousId && item.id !== repository.id),
    ];
    if (this.data.activeRepositoryId === previousId) this.data.activeRepositoryId = repository.id;
    this.pruneRecentRepositories();
    await this.save();
  }

  /**
   * Drops the recent entries for one removed worktree directory. Sibling
   * worktrees of the same repository keep their entries, and project
   * assignments are untouched because they are keyed by `commonDir`, which
   * identifies the repository rather than any single worktree.
   */
  async forgetWorktreePath(worktreePath: string): Promise<RecentRepository[]> {
    const target = normalizeWorktreePath(worktreePath);
    if (!target) return this.recentRepositories;
    const matching = this.data.recentRepositories.filter((item) => normalizeWorktreePath(item.path) === target);
    if (matching.length === 0) return this.recentRepositories;
    // The active repository is never a removal target; the operations layer
    // blocks removing the current worktree before it reaches persistence.
    if (matching.some((item) => item.id === this.data.activeRepositoryId)) return this.recentRepositories;
    const removedIds = new Set(matching.map((item) => item.id));
    this.data.recentRepositories = this.data.recentRepositories.filter((item) => normalizeWorktreePath(item.path) !== target);
    // Open-file metadata is keyed by the same worktree identifier, so a forgotten
    // worktree must not leave its tabs behind to be restored later.
    this.data.openFilesStates = this.data.openFilesStates.filter((state) => !removedIds.has(state.repositoryId));
    await this.save();
    return this.recentRepositories;
  }

  async createRepositoryProject(name: string): Promise<RepositoryOrganization> {
    const normalizedName = this.validateProjectName(name);
    if (this.data.repositoryProjects.length >= MAX_REPOSITORY_PROJECTS) throw projectError('Too many projects.');
    this.assertUniqueProjectName(normalizedName);
    this.data.repositoryProjects.push({ id: randomUUID(), name: normalizedName, repositoryKeys: [] });
    await this.save();
    return this.organization;
  }

  async renameRepositoryProject(projectId: string, name: string): Promise<RepositoryOrganization> {
    const project = this.getProject(projectId);
    const normalizedName = this.validateProjectName(name);
    this.assertUniqueProjectName(normalizedName, projectId);
    project.name = normalizedName;
    await this.save();
    return this.organization;
  }

  async removeRepositoryProject(projectId: string): Promise<RepositoryOrganization> {
    this.getProject(projectId);
    this.data.repositoryProjects = this.data.repositoryProjects.filter((project) => project.id !== projectId);
    this.pruneRecentRepositories();
    await this.save();
    return this.organization;
  }

  async assignRepositoryProject(repositoryKey: string, projectId: string | null): Promise<RepositoryOrganization> {
    const key = normalizeRepositoryKey(repositoryKey);
    if (!key || key.length > MAX_REPOSITORY_KEY_LENGTH || hasControlCharacters(key)) throw projectError('Invalid repository.');
    const target = projectId === null ? null : this.getProject(projectId);
    if (target && !this.data.recentRepositories.some((repository) => normalizeRepositoryKey(repository.commonDir) === key)) {
      throw projectError('Unknown repository.');
    }
    this.data.repositoryProjects = this.data.repositoryProjects.map((project) => ({
      ...project,
      repositoryKeys: project.repositoryKeys.filter((item) => item !== key),
    }));
    if (target) {
      const refreshed = this.getProject(target.id);
      if (refreshed.repositoryKeys.length >= MAX_REPOSITORIES_PER_PROJECT) throw projectError('This project is full.');
      refreshed.repositoryKeys.push(key);
    }
    this.pruneRecentRepositories();
    await this.save();
    return this.organization;
  }

  async setPreferences(partial: Partial<Preferences>): Promise<Preferences> {
    const next = { ...this.data.preferences, ...partial };
    if (!['system', 'light', 'dark'].includes(next.theme)) next.theme = 'system';
    if (!['unified', 'split'].includes(next.diffView)) next.diffView = 'unified';
    if (!['tree', 'list'].includes(next.changesLayout)) next.changesLayout = 'tree';
    next.wrapLines = typeof next.wrapLines === 'boolean' ? next.wrapLines : false;
    next.sidebarWidth = normalizeSidebarWidth(next.sidebarWidth);
    next.showDotEnvFiles = typeof next.showDotEnvFiles === 'boolean' ? next.showDotEnvFiles : true;
    next.uiZoom = Math.max(80, Math.min(130, Math.round(Number(next.uiZoom) || 100)));
    next.uiFont = normalizeUiFont(next.uiFont);
    next.monoFont = isMonoFont(next.monoFont) ? next.monoFont : 'inconsolata';
    next.commitMessageHarness = isHarness(next.commitMessageHarness) ? next.commitMessageHarness : 'codex';
    next.commitMessageModels = modelPreferences(next.commitMessageModels);
    next.shortcutOverrides = sanitizeShortcutOverrides(next.shortcutOverrides);
    next.doubleControlShortcutEnabled = typeof next.doubleControlShortcutEnabled === 'boolean' ? next.doubleControlShortcutEnabled : this.defaultDoubleControlShortcutEnabled;
    next.remoteFetchIntervalSeconds = normalizeRemoteFetchIntervalSeconds(next.remoteFetchIntervalSeconds);
    this.data.preferences = next;
    await this.save();
    return this.preferences;
  }

  async setWindowBounds(bounds: WindowBounds): Promise<void> {
    this.data.windowBounds = bounds;
    await this.save();
  }

  setFilesTreeExpandedPaths(repositoryId: string, expandedPaths: string[]): void {
    this.data.filesTreeStates = upsertFilesTreeState(this.data.filesTreeStates, repositoryId, expandedPaths, new Date().toISOString());
    this.scheduleBackgroundSave('filesTree', FILES_TREE_SAVE_DEBOUNCE_MS);
  }

  /**
   * Stores the open-file tabs of one worktree. The renderer never supplies the
   * timestamp so a replayed or forged message cannot pin a stale record on top.
   */
  setOpenFilesState(repositoryId: string, tabs: unknown, activePath: unknown, previewPath: unknown): void {
    this.data.openFilesStates = upsertOpenFilesState(this.data.openFilesStates, repositoryId, tabs, activePath, previewPath, new Date().toISOString());
    this.scheduleBackgroundSave('openFiles', OPEN_FILES_SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    this.clearBackgroundTimers();
    await this.saveBackgroundChannels();
    await this.pendingWrite;
    await this.saveBackgroundChannels();
    if (this.lastBackgroundWriteError) throw this.lastBackgroundWriteError;
  }

  private save(): Promise<void> {
    // A full write persists every channel, so pending background work is settled.
    this.clearBackgroundTimers();
    this.backgroundDirty.clear();
    this.lastBackgroundWriteError = null;
    return this.enqueueWrite();
  }

  private scheduleBackgroundSave(channel: BackgroundChannel, debounceMs: number): void {
    this.backgroundDirty.add(channel);
    const existing = this.backgroundTimers.get(channel);
    if (existing) clearTimeout(existing);
    this.backgroundTimers.set(channel, setTimeout(() => {
      this.backgroundTimers.delete(channel);
      void this.saveBackgroundChannels().catch(() => undefined);
    }, debounceMs));
  }

  private clearBackgroundTimers(): void {
    for (const timer of this.backgroundTimers.values()) clearTimeout(timer);
    this.backgroundTimers.clear();
  }

  private async saveBackgroundChannels(): Promise<void> {
    if (this.backgroundDirty.size === 0) return this.pendingWrite;
    const pending = [...this.backgroundDirty];
    this.backgroundDirty.clear();
    this.lastBackgroundWriteError = null;
    try {
      await this.enqueueWrite();
    } catch (error) {
      for (const channel of pending) this.backgroundDirty.add(channel);
      this.lastBackgroundWriteError = error;
      throw error;
    }
  }

  private snapshot(): string {
    return `${JSON.stringify(this.data, null, 2)}\n`;
  }

  private enqueueWrite(): Promise<void> {
    const snapshot = this.snapshot();
    const write = this.pendingWrite.then(async () => {
      await writeFileAtomically(this.filePath, snapshot, { parseJson: true });
      await writeFileAtomically(backupPathFor(this.filePath), snapshot, { parseJson: true });
    });
    this.pendingWrite = write.catch(() => undefined);
    return write;
  }

  private get organization(): RepositoryOrganization {
    return { repositoryProjects: this.repositoryProjects, recentRepositories: this.recentRepositories };
  }

  private getProject(projectId: string): RepositoryProject {
    const project = this.data.repositoryProjects.find((item) => item.id === projectId);
    if (!project) throw projectError('Unknown project.');
    return project;
  }

  private validateProjectName(name: string): string {
    const normalized = name.trim();
    if (!normalized || normalized.length > MAX_PROJECT_NAME_LENGTH || hasControlCharacters(normalized)) throw projectError('Invalid project name.');
    return normalized;
  }

  private assertUniqueProjectName(name: string, exceptId?: string): void {
    if (this.data.repositoryProjects.some((project) => project.id !== exceptId && project.name.toLowerCase() === name.toLowerCase())) {
      throw projectError('A project with this name already exists.');
    }
  }

  private pruneRecentRepositories(): void {
    const assigned = new Set(this.data.repositoryProjects.flatMap((project) => project.repositoryKeys));
    let unassigned = 0;
    this.data.recentRepositories = this.data.recentRepositories.filter((repository) => {
      if (repository.id === this.data.activeRepositoryId || assigned.has(normalizeRepositoryKey(repository.commonDir))) return true;
      unassigned += 1;
      return unassigned <= UNASSIGNED_RECENT_LIMIT;
    });
  }
}

function validate(value: unknown, defaultDoubleControlShortcutEnabled: boolean): SettingsData {
  const parsed = settingsRecordSchema.safeParse(value);
  if (!parsed.success) {
    const data = structuredClone(defaults);
    data.preferences.doubleControlShortcutEnabled = defaultDoubleControlShortcutEnabled;
    return data;
  }
  const input = parsed.data;
  const recentRepositories = Array.isArray(input.recentRepositories)
    ? input.recentRepositories.filter(isRecent).map(normalizeRecent).slice(0, 10)
    : [];
  const repositoryProjects = normalizeProjects(input.repositoryProjects);
  const filesTreeStates = normalizeFilesTreeStates(input.filesTreeStates);
  const openFilesStates = normalizeOpenFilesStates(input.openFilesStates);
  const parsedPreferences = preferencesRecordSchema.safeParse(input.preferences);
  const preferences = parsedPreferences.success
    ? {
        theme: ['system', 'light', 'dark'].includes(parsedPreferences.data.theme as string) ? parsedPreferences.data.theme : 'system',
        diffView: ['unified', 'split'].includes(parsedPreferences.data.diffView as string) ? parsedPreferences.data.diffView : 'unified',
        changesLayout: ['tree', 'list'].includes(parsedPreferences.data.changesLayout as string) ? parsedPreferences.data.changesLayout : 'tree',
        wrapLines: typeof parsedPreferences.data.wrapLines === 'boolean' ? parsedPreferences.data.wrapLines : false,
        sidebarWidth: normalizeSidebarWidth(parsedPreferences.data.sidebarWidth),
        showDotEnvFiles: typeof parsedPreferences.data.showDotEnvFiles === 'boolean' ? parsedPreferences.data.showDotEnvFiles : true,
        uiZoom: Math.max(80, Math.min(130, Math.round(Number(parsedPreferences.data.uiZoom) || 100))),
        uiFont: normalizeUiFont(parsedPreferences.data.uiFont),
        monoFont: isMonoFont(parsedPreferences.data.monoFont) ? parsedPreferences.data.monoFont : 'inconsolata',
        commitMessageHarness: isHarness(parsedPreferences.data.commitMessageHarness) ? parsedPreferences.data.commitMessageHarness : 'codex',
        commitMessageModels: modelPreferences(parsedPreferences.data.commitMessageModels),
        shortcutOverrides: sanitizeShortcutOverrides(parsedPreferences.data.shortcutOverrides),
        doubleControlShortcutEnabled: typeof parsedPreferences.data.doubleControlShortcutEnabled === 'boolean' ? parsedPreferences.data.doubleControlShortcutEnabled : defaultDoubleControlShortcutEnabled,
        remoteFetchIntervalSeconds: normalizeRemoteFetchIntervalSeconds(
          parsedPreferences.data.remoteFetchIntervalSeconds === undefined
            ? DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS
            : parsedPreferences.data.remoteFetchIntervalSeconds,
        ),
      } as Preferences
    : { ...defaults.preferences, doubleControlShortcutEnabled: defaultDoubleControlShortcutEnabled };
  const parsedBounds = windowBoundsRecordSchema.safeParse(input.windowBounds);
  const bounds = parsedBounds.success ? parsedBounds.data : null;
  const windowBounds = bounds && typeof bounds.width === 'number' && Number.isFinite(bounds.width) && typeof bounds.height === 'number' && Number.isFinite(bounds.height)
    ? { width: Math.max(900, bounds.width), height: Math.max(600, bounds.height), ...(typeof bounds.x === 'number' && Number.isFinite(bounds.x) ? { x: bounds.x } : {}), ...(typeof bounds.y === 'number' && Number.isFinite(bounds.y) ? { y: bounds.y } : {}) }
    : { ...defaults.windowBounds };
  return {
    version: SETTINGS_SCHEMA_VERSION,
    recentRepositories,
    repositoryProjects,
    filesTreeStates,
    openFilesStates,
    activeRepositoryId: typeof input.activeRepositoryId === 'string' ? input.activeRepositoryId : null,
    preferences,
    windowBounds,
  };
}

async function readJsonDocument(filePath: string): Promise<
  { ok: true; value: unknown; raw: string } | { ok: false; reason: 'missing' | 'invalid' }
> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw), raw };
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid' };
  }
}

function normalizeProjects(value: unknown): RepositoryProject[] {
  if (!Array.isArray(value)) return [];
  const projects: RepositoryProject[] = [];
  const names = new Set<string>();
  const assigned = new Set<string>();
  for (const candidate of value.slice(0, MAX_REPOSITORY_PROJECTS)) {
    const parsed = projectRecordSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const input = parsed.data;
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const id = typeof input.id === 'string' ? input.id : '';
    const normalizedName = name.toLowerCase();
    if (!id || id.length > 64 || hasControlCharacters(id) || !name || name.length > MAX_PROJECT_NAME_LENGTH || hasControlCharacters(name) || names.has(normalizedName)) continue;
    names.add(normalizedName);
    const repositoryKeys: string[] = [];
    if (Array.isArray(input.repositoryKeys)) {
      for (const raw of input.repositoryKeys.slice(0, MAX_REPOSITORIES_PER_PROJECT)) {
        if (typeof raw !== 'string' || raw.length > MAX_REPOSITORY_KEY_LENGTH || hasControlCharacters(raw)) continue;
        const key = normalizeRepositoryKey(raw);
        if (!key || assigned.has(key)) continue;
        assigned.add(key);
        repositoryKeys.push(key);
      }
    }
    projects.push({ id, name, repositoryKeys });
  }
  return projects;
}

/** Absolute worktree paths compare by resolved form, ignoring Windows casing. */
function normalizeWorktreePath(value: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function cloneProject(project: RepositoryProject): RepositoryProject {
  return { ...project, repositoryKeys: [...project.repositoryKeys] };
}

function cloneFilesTreeState(state: FilesTreeState): FilesTreeState {
  return { ...state, expandedPaths: [...state.expandedPaths] };
}

function projectError(message: string): GitOperationError {
  return new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'repository-projects', message });
}

function isHarness(value: unknown): value is AiHarnessId {
  return value === 'codex' || value === 'claude' || value === 'opencode';
}

function normalizeUiFont(value: unknown): UiFontPreference {
  // Replace preferences saved by versions that exposed the removed Fontshare faces.
  if (value === 'cabinet-grotesk' || value === 'satoshi') return 'plus-jakarta-sans';
  return value === 'geist' || value === 'plus-jakarta-sans' || value === 'space-grotesk' ? value : 'geist';
}

function isMonoFont(value: unknown): value is MonoFontPreference {
  return value === 'geist-mono' || value === 'jetbrains-mono' || value === 'inconsolata' || value === 'departure' || value === 'space-grotesk';
}

function normalizeSidebarWidth(value: unknown): number {
  const width = Number(value);
  if (!Number.isFinite(width) || width === 340) return 400;
  return Math.max(300, Math.min(680, width));
}

function modelPreferences(value: unknown): Partial<Record<AiHarnessId, string>> {
  const result: Partial<Record<AiHarnessId, string>> = { codex: 'default', claude: 'default', opencode: 'default' };
  if (!value || typeof value !== 'object') return result;
  for (const harness of ['codex', 'claude', 'opencode'] as const) {
    const model = (value as Partial<Record<AiHarnessId, unknown>>)[harness];
    if (typeof model === 'string' && model.length > 0 && model.length <= 200 && !hasControlCharacters(model)) result[harness] = model;
  }
  return result;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function isRecent(value: unknown): value is RecentRepository {
  return recentRepositorySchema.safeParse(value).success;
}

function normalizeRecent(item: RecentRepository): RecentRepository {
  const commonDir = typeof item.commonDir === 'string' && item.commonDir
    ? path.resolve(item.commonDir)
    : path.join(path.resolve(item.path), '.git');
  return {
    ...item,
    commonDir,
    repositoryName: typeof item.repositoryName === 'string' && item.repositoryName
      ? item.repositoryName
      : path.basename(path.dirname(commonDir)),
  };
}
