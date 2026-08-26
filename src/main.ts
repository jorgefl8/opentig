import path from 'node:path';
import { networkInterfaces } from 'node:os';
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  session,
  shell,
  utilityProcess,
  type WebContents,
} from 'electron';
import started from 'electron-squirrel-startup';
import { createElectronHostAdapter } from './main/ipc/ElectronHostAdapter';
import { registerDesktopHandlers } from './main/ipc/registerDesktopHandlers';
import { createPerformanceSampler, type PerformanceSampler } from './main/performance/PerformanceSampler';
import { startPerformanceAutomation } from './main/performance/PerformanceAutomation';
import {
  ServerPortConflictError,
  ServerProcessManager,
  type ServerProcessAddress,
  type ServerProcessState,
} from './main/server/ServerProcessManager';
import { DesktopServerSettings } from './main/server/DesktopServerSettings';
import { startGlobalDoubleControlShortcut } from './main/shortcuts/GlobalDoubleControlShortcut';
import { DesktopWindowState } from './main/window/DesktopWindowState';
import { getWindowTitleBarOptions } from './main/window/WindowTitleBar';
import { normalizeExternalUrl } from './shared/external-url';
import type { OpenTigPairingLink, OpenTigWebAccessStatus } from './shared/desktop-api';
import type { OpenTigServerHost } from './shared/server-process';
import { OPEN_TIG_SESSION_COOKIE } from './shared/server-protocol';

if (started) app.quit();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow: BrowserWindow | null = null;
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

