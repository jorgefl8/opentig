import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AiHarnessId, MonoFontPreference, Preferences, RecentRepository, RepositoryInfo, RepositoryOrganization, RepositoryProject, UiFontPreference } from '../../shared/contracts';
import { GitOperationError } from '../../shared/errors';
import { sanitizeShortcutOverrides } from '../../shared/shortcuts';
import { FILES_TREE_SAVE_DEBOUNCE_MS, normalizeFilesTreeStates, type FilesTreeState, upsertFilesTreeState } from '../../shared/files-tree-state';
import { cloneOpenFilesState, normalizeOpenFilesStates, OPEN_FILES_SAVE_DEBOUNCE_MS, type OpenFilesState, upsertOpenFilesState } from '../../shared/open-files-state';
import { MAX_PROJECT_NAME_LENGTH, MAX_REPOSITORIES_PER_PROJECT, MAX_REPOSITORY_KEY_LENGTH, MAX_REPOSITORY_PROJECTS, normalizeRepositoryKey } from '../../shared/repository-projects';
import { DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS, normalizeRemoteFetchIntervalSeconds } from '../../shared/remote-fetch';
import { AUTOMATIC_GITHUB_ACCOUNT, githubAccountSelectionSchema, githubRepositoryKey, type GitHubAccountSelection } from '../../shared/github-accounts';
import { backupPathFor, writeFileAtomically } from './atomicWrite';

export const SETTINGS_SCHEMA_VERSION = 2;
export type SettingsRecovery = 'backup' | 'defaults';

interface WindowBounds { width: number; height: number; x?: number; y?: number }
interface SettingsData {
  version: number;
  githubAccounts: Record<string, GitHubAccountSelection>;
  githubDefaultLogin: string | null;
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
  githubAccounts: {},
  githubDefaultLogin: null,
  recentRepositories: [],
  repositoryProjects: [],
  filesTreeStates: [],
  openFilesStates: [],
  activeRepositoryId: null,
  preferences: {
    theme: 'system', diffView: 'unified', changesLayout: 'tree', wrapLines: false, sidebarWidth: 400, showDotEnvFiles: true, uiZoom: 100,
    uiFont: 'plus-jakarta-sans', monoFont: 'jetbrains-mono',
    commitMessageHarness: 'codex', commitMessageModels: { codex: 'default', claude: 'default', opencode: 'default', grok: 'default' },
    aiExecutablePaths: {},
    shortcutOverrides: {}, doubleControlShortcutEnabled: true,
    remoteFetchIntervalSeconds: DEFAULT_REMOTE_FETCH_INTERVAL_SECONDS,
  },
  windowBounds: { width: 1280, height: 800 },
};

