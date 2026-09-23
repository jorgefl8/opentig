import type { AppUpdater } from 'electron-updater';
import { DESKTOP_UPDATE_CHECK_INTERVAL_MS, type DesktopUpdateStatus } from '../../shared/desktop-updates';

/** Owns update state independently of windows; nothing installs on ordinary application exit. */
export class DesktopUpdater {
  private status: DesktopUpdateStatus;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private lastAttemptAt: number | null = null;
  private stopped = false;
  private pendingInstall = false;

  constructor(
    private readonly updater: AppUpdater | null,
    version: string,
    private readonly repository: string | null,
    private readonly requestClose: () => void,
    unavailableReason = 'Updates are available in the installed Windows release of OpenTig.',
  ) {
    this.status = { phase: updater ? 'idle' : 'unavailable', currentVersion: version, availableVersion: null,
      progress: null, checkedAt: null, message: updater ? null : unavailableReason, releaseUrl: null };
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.logger = null;
    updater.on('error', () => this.fail());
    updater.on('download-progress', ({ percent }) => {
      if (this.status.phase === 'downloading' && Number.isFinite(percent)) this.status.progress = Math.max(0, Math.min(100, percent));
    });
    updater.on('update-downloaded', (info) => {
      if (this.status.phase === 'downloading' && info.version === this.status.availableVersion) {
        this.status = { ...this.status, phase: 'ready', progress: 100, message: null };
      }
    });
  }

  getStatus = (): DesktopUpdateStatus => ({ ...this.status });

  start(): void {
    if (!this.updater || this.started || this.stopped) return;
    this.started = true;
    this.scheduleCheck(10_000);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Focusing after sleep can precede the delayed timer; never poll on every focus. */
  checkIfDue(): void {
    if (this.started && this.lastAttemptAt !== null && Date.now() - this.lastAttemptAt >= DESKTOP_UPDATE_CHECK_INTERVAL_MS) {
      void this.check();
    }
  }

  private scheduleCheck(delay: number): void {
    clearTimeout(this.timer);
    if (!this.started || this.stopped) return;
    this.timer = setTimeout(() => { void this.check(); }, delay);
    this.timer.unref();
  }

  check = async (): Promise<DesktopUpdateStatus> => {
    if (!this.updater || this.stopped || !['idle', 'error'].includes(this.status.phase)) return this.getStatus();
    clearTimeout(this.timer);
    this.lastAttemptAt = Date.now();
    this.status = { ...this.status, phase: 'checking', availableVersion: null, progress: null, message: null, releaseUrl: null };
    try {
      const result = await this.updater.checkForUpdates();
      if (this.stopped) return this.getStatus();
      const version = result?.isUpdateAvailable ? result.updateInfo.version : null;
      if (version && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unexpected release version.');
      this.status = { ...this.status, phase: version ? 'available' : 'idle', availableVersion: version,
        checkedAt: new Date().toISOString(), message: null,
        releaseUrl: version && this.repository ? `https://github.com/${this.repository}/releases/tag/v${version}` : null };
    } catch { this.fail(); }
    finally { this.scheduleCheck(DESKTOP_UPDATE_CHECK_INTERVAL_MS); }
    return this.getStatus();
  };

  download = async (): Promise<DesktopUpdateStatus> => {
    if (!this.updater || this.stopped || this.status.phase !== 'available') return this.getStatus();
    this.status = { ...this.status, phase: 'downloading', progress: 0, message: null };
    try { await this.updater.downloadUpdate(); }
    catch { this.fail(); }
    return this.getStatus();
  };

  install = async (): Promise<DesktopUpdateStatus> => {
    if (!this.updater || this.stopped || this.status.phase !== 'ready') return this.getStatus();
    this.pendingInstall = true;
    this.status = { ...this.status, phase: 'installing', message: null };
    try { this.requestClose(); }
    catch { this.pendingInstall = false; this.fail(); }
    return this.getStatus();
  };

  cancelInstall(): void {
    if (!this.pendingInstall) return;
    this.pendingInstall = false;
    this.status = { ...this.status, phase: 'ready', message: 'Save or close your edited files before restarting to install.' };
  }

  get installRequested(): boolean { return this.pendingInstall; }

  /** Called only after the window accepted closing and the server/settings finished shutdown. */
  finishInstall(): boolean {
    if (!this.pendingInstall || !this.updater) return false;
    this.pendingInstall = false;
    try { this.updater.quitAndInstall(false, true); }
    catch { this.fail(); }
    return this.status.phase !== 'error';
  }

  private fail(): void {
    this.status = { ...this.status, phase: 'error', progress: null,
      message: 'The update could not be completed. Check your connection and try again. Your current installation has not been replaced.' };
  }
}
