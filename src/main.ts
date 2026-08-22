import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme, session, shell, type WebContents } from 'electron';
import started from 'electron-squirrel-startup';
import { OPEN_TIG_SESSION_COOKIE, OneTimeBootstrapAuthSource } from '../packages/server/src/auth';
import { runOpenTigServer, type RunningOpenTigServer } from '../packages/server/src/server';
import { createElectronHostAdapter } from './main/ipc/ElectronHostAdapter';
import { registerDesktopHandlers } from './main/ipc/registerDesktopHandlers';
import { createPerformanceSampler, type PerformanceSampler } from './main/performance/PerformanceSampler';
import { startPerformanceAutomation } from './main/performance/PerformanceAutomation';
import { normalizeRuntimePlatform } from './main/runtime/create-runtime';
import { SystemTrash } from './main/platform/SystemTrash';
import { startGlobalDoubleControlShortcut } from './main/shortcuts/GlobalDoubleControlShortcut';
import { getWindowTitleBarOptions, shouldUseDarkTitleBar } from './main/window/WindowTitleBar';
import { normalizeExternalUrl } from './shared/external-url';

if (started) app.quit();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let runningServer: RunningOpenTigServer | null = null;
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
  const server = await ensureServer();
  const runtime = server.runtime;
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
  const host = createElectronHostAdapter(mainWindow);
  const removeHandlers = registerDesktopHandlers(
    runtime.services.repositories,
    host,
    applyDoubleControlShortcutPreference,
  );

  const openExternal = (value: string) => {
    const url = normalizeExternalUrl(value);
    if (url) void shell.openExternal(url).catch((error) => console.error('Could not open external URL.', error));
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === server.origin) return;
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.on('focus', () => runtime.refreshActiveRepositoryIfStale());
  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getNormalBounds();
    void settings.setWindowBounds({ width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y });
  });
  mainWindow.on('closed', () => {
    stopPerformanceAutomation();
    removeHandlers();
    mainWindow = null;
  });

  await mainWindow.loadURL(server.origin);
  if (!mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    stopPerformanceAutomation = startPerformanceAutomation(mainWindow, performanceSampler);
  }
  applyDoubleControlShortcutPreference(settings.preferences.doubleControlShortcutEnabled);
}

async function ensureServer(): Promise<RunningOpenTigServer> {
  if (runningServer) return runningServer;
  const desktopSecret = randomBytes(32).toString('base64url');
  const userData = app.getPath('userData');
  const server = await runOpenTigServer({
    appVersion: app.getVersion(),
    auth: new OneTimeBootstrapAuthSource({ desktopSecret }),
    settingsPath: path.join(userData, 'settings.json'),
    aiLogPath: path.join(userData, 'ai-log.jsonl'),
    serverDataPath: path.join(userData, 'server'),
    clientRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'opentig-server', 'client')
      : path.join(app.getAppPath(), 'packages', 'server', '.client'),
    platform: normalizeRuntimePlatform(process.platform),
    trash: new SystemTrash(
      undefined,
      process.platform,
      app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'trash', 'index.js')
        : undefined,
    ),
    host: '127.0.0.1',
    port: 0,
    mode: 'desktop',
    logger: (level, message) => console[level](`[server] ${message}`),
  });
  try {
    await installDesktopSession(server.origin, desktopSecret);
  } catch (error) {
    await server.close();
    throw error;
  }
  runningServer = server;
  return server;
}

async function installDesktopSession(origin: string, desktopSecret: string): Promise<void> {
  let cookies = await session.defaultSession.cookies.get({ url: origin, name: OPEN_TIG_SESSION_COOKIE });
  const currentCookie = cookies[0]?.value;
  const descriptor = await fetch(`${origin}/api/auth/descriptor`, {
    headers: currentCookie ? { Cookie: `${OPEN_TIG_SESSION_COOKIE}=${currentCookie}` } : {},
  });
  if (descriptor.ok) {
    const state = await descriptor.json() as { authenticated?: unknown };
    if (state.authenticated === true) return;
  }
  const response = await fetch(`${origin}/api/auth/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ secret: desktopSecret }),
  });
  if (response.status !== 204) throw new Error('Could not authenticate the desktop with the OpenTig server.');
  const value = response.headers.get('set-cookie')?.match(new RegExp(`^${OPEN_TIG_SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!value) throw new Error('OpenTig server did not return a desktop session.');
  await session.defaultSession.cookies.set({
    url: origin,
    name: OPEN_TIG_SESSION_COOKIE,
    value,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
  });
  cookies = await session.defaultSession.cookies.get({ url: origin, name: OPEN_TIG_SESSION_COOKIE });
  if (cookies.length === 0) throw new Error('Could not install the OpenTig desktop session.');
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
  const clipboardPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  const trustedClipboardRequest = (webContents: WebContents | null, permission: string) => (
    webContents === mainWindow?.webContents && clipboardPermissions.has(permission)
  );
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => trustedClipboardRequest(webContents, permission));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(trustedClipboardRequest(webContents, permission)));
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
  const server = runningServer;
  performanceSampler = null;
  runningServer = null;
  const tasks: Promise<unknown>[] = [];
  if (server) tasks.push(server.close());
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