// Disk input is intentionally permissive. Each field is repaired independently
// so one legacy or corrupt preference never resets valid sibling settings.
const settingsRecordSchema = z.looseObject({
  version: z.unknown().optional(), githubAccounts: z.unknown().optional(),
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
    return { ...this.data.preferences, aiExecutablePaths: { ...this.data.preferences.aiExecutablePaths }, commitMessageModels: { ...this.data.preferences.commitMessageModels }, shortcutOverrides: { ...this.data.preferences.shortcutOverrides } };
  }
  get windowBounds(): WindowBounds { return { ...this.data.windowBounds }; }

  githubAccount(commonDir: string): GitHubAccountSelection {
    const selection = this.data.githubAccounts[githubRepositoryKey(commonDir)] ?? AUTOMATIC_GITHUB_ACCOUNT;
    if (selection.mode === 'account' && selection.useGlobalDefault) {
      if (!this.data.githubDefaultLogin) throw new Error('Choose an OpenTig default account in Settings → GitHub.');
      return { ...selection, login: this.data.githubDefaultLogin };
    }
    return { ...selection };
  }

  get githubDefaultLogin(): string | null { return this.data.githubDefaultLogin; }

  async setGitHubDefaultLogin(login: string): Promise<void> {
    const parsed = githubAccountSelectionSchema.parse({ mode: 'account', host: 'github.com', login });
    if (parsed.mode !== 'account') throw new Error('Invalid default account.');
    const previous = this.data.githubDefaultLogin;
    this.data.githubDefaultLogin = parsed.login;
    try { await this.save(); }
    catch (error) { if (this.data.githubDefaultLogin === parsed.login) this.data.githubDefaultLogin = previous; throw error; }
  }

  async setGitHubAccount(commonDir: string, selection: GitHubAccountSelection): Promise<void> {
    const parsed = githubAccountSelectionSchema.parse(selection);
    if (parsed.mode === 'account' && parsed.useGlobalDefault && parsed.login.toLowerCase() !== this.data.githubDefaultLogin?.toLowerCase()) {
      throw new Error('The OpenTig default account changed. Review the current account and try again.');
    }
    const key = githubRepositoryKey(commonDir);
    const previous = this.data.githubAccounts[key];
    if (parsed.mode === 'auto') delete this.data.githubAccounts[key];
    else this.data.githubAccounts[key] = parsed;
    try { await this.save(); }
    catch (error) {
      if (this.data.githubAccounts[key] === (parsed.mode === 'auto' ? undefined : parsed)) {
        if (previous) this.data.githubAccounts[key] = previous;
        else delete this.data.githubAccounts[key];
      }
      throw error;
    }
  }

  async touchRepository(repository: Omit<RecentRepository, 'lastOpenedAt'>): Promise<void> {
    const recent = { ...repository, lastOpenedAt: new Date().toISOString() };
    const existing = this.data.recentRepositories.some((item) => item.id === repository.id);
    this.data.recentRepositories = existing
      ? this.data.recentRepositories.map((item) => item.id === repository.id ? recent : item)
      : [...this.data.recentRepositories, recent];
    this.data.activeRepositoryId = repository.id;
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

    const previousAccountKey = githubRepositoryKey(previous.commonDir);
    const nextAccountKey = githubRepositoryKey(repository.commonDir);
    if (previousAccountKey !== nextAccountKey && this.data.githubAccounts[previousAccountKey]) {
      this.data.githubAccounts[nextAccountKey] ??= this.data.githubAccounts[previousAccountKey];
      delete this.data.githubAccounts[previousAccountKey];
    }
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
    this.data.recentRepositories = this.data.recentRepositories.flatMap((item) => item.id === previousId
      ? [{ ...repository, lastOpenedAt: new Date().toISOString() }]
      : item.id === repository.id ? [] : [item]);
    this.data.activeRepositoryId = repository.id;
    await this.save();
  }

  /** Forget the whole repository group, never its directories or Git data. */
  async forgetRepository(repositoryKey: string): Promise<RepositoryOrganization> {
    const key = normalizeRepositoryKey(repositoryKey);
    const removedIds = new Set(this.data.recentRepositories
      .filter((item) => normalizeRepositoryKey(item.commonDir) === key).map((item) => item.id));
    for (const item of this.data.recentRepositories) {
      if (removedIds.has(item.id)) delete this.data.githubAccounts[githubRepositoryKey(item.commonDir)];
    }
    this.data.recentRepositories = this.data.recentRepositories.filter((item) => !removedIds.has(item.id));
    this.data.repositoryProjects = this.data.repositoryProjects.map((project) => ({
      ...project, repositoryKeys: project.repositoryKeys.filter((entry) => entry !== key),
    }));
    this.data.filesTreeStates = this.data.filesTreeStates.filter((state) => !removedIds.has(state.repositoryId));
    this.data.openFilesStates = this.data.openFilesStates.filter((state) => !removedIds.has(state.repositoryId));
    if (this.data.activeRepositoryId && removedIds.has(this.data.activeRepositoryId)) this.data.activeRepositoryId = null;
    await this.save();
    return this.organization;
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
    await this.save();
    return this.organization;
  }

  async assignRepositoryProject(repositoryKey: string, projectId: string | null): Promise<RepositoryOrganization> {
    const key = normalizeRepositoryKey(repositoryKey);
    if (!key || key.length > MAX_REPOSITORY_KEY_LENGTH || hasControlCharacters(key)) throw projectError('Invalid repository.');
    const target = projectId === null ? null : this.getProject(projectId);
    if (!this.data.recentRepositories.some((repository) => normalizeRepositoryKey(repository.commonDir) === key)) {
      throw projectError('Unknown repository.');
    }
    if (target?.repositoryKeys.includes(key)) return this.organization;
    if (target && target.repositoryKeys.length >= MAX_REPOSITORIES_PER_PROJECT) throw projectError('This project is full.');
    this.data.repositoryProjects = this.data.repositoryProjects.map((project) => ({
      ...project,
      repositoryKeys: project.repositoryKeys.filter((item) => item !== key),
    }));
    if (target) {
      const refreshed = this.getProject(target.id);
      refreshed.repositoryKeys.push(key);
    }
    await this.save();
    return this.organization;
  }

  async moveRepositoryProject(projectId: string, toIndex: number): Promise<RepositoryOrganization> {
    this.data.repositoryProjects = moveToIndex(this.data.repositoryProjects, projectId, toIndex, (project) => project.id);
    await this.save();
    return this.organization;
  }

  /** Move within the assigned project, or within the unassigned repositories. */
  async moveRepository(repositoryKey: string, toIndex: number): Promise<RepositoryOrganization> {
    const key = normalizeRepositoryKey(repositoryKey);
    const keys = [...new Set(this.data.recentRepositories.map((item) => normalizeRepositoryKey(item.commonDir)))];
    const known = new Set(keys);
    const project = this.data.repositoryProjects.find((item) => item.repositoryKeys.includes(key));
    if (project) {
      const visible = project.repositoryKeys.filter((item) => known.has(item));
      project.repositoryKeys = [...moveToIndex(visible, key, toIndex, (item) => item), ...project.repositoryKeys.filter((item) => !known.has(item))];
    } else {
      const assigned = new Set(this.data.repositoryProjects.flatMap((item) => item.repositoryKeys));
      const unassigned = moveToIndex(keys.filter((item) => !assigned.has(item)), key, toIndex, (item) => item);
      let index = 0;
      const ordered = keys.map((item) => assigned.has(item) ? item : unassigned[index++]!);
      const positions = new Map(ordered.map((item, position) => [item, position]));
      this.data.recentRepositories = [...this.data.recentRepositories].sort((a, b) => positions.get(normalizeRepositoryKey(a.commonDir))! - positions.get(normalizeRepositoryKey(b.commonDir))!);
    }
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
    next.monoFont = isMonoFont(next.monoFont) ? next.monoFont : 'jetbrains-mono';
    next.commitMessageHarness = isHarness(next.commitMessageHarness) ? next.commitMessageHarness : 'codex';
    next.commitMessageModels = modelPreferences(next.commitMessageModels);
    next.aiExecutablePaths = executablePaths(next.aiExecutablePaths, true);
    // Ignore the retired switch sent by older clients, including a saved false.
    delete (next as Preferences & { aiShellEnvironment?: unknown }).aiShellEnvironment;
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
    ? input.recentRepositories.filter(isRecent).map(normalizeRecent)
    : [];
  const repositoryProjects = normalizeProjects(input.repositoryProjects);
  // Preserve the picker order from installations that ordered projects by recent use.
  if (input.version !== SETTINGS_SCHEMA_VERSION) {
    const keys = [...new Set(recentRepositories.map((item) => normalizeRepositoryKey(item.commonDir)))];
    const known = new Set(keys);
    for (const project of repositoryProjects) {
      const assigned = new Set(project.repositoryKeys);
      project.repositoryKeys = [...keys.filter((key) => assigned.has(key)), ...project.repositoryKeys.filter((key) => !known.has(key))];
    }
  }
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
        monoFont: isMonoFont(parsedPreferences.data.monoFont) ? parsedPreferences.data.monoFont : 'jetbrains-mono',
        commitMessageHarness: isHarness(parsedPreferences.data.commitMessageHarness) ? parsedPreferences.data.commitMessageHarness : 'codex',
        commitMessageModels: modelPreferences(parsedPreferences.data.commitMessageModels),
        aiExecutablePaths: executablePaths(parsedPreferences.data.aiExecutablePaths),
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
    githubAccounts: normalizeGitHubAccounts(input.githubAccounts),
    githubDefaultLogin: typeof input.githubDefaultLogin === 'string' && githubAccountSelectionSchema.safeParse({ mode: 'account', host: 'github.com', login: input.githubDefaultLogin }).success ? input.githubDefaultLogin : null,
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

function moveToIndex<T>(items: T[], key: string, toIndex: number, keyOf: (item: T) => string): T[] {
  const fromIndex = items.findIndex((item) => keyOf(item) === key);
  if (fromIndex < 0) throw projectError('Unknown project or repository.');
  if (!Number.isSafeInteger(toIndex) || toIndex < 0 || toIndex >= items.length) throw projectError('Invalid ordering position.');
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return next;
}

function cloneFilesTreeState(state: FilesTreeState): FilesTreeState {
  return { ...state, expandedPaths: [...state.expandedPaths] };
}

function projectError(message: string): GitOperationError {
  return new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'repository-projects', message });
}

