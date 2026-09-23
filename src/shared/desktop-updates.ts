export const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

export type DesktopUpdatePhase = 'unavailable' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

export interface DesktopUpdateStatus {
  phase: DesktopUpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  checkedAt: string | null;
  message: string | null;
  releaseUrl: string | null;
}

export interface DesktopUpdatesApi {
  getStatus(): Promise<DesktopUpdateStatus>;
  check(): Promise<DesktopUpdateStatus>;
  download(): Promise<DesktopUpdateStatus>;
  install(): Promise<DesktopUpdateStatus>;
}
