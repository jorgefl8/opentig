import path from 'node:path';
import { app, BrowserWindow, nativeTheme, session } from 'electron';
import started from 'electron-squirrel-startup';
import { registerHandlers } from './main/ipc/register-handlers';
import { IPC } from './shared/contracts';
import { createPerformanceSampler, type PerformanceSampler } from './main/performance/PerformanceSampler';
import { startPerformanceAutomation } from './main/performance/PerformanceAutomation';
import type { OpenTigRuntime } from './main/runtime/OpenTigRuntime';
import { createOpenTigRuntime, normalizeRuntimePlatform } from './main/runtime/create-runtime';
import { SystemTrash } from './main/platform/SystemTrash';
import { startGlobalDoubleControlShortcut } from './main/shortcuts/GlobalDoubleControlShortcut';
import { getWindowTitleBarOptions, shouldUseDarkTitleBar } from './main/window/WindowTitleBar';

if (started) app.quit();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let mainRuntime: OpenTigRuntime | null = null;
let performanceSampler: PerformanceSampler | null = null;
let stopGlobalDoubleControlShortcut: (() => void) | null = null;
let shutdownStarted = false;
let shutdownReady = false;

function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'opentig.ico')
    : path.join(app.getAppPath(), 'assets', 'opentig.ico');
}

function showAndFocusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function applyDoubleControlShortcutPreference(enabled: boolean): void {
  if (enabled === (stopGlobalDoubleControlShortcut !== null)) return;
  if (enabled) {
    try {
      stopGlobalDoubleControlShortcut = startGlobalDoubleControlShortcut(showAndFocusMainWindow);
    } catch (error) {
      console.error('Could not start the global double-Control shortcut.', error);
    }
  } else {
    stopGlobalDoubleControlShortcut?.();
    stopGlobalDoubleControlShortcut = null;
  }
}

async function createWindow(): Promise<void> {
  const runtime = await createOpenTigRuntime({
    settingsPath: path.join(app.getPath('userData'), 'settings.json'),
    aiLogPath: path.join(app.getPath('userData'), 'ai-log.jsonl'),
    runtimeMode: 'desktop',
    platform: normalizeRuntimePlatform(process.platform),
    trash: new SystemTrash(
      undefined,
      process.platform,
      app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'trash', 'index.js')
        : undefined,
    ),
    onEvent: (event) => {
      if (event.type !== 'repository.changed') return;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC.repositoryChanged, event.repositoryId, event.scope);
    },
  });
  mainRuntime = runtime;
  const { settings } = runtime.services;

  mainWindow = new BrowserWindow({
    ...settings.windowBounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#171614',
    title: 'OpenTig',
    icon: getAppIconPath(),
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

  let stopPerformanceAutomation: () => void = () => {};
  const removeHandlers = registerHandlers({
    ...runtime.services,
    window: mainWindow,
    onPreferencesChanged: (preferences) => applyDoubleControlShortcutPreference(preferences.doubleControlShortcutEnabled),
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('focus', () => runtime.refreshActiveRepositoryIfStale());
  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getNormalBounds();
    void settings.setWindowBounds({ width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y });
  });
  mainWindow.on('closed', () => {
    stopPerformanceAutomation();
    removeHandlers();
    void runtime.close()
      .then(() => { if (mainRuntime === runtime) mainRuntime = null; })
      .catch((error) => console.error('Could not flush OpenTig settings.', error));
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else await mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  if (!mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    stopPerformanceAutomation = startPerformanceAutomation(mainWindow, performanceSampler);
  }
  applyDoubleControlShortcutPreference(settings.preferences.doubleControlShortcutEnabled);
}

app.on('second-instance', () => {
  showAndFocusMainWindow();
});

app.whenReady().then(async () => {
  try {
    performanceSampler = await createPerformanceSampler(app);
    performanceSampler?.start();
  } catch (error) {
    console.error('Could not start the OpenTig performance sampler.', error);
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await createWindow();
});

app.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  stopGlobalDoubleControlShortcut?.();
  stopGlobalDoubleControlShortcut = null;
  const sampler = performanceSampler;
  const runtime = mainRuntime;
  performanceSampler = null;
  mainRuntime = null;
  const tasks: Promise<unknown>[] = [];
  if (runtime) tasks.push(runtime.close());
  if (sampler) tasks.push(sampler.stop());
  void Promise.allSettled(tasks).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.error('Could not finish an OpenTig shutdown task.', result.reason);
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
