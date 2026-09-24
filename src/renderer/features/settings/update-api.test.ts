// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
function browser() {
  const target = Object.assign(new EventTarget(), { location: { reload: vi.fn() }, opentigDesktop: undefined });
  vi.stubGlobal('window', target);
  return target;
}
const status = (version: string) => ({ currentVersion: version, phase: 'idle', availableVersion: null });
it('uses authenticated same-origin requests for the server update actions', async () => {
  browser();
  const fetcher = vi.fn(async () => Response.json(status('0.1.2'))); vi.stubGlobal('fetch', fetcher);
  const { updatesApi } = await import('./update-api');
  await updatesApi().download();
  expect(fetcher).toHaveBeenCalledWith('/api/updates/download', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store' }));
});
it('does not request installation while edits or operations prevent restart', async () => {
  const target = browser(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  target.addEventListener('opentig:before-update', (event) => event.preventDefault());
  const { updatesApi } = await import('./update-api');
  await expect(updatesApi().install()).rejects.toThrow('Save your edited files');
  expect(fetcher).not.toHaveBeenCalled();
});
it('waits to reload a changed server version until local edits can be preserved', async () => {
  const target = browser();
  let version = '0.1.2'; vi.stubGlobal('fetch', async () => Response.json(status(version)));
  const { updatesApi } = await import('./update-api');
  await updatesApi().getStatus();
  const prevent = (event: Event) => event.preventDefault(); target.addEventListener('opentig:before-update', prevent);
  version = '0.1.3';
  expect((await updatesApi().getStatus()).reloadRequired).toBe(true);
  expect(target.location.reload).not.toHaveBeenCalled();
  target.removeEventListener('opentig:before-update', prevent);
  await updatesApi().getStatus(); expect(target.location.reload).toHaveBeenCalledTimes(1);
});