const CONNECTING_PAGE_URL = startupPageUrl('Starting OpenTig…', 'Connecting to the local server.');
const ERROR_PAGE_URL = startupPageUrl('OpenTig server is offline', 'See the server log for details, then restart OpenTig.');

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
  const bounds = await windowState.load();

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1c1c1c',
    title: 'OpenTig — Connecting…',
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    ...getWindowTitleBarOptions(nativeTheme.shouldUseDarkColors, process.platform),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  await mainWindow.loadURL(CONNECTING_PAGE_URL);
  mainWindow.maximize();
  mainWindow.show();
  mainWindow.focus();

  let stopPerformanceAutomation: () => void = () => {};
  const host = createElectronHostAdapter(mainWindow);
  const removeHandlers = registerDesktopHandlers(host, applyDoubleControlShortcutPreference, {
    getStatus: getWebAccessStatus,
    setEnabled: setWebAccessEnabled,
    createPairingLink,
  });

  const openExternal = (value: string) => {
    const url = normalizeExternalUrl(value);
    if (url) void shell.openExternal(url).catch((error) => console.error('Could not open external URL.', error));
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === CONNECTING_PAGE_URL || url === ERROR_PAGE_URL || (allowedServerOrigin && safeOrigin(url) === allowedServerOrigin)) return;
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.on('close', () => {
    if (!mainWindow || !windowState) return;
    const normal = mainWindow.getNormalBounds();
    void windowState.save({ width: normal.width, height: normal.height, x: normal.x, y: normal.y });
  });
  mainWindow.on('closed', () => {
    stopPerformanceAutomation();
    removeHandlers();
    mainWindow = null;
  });

  try {
    await serverManager.start();
    const server = serverManager.current;
    if (!server) throw new Error('OpenTig server stopped during startup.');
    allowedServerOrigin = server.origin;
    await mainWindow.loadURL(server.origin);
    if (!mainWindow.isDestroyed()) {
      mainWindow.setTitle('OpenTig');
      mainWindow.show();
      mainWindow.focus();
      stopPerformanceAutomation = startPerformanceAutomation(mainWindow, performanceSampler);
    }
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('OpenTig — Server error');
      await mainWindow.loadURL(ERROR_PAGE_URL).catch(() => undefined);
    }
    const message = error instanceof ServerPortConflictError
      ? error.message
      : 'The OpenTig server could not start. See the desktop server log for details.';
    dialog.showErrorBox('OpenTig server error', message);
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle('OpenTig');
  } else if (state.status === 'restarting') {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle('OpenTig — Reconnecting…');
  } else if (state.status === 'failed') {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle('OpenTig — Server offline');
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
  const cookies = await session.defaultSession.cookies.get({ url: server.origin, name: OPEN_TIG_SESSION_COOKIE });
  const currentCookie = cookies[0]?.value;
  const descriptor = await fetch(`${server.origin}/api/auth/descriptor`, {
    headers: currentCookie ? { Cookie: `${OPEN_TIG_SESSION_COOKIE}=${currentCookie}` } : {},
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
  const value = cookie.match(new RegExp(`^${OPEN_TIG_SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!value) throw new Error('OpenTig server returned an invalid desktop session.');
  await session.defaultSession.cookies.set({
    url: origin,
    name: OPEN_TIG_SESSION_COOKIE,
    value,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
  });
  const cookies = await session.defaultSession.cookies.get({ url: origin, name: OPEN_TIG_SESSION_COOKIE });
  if (cookies.length === 0) throw new Error('Could not install the OpenTig desktop session.');
}

function safeOrigin(value: string): string | null {
  try { return new URL(value).origin; } catch { return null; }
}

function startupPageUrl(heading: string, detail: string): string {
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 117.9 128" aria-hidden="true"><path fill="#FAFAFA" d="m113.9 42.6c-3.7-11.3-10.8-21.2-20.1-28.6-7.4-5.7-16.1-10-25.4-11.5-6.5-0.9-9.4-1.1-15.9-0.3-7.4 0.9-14.3 3.4-20.7 7-15.4 9.1-27.6 26.2-29.8 44.5-0.3 2.9-0.4 5.8-0.2 8.7 0.7 15.5 9.7 33.2 27.2 44.1l3.9 2.2c1.5 1.3 2.9 1.8 5.1 1.3 3.5-0.9 5.1-6.1 0.1-8.6-7.3-3.5-13.7-8.7-18.1-14.6-5-7-9-15.8-9.3-26.9-0.2-10 3.5-21.4 11.6-31.3 4.5-5.2 10.5-9.8 16.4-12.7 10.1-4.9 20.5-6.6 31.2-3.8 13.2 3.5 25.6 13.1 32.3 26.5 2.3 4.9 4.2 10.7 4.9 17.4 0.9 9.9-1.4 19.2-6.9 27.4-4.3 6.5-9.2 11-16.1 15.8l-4.1 2.1c-4.4 2.4-3.2 9.4 2.8 9 1.2 0 2.5-0.8 3.6-1.4 3.9-2 7.5-4.3 10.8-7 9.4-8 17.6-20.3 19.1-36.8 0.6-7.4-0.4-15.6-2.4-22.5z"/><path fill="#2266ea" d="m88.1 42.8c-3.6 0.3-7.4 2.9-9 7.3-5.5 0.8-14.1 3.6-20.3 12-4.3-6.3-11.6-10.7-19.7-12-1.1-3.8-5-7.5-10.2-7.2-4.1 0.4-8.7 3.8-8.7 9.7 0.2 6 5.7 10.3 11.1 9.3 2.8-0.3 5.2-2 6.6-4.3 6.7 1 14.9 4.7 17.3 14.1v36.7c-3.2 1.5-5.5 4.7-5.5 8.4 0 4.8 3.7 9.3 9.4 9.3s9.5-4.5 9.4-9.1c0.1-3.6-2.3-7.3-5.8-8.7v-36.4c1-5.6 5.9-10.9 13.3-13.3l3.9-1c1.8 2.9 4.9 4.6 8.6 4.5 4.6-0.2 9.3-3.6 9.3-9.5 0-5.6-4.9-10-9.7-9.8z"/></svg>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{height:100%;margin:0;background:#1c1c1c;color:#a3a3a3;font-family:system-ui,sans-serif}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}.logo{width:48px;height:52px}.logo svg{width:100%;height:100%}.copy{display:grid;gap:8px;text-align:center}h1{font-size:18px;font-weight:650;letter-spacing:-.02em;margin:0;color:#f4f4f4}p{font-size:13px;margin:0}.mark{width:28px;height:28px;border:3px solid #3a3a3a;border-top-color:#2266ea;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="logo">${logo}</div><div class="copy"><h1>${heading}</h1><p>${detail}</p></div><div class="mark" aria-hidden="true"></div></body></html>`;
  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

function normalizePlatform(platform: NodeJS.Platform): 'win32' | 'darwin' | 'linux' | 'other' {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'other';
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
});

app.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
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
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
