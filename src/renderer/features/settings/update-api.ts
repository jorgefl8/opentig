import type { DesktopUpdatesApi, DesktopUpdateStatus } from '../../../shared/desktop-updates';

let loadedVersion: string | null = null;
let needsReload = false;
let reloading = false;
export function canRestartForUpdate(): boolean {
  return window.dispatchEvent(new Event('opentig:before-update', { cancelable: true }));
}
async function request(action?: 'check' | 'download' | 'install'): Promise<DesktopUpdateStatus> {
  if (action === 'install') {
    if (!canRestartForUpdate()) throw new Error('Save your edited files and finish running operations before restarting.');
    if (needsReload) { window.location.reload(); throw new Error('Reloading the updated app…'); }
  }
  const response = await fetch(action ? `/api/updates/${action}` : '/api/updates', {
    method: action ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Could not reach the update service.');
  const status = value as DesktopUpdateStatus;
  loadedVersion ??= status.currentVersion;
  if (status.currentVersion !== loadedVersion) {
    needsReload = true;
    if (!reloading && canRestartForUpdate()) { reloading = true; window.location.reload(); }
    return { ...status, phase: 'ready', reloadRequired: true, availableVersion: status.currentVersion,
      message: 'The server has updated. Save any edited files, then reload this browser.' };
  }
  return status;
}
const browserUpdates: DesktopUpdatesApi = {
  getStatus: () => request(), check: () => request('check'), download: () => request('download'), install: () => request('install'),
};
export const updatesApi = (): DesktopUpdatesApi => window.opentigDesktop?.updates ?? browserUpdates;
