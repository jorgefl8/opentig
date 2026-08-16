import path from 'node:path';
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { FileService } from './main/files/FileService';
import { FileOperationHistory } from './main/files/FileOperationHistory';
import { RepositoryWatcher } from './main/files/RepositoryWatcher';
import { GitProcess } from './main/git/GitProcess';
import { GitRepositoryOperations } from './main/git/GitRepositoryOperations';
import { RepositoryService } from './main/git/RepositoryService';
import { SearchService } from './main/git/SearchService';
import { registerHandlers } from './main/ipc/register-handlers';
import { AiLogStore } from './main/persistence/AiLogStore';
import { SettingsStore } from './main/persistence/SettingsStore';
import { IPC } from './shared/contracts';
import { CliProcessRunner } from './main/ai/CliProcessRunner';
import { CliResolver } from './main/ai/CliResolver';
import { CommitMessageService } from './main/ai/CommitMessageService';
import { CodexProvider } from './main/ai/providers/CodexProvider';
import { ClaudeProvider } from './main/ai/providers/ClaudeProvider';
import { OpenCodeProvider } from './main/ai/providers/OpenCodeProvider';
import { PullRequestDraftService } from './main/ai/PullRequestDraftService';
import { GitHubService } from './main/github/GitHubService';
import { createPerformanceSampler, type PerformanceSampler } from './main/performance/PerformanceSampler';
import { startPerformanceAutomation } from './main/performance/PerformanceAutomation';
import { mergeRepositoryChangeScopes, type RepositoryChangeScope } from './shared/repository-change';
import { startGlobalDoubleControlShortcut } from './main/shortcuts/GlobalDoubleControlShortcut';
import { getWindowTitleBarOptions, shouldUseDarkTitleBar } from './main/window/WindowTitleBar';

if (started) app.quit();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let performanceSampler: PerformanceSampler | null = null;
let stopGlobalDoubleControlShortcut: (() => void) | null = null;
const settingsStores = new Set<SettingsStore>();
let shutdownStarted = false;
let shutdownReady = false;

function showAndFocusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow(): Promise<void> {
  const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  settingsStores.add(settings);
  await settings.load();
  const git = new GitProcess();
  const repositories = new RepositoryService(git, settings);
  const files = new FileService(git, repositories);
  const fileHistory = new FileOperationHistory(files, { trashItem: (target) => shell.trashItem(target) });
  const search = new SearchService(git, repositories, files, fileHistory);
  const operations = new GitRepositoryOperations(git, repositories, files);
  const cliResolver = new CliResolver();
  const cliRunner = new CliProcessRunner();
  const providers = [
    new CodexProvider(cliResolver, cliRunner),
    new ClaudeProvider(cliResolver, cliRunner),
    new OpenCodeProvider(cliResolver, cliRunner),
  ];
  const aiLog = new AiLogStore(path.join(app.getPath('userData'), 'ai-log.jsonl'));
  await aiLog.load();
  const ai = new CommitMessageService(operations, providers, aiLog);
  const prDrafts = new PullRequestDraftService(operations, providers, aiLog);
  const github = new GitHubService(cliResolver, cliRunner, git, repositories);

  mainWindow = new BrowserWindow({
    ...settings.windowBounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#171614',
    title: 'JustGit',
    autoHideMenuBar: true,
    ...getWindowTitleBarOptions(
      shouldUseDarkTitleBar(settings.preferences.theme, nativeTheme.shouldUseDarkColors),
      process.platform,
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Always start maximized (filling the work area); persisted bounds remain the
  // restore-down size. Maximizing while hidden avoids a non-maximized flash.
  mainWindow.maximize();

  let lastNotifiedAt = 0;
  let trailingNotify: NodeJS.Timeout | null = null;
  let stopPerformanceAutomation: () => void = () => {};
  let trailingChange: { repositoryId: string; scope: RepositoryChangeScope } | null = null;
  const notifyRepositoryChanged = (repositoryId: string, scope: RepositoryChangeScope) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    const elapsed = Date.now() - lastNotifiedAt;
    // At most one refresh per second: bursts collapse into a trailing send.
    if (elapsed < 1_000) {
      trailingChange = trailingChange?.repositoryId === repositoryId
        ? { repositoryId, scope: mergeRepositoryChangeScopes(trailingChange.scope, scope) }
        : { repositoryId, scope };
      if (!trailingNotify) {
        trailingNotify = setTimeout(() => {
          trailingNotify = null;
          const change = trailingChange;
          trailingChange = null;
          if (change) notifyRepositoryChanged(change.repositoryId, change.scope);
        }, 1_000 - elapsed);
      }
      return;
    }
    lastNotifiedAt = Date.now();
    mainWindow.webContents.send(IPC.repositoryChanged, repositoryId, scope);
  };
  const watcher = new RepositoryWatcher(notifyRepositoryChanged, () => git.hasActiveProcess());
  const removeHandlers = registerHandlers({ window: mainWindow, settings, repositories, search, files, fileHistory, operations, watcher, ai, aiLog, github, prDrafts });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('hide', () => watcher.stop());
  mainWindow.on('show', () => {
    const id = settings.activeRepositoryId;
    if (id) {
      try { watcher.start(repositories.get(id)); } catch { /* recent path may have gone away */ }
    }
  });
  mainWindow.on('focus', () => {
    if (Date.now() - lastNotifiedAt < 2_000) return;
    const id = settings.activeRepositoryId;
    if (id) notifyRepositoryChanged(id, 'unknown');
  });
  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getNormalBounds();
    void settings.setWindowBounds({ width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y });
  });
  mainWindow.on('closed', () => {
    if (trailingNotify) clearTimeout(trailingNotify);
    trailingNotify = null;
    trailingChange = null;
    stopPerformanceAutomation();
    watcher.stop();
    void ai.close();
    prDrafts.close();
    removeHandlers();
    fileHistory.clear();
    void settings.flush()
      .then(() => settingsStores.delete(settings))
      .catch((error) => console.error('Could not flush JustGit settings.', error));
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else await mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  if (!mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    stopPerformanceAutomation = startPerformanceAutomation(mainWindow, performanceSampler);
  }
}

app.on('second-instance', () => {
  showAndFocusMainWindow();
});

app.whenReady().then(async () => {
  try {
    performanceSampler = await createPerformanceSampler(app);
    performanceSampler?.start();
  } catch (error) {
    console.error('Could not start the JustGit performance sampler.', error);
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await createWindow();
  try {
    stopGlobalDoubleControlShortcut = startGlobalDoubleControlShortcut(showAndFocusMainWindow);
  } catch (error) {
    console.error('Could not start the global double-Control shortcut.', error);
  }
});

app.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  stopGlobalDoubleControlShortcut?.();
  stopGlobalDoubleControlShortcut = null;
  const sampler = performanceSampler;
  performanceSampler = null;
  const tasks: Promise<unknown>[] = [...settingsStores].map((settings) => settings.flush());
  if (sampler) tasks.push(sampler.stop());
  void Promise.allSettled(tasks).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.error('Could not finish a JustGit shutdown task.', result.reason);
    }
  }).finally(() => {
    shutdownReady = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
