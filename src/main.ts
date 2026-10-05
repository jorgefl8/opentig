import path from 'node:path';
import { networkInterfaces } from 'node:os';
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  screen,
  session,
  shell,
  utilityProcess,
  type WebContents,
} from 'electron';
import { createElectronHostAdapter } from './main/ipc/ElectronHostAdapter';
import { registerDesktopHandlers } from './main/ipc/registerDesktopHandlers';
import { createPerformanceSampler, type PerformanceSampler } from './main/performance/PerformanceSampler';
import { startPerformanceAutomation } from './main/performance/PerformanceAutomation';
import {
  ServerProcessManager,
  type ServerProcessAddress,
  type ServerProcessState,
} from './main/server/ServerProcessManager';
import { DesktopServerSettings } from './main/server/DesktopServerSettings';
import { startGlobalDoubleControlShortcut } from './main/shortcuts/GlobalDoubleControlShortcut';
import { boundsVisibleOnDisplays, browserWindowBounds, DesktopWindowState } from './main/window/DesktopWindowState';
import { getWindowTitleBarOptions, readStartupDark, startupBackground } from './main/window/WindowTitleBar';
import { serverErrorPageUrl, serverRecoveryAction } from './main/window/ServerErrorPage';
import { normalizeExternalUrl } from './shared/external-url';
import type { OpenTigPairingLink, OpenTigWebAccessStatus } from './shared/desktop-api';
import type { OpenTigServerHost } from './shared/server-process';
import { applicationName, preferredServerPort, sessionCookieName } from './shared/application-profile';
import { configureDesktopProfile } from './main/profile/DesktopProfile';
import { createDesktopUpdater } from './main/updates/createDesktopUpdater';
import type { DesktopUpdater } from './main/updates/DesktopUpdater';

const applicationProfile = (() => {
  try { return configureDesktopProfile(app, __OPENTIG_BUILD_PROFILE__, process.platform); }
  catch (error) {
    dialog.showErrorBox('OpenTig profile error', error instanceof Error ? error.message : 'Could not initialize the application profile.');
    app.exit(1);
    throw error;
  }
})();
const displayName = applicationName(applicationProfile);
const desktopCookieName = sessionCookieName(applicationProfile);
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.exit(0);

let mainWindow: BrowserWindow | null = null;
let desktopUpdater: DesktopUpdater | null = null;
let serverManager: ServerProcessManager | null = null;
let desktopServerSettings: DesktopServerSettings | null = null;
let windowState: DesktopWindowState | null = null;
let allowedServerOrigin: string | null = null;
let performanceSampler: PerformanceSampler | null = null;
let stopGlobalDoubleControlShortcut: (() => void) | null = null;
let shutdownStarted = false;
let shutdownReady = false;
let webAccessEnabled = false;
let serverState: ServerProcessState = { status: 'stopped' };
let webAccessRestartError: string | null = null;
let webAccessMutation: Promise<void> = Promise.resolve();

