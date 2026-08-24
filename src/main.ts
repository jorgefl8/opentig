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
    backgroundColor: '#171614',
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{height:100%;margin:0;background:#171614;color:#f4f1ed;font-family:system-ui,sans-serif}body{display:grid;place-items:center}.state{text-align:center}.mark{width:28px;height:28px;margin:0 auto 18px;border:3px solid #5b5752;border-top-color:#e87847;border-radius:50%;animation:spin .8s linear infinite}h1{font-size:18px;margin:0 0 8px}p{font-size:13px;color:#aaa39c;margin:0}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><main class="state"><div class="mark" aria-hidden="true"></div><h1>${heading}</h1><p>${detail}</p></main></body></html>`;
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
