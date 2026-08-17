import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from './SettingsStore';

const directories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
});

describe('SettingsStore AI preferences', () => {
  it('migrates settings created before AI preferences existed', async () => {
    const file = await settingsFile({ preferences: { theme: 'dark', diffView: 'split', sidebarWidth: 360, showDotEnvFiles: true, uiZoom: 100 } });
    const store = new SettingsStore(file);
    await store.load();
    expect(store.preferences.wrapLines).toBe(false);
    expect(store.preferences.commitMessageHarness).toBe('codex');
    expect(store.preferences.commitMessageModels).toMatchObject({ codex: 'default', claude: 'default', opencode: 'default' });
  });

  it('persists the line wrapping preference', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    await store.setPreferences({ wrapLines: true });
    expect(store.preferences.wrapLines).toBe(true);
    expect(await readFile(file, 'utf8')).toContain('"wrapLines": true');
  });

  it('persists valid selections and drops invalid model values', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    await store.setPreferences({ commitMessageHarness: 'claude', commitMessageModels: { claude: 'opus', codex: 'bad\nmodel' } });
    expect(store.preferences).toMatchObject({ commitMessageHarness: 'claude', commitMessageModels: { claude: 'opus', codex: 'default' } });
    expect(await readFile(file, 'utf8')).toContain('"claude": "opus"');
  });

  it('widens the legacy default sidebar while preserving custom widths', async () => {
    const legacyFile = await settingsFile({ preferences: { theme: 'system', diffView: 'unified', sidebarWidth: 340, showDotEnvFiles: true, uiZoom: 100 } });
    const customFile = await settingsFile({ preferences: { theme: 'system', diffView: 'unified', sidebarWidth: 360, showDotEnvFiles: true, uiZoom: 100 } });
    const legacy = new SettingsStore(legacyFile);
    const custom = new SettingsStore(customFile);
    await Promise.all([legacy.load(), custom.load()]);
    expect(legacy.preferences.sidebarWidth).toBe(400);
    expect(custom.preferences.sidebarWidth).toBe(360);
  });

  it('repairs corrupt fields without losing valid sibling preferences', async () => {
    const store = new SettingsStore(await settingsFile({
      preferences: { theme: 'dark', diffView: 'future', wrapLines: true, sidebarWidth: 'wide', showDotEnvFiles: false, uiZoom: 999, unknown: true },
    }));
    await store.load();
    expect(store.preferences).toMatchObject({ theme: 'dark', diffView: 'unified', wrapLines: true, sidebarWidth: 400, showDotEnvFiles: false, uiZoom: 130 });
  });

  it('migrates settings created before shortcut preferences existed', async () => {
    const file = await settingsFile({ preferences: { theme: 'dark', diffView: 'split', sidebarWidth: 360, showDotEnvFiles: true, uiZoom: 100 } });
    const store = new SettingsStore(file);
    await store.load();
    expect(store.preferences.shortcutOverrides).toEqual({});
    expect(store.preferences.doubleControlShortcutEnabled).toBe(true);
  });

  it('persists valid shortcut overrides and drops invalid, reserved, or colliding ones', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    await store.setPreferences({
      shortcutOverrides: { openRepository: 'Ctrl+K', refresh: 'Ctrl+1', quickOpen: 'not-a-combo' },
      doubleControlShortcutEnabled: false,
    });
    expect(store.preferences.shortcutOverrides).toEqual({ openRepository: 'Ctrl+K' });
    expect(store.preferences.doubleControlShortcutEnabled).toBe(false);
    expect(await readFile(file, 'utf8')).toContain('"openRepository": "Ctrl+K"');
  });
});