const SHOW_WINDOW_FALLBACK_MS = 8_000;

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
  if (!serverManager || !windowState) throw new Error('Desktop services are not initialized.');
  const manager = serverManager;
  const placement = await windowState.load();
  const bounds = boundsVisibleOnDisplays(
    browserWindowBounds(placement),
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
  );
  const dark = await readStartupDark(path.join(app.getPath('userData'), 'settings.json'), nativeTheme.shouldUseDarkColors);
  const backgroundColor = startupBackground(dark);
  let errorPageUrl: string | null = null;
  let restartRequested = false;
  const serverLogPath = path.join(app.getPath('userData'), 'logs', 'server.log');

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(900, bounds.width),
    minHeight: Math.min(600, bounds.height),
    show: false,
    backgroundColor,
    title: `${displayName} — Starting…`,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    ...getWindowTitleBarOptions(dark, process.platform),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // Hidden Chromium windows throttle rAF, so the HTML boot splash would
      // not paint and ready-to-show would stall. Restore throttling after
      // the first reveal, matching T3 Code's desktop boot.
      backgroundThrottling: false,
    },
  });
  mainWindow.on('focus', () => desktopUpdater?.checkIfDue());
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle(displayName);
  });
  // Restore maximized while still hidden, and wait until Windows has applied
  // the work-area size, so the first HTML splash layout fills the window.
  // maximize() can also show the window on Windows; hide again if it leaked.
  if (placement.isMaximized) await maximizeWhileHidden(mainWindow);

  let revealed = false;
  let allowReveal = false;
  const revealWindow = (force = false) => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    if (!force && !allowReveal) return;
    revealed = true;
    clearTimeout(revealTimer);
    mainWindow.webContents.setBackgroundThrottling(true);
    mainWindow.setTitle(displayName);
    mainWindow.show();
    mainWindow.focus();
  };
  const revealTimer = setTimeout(() => revealWindow(true), SHOW_WINDOW_FALLBACK_MS);
  mainWindow.once('ready-to-show', () => revealWindow());

  let stopPerformanceAutomation: () => void = () => {};
  const host = createElectronHostAdapter(mainWindow);
  const removeHandlers = registerDesktopHandlers(host, applyDoubleControlShortcutPreference, {
    getStatus: getWebAccessStatus,
    setEnabled: setWebAccessEnabled,
    createPairingLink,
  }, desktopUpdater ?? undefined, (event) => (
    event.sender === mainWindow?.webContents
    && event.senderFrame === mainWindow?.webContents.mainFrame
    && allowedServerOrigin !== null && safeOrigin(event.senderFrame.url) === allowedServerOrigin
  ));
  mainWindow.webContents.on('will-prevent-unload', () => desktopUpdater?.cancelInstall());

  const openExternal = (value: string) => {
    const url = normalizeExternalUrl(value);
    if (url) void shell.openExternal(url).catch((error) => console.error('Could not open external URL.', error));
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === errorPageUrl || (allowedServerOrigin && safeOrigin(url) === allowedServerOrigin)) return;
    event.preventDefault();
    const recovery = serverRecoveryAction(mainWindow?.webContents.getURL() ?? '', errorPageUrl, url);
    if (recovery === 'restart') {
      if (!restartRequested && !shutdownStarted) {
        restartRequested = true;
        app.relaunch();
        app.quit();
      }
      return;
    }
    if (recovery === 'openLog') {
      void shell.openPath(serverLogPath).then((message) => {
        if (message) dialog.showErrorBox('Could not open the server log', message);
      }).catch((error) => dialog.showErrorBox('Could not open the server log', String(error)));
      return;
    }
    openExternal(url);
  });
  mainWindow.on('close', () => {
    if (!mainWindow || !windowState) return;
    const normal = mainWindow.getNormalBounds();
    void windowState.save({
      width: normal.width,
      height: normal.height,
      x: normal.x,
      y: normal.y,
      isMaximized: mainWindow.isMaximized(),
    });
  });
  mainWindow.on('closed', () => {
    clearTimeout(revealTimer);
    stopPerformanceAutomation();
    removeHandlers();
    mainWindow = null;
  });

  try {
    await manager.start();
    const server = manager.current;
    if (!server) throw new Error('OpenTig server stopped during startup.');
    allowedServerOrigin = server.origin;
    allowReveal = true;
    await mainWindow.loadURL(server.origin);
    if (!mainWindow.isDestroyed()) {
      stopPerformanceAutomation = startPerformanceAutomation(mainWindow, performanceSampler);
      // Catch up if ready-to-show already fired while the window was still
      // hidden waiting for the server. The HTML boot splash is in the document
      // by this point, so this is not the empty-chrome frame.
      revealWindow();
    }
  } catch (error) {
    await manager.recordDesktopFailure(error);
    allowedServerOrigin = null;
    errorPageUrl = serverErrorPageUrl({ displayName, dark, logPath: serverLogPath, appVersion: app.getVersion(), error });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`${displayName} — Server error`);
      allowReveal = true;
      await mainWindow.loadURL(errorPageUrl).catch(() => undefined);
      revealWindow(true);
    }
  }
}