function isHarness(value: unknown): value is AiHarnessId {
  return value === 'codex' || value === 'claude' || value === 'opencode' || value === 'grok';
}

function normalizeUiFont(value: unknown): UiFontPreference {
  // Replace preferences saved by versions that exposed the removed Fontshare faces.
  if (value === 'cabinet-grotesk' || value === 'satoshi') return 'plus-jakarta-sans';
  return value === 'geist' || value === 'plus-jakarta-sans' || value === 'space-grotesk' ? value : 'plus-jakarta-sans';
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
  const result: Partial<Record<AiHarnessId, string>> = { codex: 'default', claude: 'default', opencode: 'default', grok: 'default' };
  if (!value || typeof value !== 'object') return result;
  for (const harness of ['codex', 'claude', 'opencode', 'grok'] as const) {
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

export function executablePaths(value: unknown, strict = false, platform = process.platform, home = os.homedir()): Partial<Record<AiHarnessId, string>> {
  const result: Partial<Record<AiHarnessId, string>> = {};
  const invalid = () => { if (strict) throw projectError('CLI executable paths must be absolute paths on the backend host, without arguments or control characters.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid(); return result; }
  const p = platform === 'win32' ? path.win32 : path.posix;
  for (const [key, raw] of Object.entries(value)) {
    if (!isHarness(key) || typeof raw !== 'string') { invalid(); continue; }
    if (!raw.trim()) continue;
    const expanded = raw.startsWith('~/') ? p.join(home, raw.slice(2)) : raw;
    if (raw.length > 4096 || hasControlCharacters(raw) || !p.isAbsolute(expanded) || (platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\)/i.test(expanded))) { invalid(); continue; }
    result[key] = expanded;
  }
  return result;
}

function normalizeGitHubAccounts(value: unknown): Record<string, GitHubAccountSelection> {
  const result: Record<string, GitHubAccountSelection> = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, selection] of Object.entries(value).slice(0, 1000)) {
    if (!key || key.length > MAX_REPOSITORY_KEY_LENGTH || hasControlCharacters(key) || !path.isAbsolute(key)) continue;
    const parsed = githubAccountSelectionSchema.safeParse(selection);
    if (parsed.success && parsed.data.mode === 'account') result[githubRepositoryKey(key)] = parsed.data;
  }
  return result;
}