describe('SettingsStore repository projects', () => {
  it('migrates legacy settings without projects', async () => {
    const store = new SettingsStore(await settingsFile({ recentRepositories: [] }));
    await store.load();
    expect(store.repositoryProjects).toEqual([]);
  });

  it('creates, renames, assigns, and removes persisted projects', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    let organization = await store.createRepositoryProject(' Client ');
    const projectId = organization.repositoryProjects[0]!.id;
    await store.touchRepository(repository('app'));
    organization = await store.assignRepositoryProject('C:\\Repos\\App\\.git\\', projectId);
    expect(organization.repositoryProjects[0]).toMatchObject({ name: 'Client', repositoryKeys: ['c:/repos/app/.git'] });
    organization = await store.renameRepositoryProject(projectId, 'Work');
    expect(organization.repositoryProjects[0]?.name).toBe('Work');
    organization = await store.removeRepositoryProject(projectId);
    expect(organization.repositoryProjects).toEqual([]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ repositoryProjects: [] });
  });

  it('keeps each repository in only one project and rejects duplicate names', async () => {
    const store = new SettingsStore(await settingsFile({}));
    await store.load();
    const first = (await store.createRepositoryProject('Client')).repositoryProjects[0]!.id;
    const second = (await store.createRepositoryProject('Internal')).repositoryProjects[1]!.id;
    await expect(store.createRepositoryProject(' client ')).rejects.toThrow();
    await store.touchRepository(repository('repo'));
    await store.assignRepositoryProject('c:/repos/repo/.git', first);
    const organization = await store.assignRepositoryProject('C:\\REPOS\\REPO\\.git', second);
    expect(organization.repositoryProjects[0]?.repositoryKeys).toEqual([]);
    expect(organization.repositoryProjects[1]?.repositoryKeys).toEqual(['c:/repos/repo/.git']);
  });

  it('retains assigned and active repositories beyond ten unassigned recents', async () => {
    const store = new SettingsStore(await settingsFile({}));
    await store.load();
    const projectId = (await store.createRepositoryProject('Saved')).repositoryProjects[0]!.id;
    await store.touchRepository(repository('saved'));
    await store.assignRepositoryProject('c:/repos/saved/.git', projectId);
    for (let index = 0; index < 12; index += 1) await store.touchRepository(repository(`repo-${index}`));
    expect(store.recentRepositories.some((item) => item.id === 'saved')).toBe(true);
    expect(store.recentRepositories.some((item) => item.id === 'repo-0')).toBe(false);
    expect(store.recentRepositories.some((item) => item.id === 'repo-11')).toBe(true);
  });
});

describe('SettingsStore worktree recents', () => {
  /** Main plus two linked worktrees that all share one common dir. */
  async function repositoryWithWorktrees(file: string) {
    const store = new SettingsStore(file);
    await store.load();
    await store.touchRepository(worktree('main', 'C:\\repos\\app'));
    await store.touchRepository(worktree('review', 'C:\\repos\\app-trees\\review'));
    await store.touchRepository(worktree('spike', 'C:\\repos\\app-trees\\spike'));
    await store.touchRepository({ id: 'other', name: 'other', repositoryName: 'other', path: 'C:\\repos\\other', commonDir: 'C:\\repos\\other\\.git' });
    return store;
  }

  it('removes only the matching worktree and keeps its siblings and unrelated recents', async () => {
    const file = await settingsFile({});
    const store = await repositoryWithWorktrees(file);
    const recents = await store.forgetWorktreePath('C:\\repos\\app-trees\\review');
    expect(recents.map((item) => item.id).sort()).toEqual(['main', 'other', 'spike']);
    expect(JSON.parse(await readFile(file, 'utf8')).recentRepositories.map((item: { id: string }) => item.id).sort()).toEqual(['main', 'other', 'spike']);
  });

  it('matches paths regardless of casing, separators, and trailing slashes', async () => {
    const store = await repositoryWithWorktrees(await settingsFile({}));
    const recents = await store.forgetWorktreePath('c:/REPOS/App-Trees/Spike/');
    expect(recents.some((item) => item.id === 'spike')).toBe(false);
    expect(recents.some((item) => item.id === 'review')).toBe(true);
  });

  it('leaves the repository project assignment intact', async () => {
    const store = await repositoryWithWorktrees(await settingsFile({}));
    const projectId = (await store.createRepositoryProject('Client')).repositoryProjects[0]!.id;
    await store.assignRepositoryProject('C:\\repos\\app\\.git', projectId);
    await store.forgetWorktreePath('C:\\repos\\app-trees\\review');
    expect(store.repositoryProjects[0]).toMatchObject({ name: 'Client', repositoryKeys: ['c:/repos/app/.git'] });
    expect(store.recentRepositories.some((item) => item.id === 'main')).toBe(true);
  });

  it('refuses to remove the active repository and ignores unknown paths', async () => {
    const file = await settingsFile({});
    const store = await repositoryWithWorktrees(file);
    const before = store.recentRepositories;
    // `other` was opened last, so it is the active repository.
    expect(await store.forgetWorktreePath('C:\\repos\\other')).toEqual(before);
    expect(await store.forgetWorktreePath('C:\\repos\\never-opened')).toEqual(before);
    expect(await store.forgetWorktreePath('   ')).toEqual(before);
    expect(JSON.parse(await readFile(file, 'utf8')).recentRepositories).toHaveLength(4);
  });
});