function createServerManager(): ServerProcessManager {
  const userData = app.getPath('userData');
  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'opentig-server')
    : path.join(app.getAppPath(), 'packages', 'server', '.resource', 'opentig-server');
  return new ServerProcessManager({
    modulePath: path.join(serverRoot, 'utility.mjs'),
    cwd: userData,
    logPath: path.join(userData, 'logs', 'server.log'),
    settingsPath: path.join(userData, 'settings.json'),
    aiLogPath: path.join(userData, 'ai-log.jsonl'),
    serverDataPath: path.join(userData, 'server'),
    clientRoot: path.join(serverRoot, 'client'),
    ...(app.isPackaged
      ? { trashModulePath: path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'trash', 'index.js') }
      : {}),
    appVersion: app.getVersion(),
    profile: applicationProfile,
    preferredPort: preferredServerPort(applicationProfile),
    platform: normalizePlatform(process.platform),
    host: webAccessEnabled ? '0.0.0.0' : '127.0.0.1',
    fork: (modulePath, args, options) => utilityProcess.fork(modulePath, args, options),
    onReady: installDesktopSession,
    onState: applyServerState,
  });
}

function applyServerState(state: ServerProcessState): void {
  serverState = state;
  if (state.status === 'ready') {
    allowedServerOrigin = state.origin;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(displayName);
  } else if (state.status === 'restarting') {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(`${displayName} — Reconnecting…`);
  } else if (state.status === 'failed') {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(`${displayName} — Server offline`);
  }
}

function setWebAccessEnabled(enabled: boolean): Promise<OpenTigWebAccessStatus> {
  const operation = webAccessMutation.then(async () => {
    const manager = serverManager;
    const settings = desktopServerSettings;
    if (!manager || !settings) throw new Error('OpenTig desktop server is not initialized.');
    if (enabled === webAccessEnabled) return getWebAccessStatus();
    webAccessRestartError = null;
    const previousHost: OpenTigServerHost = webAccessEnabled ? '0.0.0.0' : '127.0.0.1';
    const nextHost: OpenTigServerHost = enabled ? '0.0.0.0' : '127.0.0.1';
    try {
      await manager.restart(nextHost);
      try {
        await settings.save({ webAccessEnabled: enabled });
      } catch (error) {
        await manager.restart(previousHost);
        throw error;
      }
      webAccessEnabled = enabled;
      return getWebAccessStatus();
    } catch (error) {
      webAccessRestartError = error instanceof Error ? error.message : 'OpenTig could not restart network access.';
      throw error;
    }
  });
  webAccessMutation = operation.then(() => undefined, () => undefined);
  return operation;
}

async function getWebAccessStatus(): Promise<OpenTigWebAccessStatus> {
  const manager = serverManager;
  const current = manager?.current ?? null;
  let connectedSessionCount = 0;
  if (current) {
    try { connectedSessionCount = (await manager!.getStatus()).connectedSessionCount; }
    catch { /* restarting or offline */ }
  }
  const actualPort = current?.port ?? ('port' in serverState ? serverState.port : null);
  return {
    enabled: webAccessEnabled,
    serverState: serverState.status,
    actualPort,
    localEndpoint: actualPort === null ? null : `http://127.0.0.1:${actualPort}`,
    networkEndpoints: actualPort === null ? [] : networkEndpoints(actualPort),
    pairingEndpoints: actualPort === null ? [] : pairingEndpoints(actualPort),
    connectedSessionCount,
    restartError: webAccessRestartError,
  };
}

async function createPairingLink(endpoint: string): Promise<OpenTigPairingLink> {
  const manager = serverManager;
  if (!manager?.current) throw new Error('OpenTig server is not ready.');
  if (!pairingEndpoints(manager.current.port).includes(endpoint)) throw new Error('Select an active OpenTig pairing endpoint.');
  return manager.createPairingLink(endpoint);
}

function pairingEndpoints(port: number): string[] {
  const endpoints = [`http://127.0.0.1:${port}`];
  if (webAccessEnabled) endpoints.push(...networkEndpoints(port));
  return [...new Set(endpoints)];
}

function networkEndpoints(port: number): string[] {
  const endpoints = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' || entry.address.startsWith('169.254.')) continue;
      endpoints.add(`http://${entry.address}:${port}`);
    }
  }
  return [...endpoints].sort();
}

