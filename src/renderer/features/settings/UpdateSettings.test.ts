// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdateStatus } from '@shared/desktop-updates';
import { UpdateSettings } from './UpdateSettings';

const identity = vi.hoisted(() => ({ isDevProfile: false, appDisplayName: 'OpenTig' }));
const getStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app-identity', () => identity);
vi.mock('./update-api', () => ({ updatesApi: () => ({ getStatus }) }));

afterEach(() => { vi.unstubAllGlobals(); delete window.opentigDesktop; });

const status: DesktopUpdateStatus = {
  phase: 'unavailable', currentVersion: '0.2.0', availableVersion: null, progress: null,
  checkedAt: null, message: 'Dev builds are updated by downloading a new Dev ZIP.', releaseUrl: null, releaseNotes: null,
};

async function mount(dev: boolean, desktop: boolean) {
  identity.isDevProfile = dev;
  identity.appDisplayName = dev ? 'OpenTig Dev' : 'OpenTig';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  if (desktop) Object.defineProperty(window, 'opentigDesktop', { configurable: true, value: {} });
  getStatus.mockResolvedValue({ ...status, message: dev ? status.message : 'Automatic updates are unavailable for this installation.' });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(UpdateSettings)));
  return { container, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

describe('Update settings build identity', () => {
  it('labels desktop Dev with its base version and explains source and ZIP updates without a stable release link', async () => {
    const view = await mount(true, true);
    try {
      expect(view.container.querySelector('strong')?.textContent).toBe('OpenTig Dev · Base version 0.2.0');
      expect(view.container.textContent).toContain('Automatic updates to stable releases are disabled');
      expect(view.container.textContent).toContain('rebuild and relaunch OpenTig Dev');
      expect(view.container.textContent).toContain('new Dev ZIP');
      expect(view.container.querySelector('a')).toBeNull();
    } finally { await view.unmount(); }
  });

  it('explains server rebuilds for browser Dev instead of downloading a desktop ZIP', async () => {
    const view = await mount(true, false);
    try {
      expect(view.container.textContent).toContain('Rebuild and restart the Dev server');
      expect(view.container.textContent).not.toContain('ZIP');
      expect(view.container.querySelector('a')).toBeNull();
    } finally { await view.unmount(); }
  });

  it('retains the installed stable version and release notes for production with the same package version', async () => {
    const view = await mount(false, true);
    try {
      expect(view.container.querySelector('strong')?.textContent).toBe('OpenTig 0.2.0');
      const link = view.container.querySelector('a');
      expect(link?.href).toBe('https://github.com/jorgefl8/opentig/releases/tag/v0.2.0');
      expect(link?.textContent).toBe('Release notes · 0.2.0 (installed)');
      expect(view.container.textContent).toContain('Automatic updates are unavailable for this installation.');
    } finally { await view.unmount(); }
  });
});