describe('SettingsStore Files tree state', () => {
  const repositoryId = '0123456789abcdef';

  it('migrates absent or corrupt tree state without resetting sibling settings', async () => {
    const absent = new SettingsStore(await settingsFile({ preferences: { theme: 'dark', diffView: 'split', wrapLines: true, sidebarWidth: 420, showDotEnvFiles: false, uiZoom: 110 } }));
    const corrupt = new SettingsStore(await settingsFile({ filesTreeStates: 'bad', preferences: { theme: 'dark', diffView: 'split', wrapLines: true, sidebarWidth: 420, showDotEnvFiles: false, uiZoom: 110 } }));
    await Promise.all([absent.load(), corrupt.load()]);
    expect(absent.filesTreeStates).toEqual([]);
    expect(corrupt.filesTreeStates).toEqual([]);
    expect(corrupt.preferences).toMatchObject({ theme: 'dark', diffView: 'split', wrapLines: true, sidebarWidth: 420 });
  });

  it('coalesces updates until the debounce and persists the latest state', async () => {
    vi.useFakeTimers();
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    store.setFilesTreeExpandedPaths(repositoryId, ['src']);
    store.setFilesTreeExpandedPaths(repositoryId, ['src', 'docs']);
    await vi.advanceTimersByTimeAsync(749);
    expect(JSON.parse(await readFile(file, 'utf8')).filesTreeStates).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await store.flush();
    expect(JSON.parse(await readFile(file, 'utf8')).filesTreeStates[0].expandedPaths).toEqual(['docs', 'src']);
  });

  it('flushes pending state immediately and returns isolated clones', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    store.setFilesTreeExpandedPaths(repositoryId, ['src']);
    await store.flush();
    const clone = store.filesTreeStates;
    clone[0]!.expandedPaths.push('mutated');
    expect(store.filesTreeStates[0]?.expandedPaths).toEqual(['src']);
    expect(JSON.parse(await readFile(file, 'utf8')).filesTreeStates[0].expandedPaths).toEqual(['src']);
  });

  it('absorbs pending tree state into an immediate preference save and removes empty records', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    store.setFilesTreeExpandedPaths(repositoryId, ['src']);
    await store.setPreferences({ wrapLines: true });
    let persisted = JSON.parse(await readFile(file, 'utf8'));
    expect(persisted.filesTreeStates[0].expandedPaths).toEqual(['src']);
    store.setFilesTreeExpandedPaths(repositoryId, []);
    await store.flush();
    persisted = JSON.parse(await readFile(file, 'utf8'));
    expect(persisted.filesTreeStates).toEqual([]);
  });
});