async function installDesktopSession(server: ServerProcessAddress, desktopSecret: string): Promise<void> {
  const cookies = await session.defaultSession.cookies.get({ url: server.origin, name: desktopCookieName });
  const currentCookie = cookies[0]?.value;
  const descriptor = await fetch(`${server.origin}/api/auth/descriptor`, {
    headers: currentCookie ? { Cookie: `${desktopCookieName}=${currentCookie}` } : {},
  });
  if (descriptor.ok) {
    const state = await descriptor.json() as { authenticated?: unknown; currentSessionKind?: unknown };
    if (state.authenticated === true && state.currentSessionKind === 'desktop') return;
  }
  const response = await fetch(`${server.origin}/api/auth/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ secret: desktopSecret }),
  });
  if (response.status !== 204) throw new Error('Could not authenticate the desktop with the OpenTig server.');
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('OpenTig server did not return a desktop session.');
  await installDesktopSessionCookie(server.origin, cookie);
}

async function installDesktopSessionCookie(origin: string, cookie: string): Promise<void> {
  const value = cookie.match(new RegExp(`^${desktopCookieName}=([^;]+)`))?.[1];
  if (!value) throw new Error('OpenTig server returned an invalid desktop session.');
  await session.defaultSession.cookies.set({
    url: origin,
    name: desktopCookieName,
    value,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
  });
  const cookies = await session.defaultSession.cookies.get({ url: origin, name: desktopCookieName });
  if (cookies.length === 0) throw new Error('Could not install the OpenTig desktop session.');
}

function safeOrigin(value: string): string | null {
  try { return new URL(value).origin; } catch { return null; }
}
function normalizePlatform(platform: NodeJS.Platform): 'win32' | 'darwin' | 'linux' | 'other' {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'other';
}

/** Maximize a still-hidden window and wait for the OS size before first paint. */
function maximizeWhileHidden(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (win.isDestroyed() || win.isMaximized()) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      win.removeListener('maximize', finish);
      if (!win.isDestroyed() && win.isVisible()) win.hide();
      resolve();
    };
    win.once('maximize', finish);
    win.maximize();
    if (win.isMaximized()) finish();
    else setTimeout(finish, 100);
  });
}

app.on('second-instance', () => {
  showAndFocusMainWindow();
});

app.whenReady().then(async () => {
  desktopUpdater = await createDesktopUpdater(applicationProfile, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else app.quit();
  });
  try {
    performanceSampler = await createPerformanceSampler(app);
    performanceSampler?.start();
  } catch (error) {
    console.error('Could not start the OpenTig performance sampler.', error);
  }
  const userData = app.getPath('userData');
  windowState = new DesktopWindowState(
    path.join(userData, 'desktop-window.json'),
    path.join(userData, 'settings.json'),
  );
  desktopServerSettings = new DesktopServerSettings(path.join(userData, 'desktop-server.json'));
  const serverSettings = await desktopServerSettings.load();
  webAccessEnabled = serverSettings.webAccessEnabled;
  serverManager = createServerManager();

  const clipboardPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  const trustedClipboardRequest = (webContents: WebContents | null, permission: string) => (
    webContents === mainWindow?.webContents && clipboardPermissions.has(permission)
  );
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => trustedClipboardRequest(webContents, permission));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(trustedClipboardRequest(webContents, permission)));
  await createWindow();
  desktopUpdater.start();
});

app.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  desktopUpdater?.stop();
  stopGlobalDoubleControlShortcut?.();
  stopGlobalDoubleControlShortcut = null;
  const sampler = performanceSampler;
  const manager = serverManager;
  const desktopState = windowState;
  const serverSettings = desktopServerSettings;
  performanceSampler = null;
  serverManager = null;
  windowState = null;
  desktopServerSettings = null;
  const tasks: Promise<unknown>[] = [];
  if (manager) tasks.push(manager.stop());
  if (sampler) tasks.push(sampler.stop());
  if (desktopState) tasks.push(desktopState.flush());
  if (serverSettings) tasks.push(serverSettings.flush());
  void Promise.allSettled(tasks).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.error('Could not finish an OpenTig shutdown task.', result.reason);
    }
  }).finally(() => {
    shutdownReady = true;
    if (desktopUpdater?.installRequested) {
      if (desktopUpdater.finishInstall()) return;
      dialog.showErrorBox('OpenTig update could not start', 'Your current installation has been preserved. Reopen OpenTig to try the update again.');
    }
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