describe('SettingsStore open files state', () => {
  const repositoryId = '0123456789abcdef';
  const tabs = [{ path: 'src/b.ts', pinned: true }, { path: 'src/a.ts', pinned: false }];

  it('migrates absent or corrupt open files state without resetting sibling settings', async () => {
    const absent = new SettingsStore(await settingsFile({}));
    const corrupt = new SettingsStore(await settingsFile({ openFilesStates: 'bad', preferences: { theme: 'dark', diffView: 'split', wrapLines: true, sidebarWidth: 420, showDotEnvFiles: false, uiZoom: 110 } }));
    await Promise.all([absent.load(), corrupt.load()]);
    expect(absent.openFilesStates).toEqual([]);
    expect(corrupt.openFilesStates).toEqual([]);
    expect(corrupt.preferences).toMatchObject({ theme: 'dark', diffView: 'split', wrapLines: true, sidebarWidth: 420 });
  });

  it('drops malformed stored records instead of restoring them', async () => {
    const store = new SettingsStore(await settingsFile({
      openFilesStates: [
        { repositoryId: 'nope', tabs, activePath: 'src/a.ts', previewPath: null, updatedAt: '2026-01-01T00:00:00.000Z' },
        { repositoryId, tabs: [{ path: '../escape.ts', pinned: false }], activePath: null, previewPath: null, updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
    }));
    await store.load();
    expect(store.openFilesStates).toEqual([]);
  });

  it('preserves hand-chosen tab order through a save and reload', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    store.setOpenFilesState(repositoryId, tabs, 'src/a.ts', 'src/a.ts');
    await store.flush();

    const reloaded = new SettingsStore(file);
    await reloaded.load();
    expect(reloaded.openFilesStates[0]?.tabs.map((tab) => tab.path)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(reloaded.openFilesStates[0]?.activePath).toBe('src/a.ts');
    expect(reloaded.openFilesStates[0]?.previewPath).toBe('src/a.ts');
  });

  it('coalesces updates until the debounce and never stores draft text', async () => {
    vi.useFakeTimers();
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    store.setOpenFilesState(repositoryId, [{ path: 'src/a.ts', pinned: false }], 'src/a.ts', 'src/a.ts');
    store.setOpenFilesState(repositoryId, tabs, 'src/b.ts', null);
    await vi.advanceTimersByTimeAsync(749);
    expect(JSON.parse(await readFile(file, 'utf8')).openFilesStates).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await store.flush();
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    expect(persisted.openFilesStates[0].activePath).toBe('src/b.ts');
    expect(JSON.stringify(persisted)).not.toContain('content');
  });

  it('flushes both background channels together and returns isolated clones', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    store.setFilesTreeExpandedPaths(repositoryId, ['src']);
    store.setOpenFilesState(repositoryId, tabs, 'src/a.ts', null);
    await store.flush();

    const persisted = JSON.parse(await readFile(file, 'utf8'));
    expect(persisted.filesTreeStates[0].expandedPaths).toEqual(['src']);
    expect(persisted.openFilesStates[0].tabs).toHaveLength(2);

    const clone = store.openFilesStates;
    clone[0]!.tabs.push({ path: 'mutated.ts', pinned: false });
    expect(store.openFilesStates[0]?.tabs).toHaveLength(2);
  });

  it('removes the state of a forgotten worktree', async () => {
    const file = await settingsFile({});
    const store = new SettingsStore(file);
    await store.load();
    await store.touchRepository(worktree('1111111111111111', 'C:\\repos\\app'));
    await store.touchRepository(worktree('2222222222222222', 'C:\\repos\\app-feature'));
    store.setOpenFilesState('1111111111111111', tabs, 'src/a.ts', null);
    await store.flush();
    expect(store.openFilesStates).toHaveLength(1);

    await store.forgetWorktreePath('C:\\repos\\app');
    expect(store.openFilesStates).toEqual([]);
    expect(JSON.parse(await readFile(file, 'utf8')).openFilesStates).toEqual([]);
  });
});

function repository(id: string) {
  return { id, name: id, repositoryName: id, path: `C:\\repos\\${id}`, commonDir: `C:\\repos\\${id}\\.git` };
}

/** Linked worktrees differ by path but share the repository's common dir. */
function worktree(id: string, worktreePath: string) {
  return { id, name: id, repositoryName: 'app', path: worktreePath, commonDir: 'C:\\repos\\app\\.git' };
}

async function settingsFile(value: object): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'justgit-settings-'));
  directories.push(directory);
  const file = path.join(directory, 'settings.json');
  await writeFile(file, JSON.stringify(value));
  return file;
}
