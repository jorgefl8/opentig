// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenTigPairingLink, OpenTigWebAccessStatus } from '@shared/desktop-api';
import type { OpenTigBrowserWebAccessStatus } from '@shared/web-access';
import { WebAccessSettings } from './WebAccessSettings';

vi.mock('./owner-sessions', () => ({ loadOwnerSessions: async () => [], renameOwnerSession: vi.fn(), revokeAllBrowserSessions: vi.fn(), revokeOwnerSession: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete window.opentigDesktop; });

const status: OpenTigWebAccessStatus = {
  webAccessEnabled: true, lanAccessEnabled: false, listeningOnLan: false,
  publicOrigin: 'https://git.example.com', serverState: 'ready', actualPort: 6767,
  localEndpoint: 'http://127.0.0.1:6767', networkEndpoints: [],
  pairingEndpoints: ['http://127.0.0.1:6767', 'https://git.example.com'], connectedSessionCount: 1, restartError: null,
};
const link = { url: 'https://git.example.com/pair#token=one-use-code', expiresAt: new Date(Date.now() + 300_000).toISOString() };

async function mount(value: OpenTigWebAccessStatus, createPairingLink: (endpoint: string) => Promise<OpenTigPairingLink>, save?: (origin: string) => Promise<OpenTigWebAccessStatus>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const setPublicOrigin = vi.fn(save ?? (async (origin: string) => {
    value.publicOrigin = origin || null;
    value.pairingEndpoints = [value.localEndpoint!, ...(value.listeningOnLan ? value.networkEndpoints : []), ...(origin ? [origin] : [])];
    return { ...value };
  }));
  const setEnabled = vi.fn(async (enabled: boolean) => { value.webAccessEnabled = enabled; return { ...value }; });
  Object.defineProperty(window, 'opentigDesktop', { configurable: true, value: { webAccess: { getStatus: async () => ({ ...value }), createPairingLink, setPublicOrigin, setEnabled } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(WebAccessSettings)));
  return { container, setPublicOrigin, setEnabled, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

async function mountBrowser(value: OpenTigBrowserWebAccessStatus, create: () => Promise<OpenTigPairingLink>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  delete window.opentigDesktop;
  const fetch = vi.fn(async (url: string) => ({
    ok: true, json: async () => url === '/api/auth/web-access' ? { ...value } : await create(),
  }));
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(WebAccessSettings)));
  return { container, fetch, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}
async function choose(container: HTMLElement, destination: string) {
  await act(async () => (container.querySelector(`input[value="${destination}"]`) as HTMLInputElement).click());
}
async function typeDomain(container: HTMLElement, value: string) {
  const input = container.querySelector('#web-access-public-origin') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function button(container: HTMLElement, text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

describe('Web access settings display', () => {
  it.each([false, true])('pairs browsers while showing LAN access=%s as server-managed information', async (listeningOnLan) => {
    const browserStatus = { webAccessEnabled: true, pairingAvailable: true, listeningOnLan, listenerHost: listeningOnLan ? '0.0.0.0' : '127.0.0.1', actualPort: 6767, ready: true };
    const browserLink = { ...link, url: `${window.location.origin}/pair#token=one-use-code` };
    const view = await mountBrowser(browserStatus, async () => browserLink);
    try {
      expect(view.container.textContent).toContain('Web access');
      expect(view.container.textContent).toContain('LAN access');
      expect(view.container.textContent).toContain('LAN access is configured on the server');
      expect(view.container.querySelector('[role="switch"]')).toBeNull();
      expect(view.container.querySelector('.web-access-destinations')).toBeNull();
      expect(view.container.querySelector('.web-access-link-destination')?.textContent).toContain(window.location.origin);
      expect(view.container.querySelector('.web-access-server-network .web-access-hint')?.textContent).toContain(listeningOnLan ? 'Direct LAN connections are allowed' : 'Direct LAN access is off');
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(view.fetch).toHaveBeenCalledWith('/api/auth/pairing-link', { method: 'POST', credentials: 'include' });
      expect(view.container.querySelector('.web-access-link')?.textContent).toBe(browserLink.url);
      expect(view.container.querySelector('.web-access-pairing img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    } finally { await view.unmount(); }
  });

  it('dismisses pending browser links, ignores late responses, and hides expired codes', async () => {
    vi.useFakeTimers();
    let release!: (value: OpenTigPairingLink) => void;
    const create = vi.fn().mockImplementationOnce(() => new Promise<OpenTigPairingLink>((resolve) => { release = resolve; }))
      .mockImplementation(async () => ({ ...link, expiresAt: new Date(Date.now() + 1_000).toISOString() }));
    const view = await mountBrowser({ webAccessEnabled: true, pairingAvailable: true, listeningOnLan: false, listenerHost: '127.0.0.1', actualPort: 6767, ready: true }, create);
    try {
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(button(view.container, 'Create pairing link').disabled).toBe(true);
      await act(async () => (view.container.querySelector('[aria-label="Close pairing link"]') as HTMLButtonElement).click());
      await act(async () => release(link));
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(view.container.querySelector('.web-access-pairing img')).not.toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(1_001));
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
    } finally { await view.unmount(); }
  });

  it('keeps browser pairing unavailable while the server is not ready', async () => {
    const view = await mountBrowser({ webAccessEnabled: true, pairingAvailable: true, listeningOnLan: false, listenerHost: '127.0.0.1', actualPort: 6767, ready: false }, vi.fn());
    try {
      expect(button(view.container, 'Create pairing link').disabled).toBe(true);
      expect(view.fetch).not.toHaveBeenCalledWith('/api/auth/pairing-link', expect.anything());
    } finally { await view.unmount(); }
  });

  it('hides the browser QR after its one-use code has been consumed', async () => {
    vi.useFakeTimers();
    const value = { webAccessEnabled: true, pairingAvailable: true, listeningOnLan: false, listenerHost: '127.0.0.1', actualPort: 6767, ready: true };
    const view = await mountBrowser(value, async () => link);
    try {
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(view.container.querySelector('.web-access-pairing img')).not.toBeNull();
      value.pairingAvailable = false;
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      expect(button(view.container, 'Create pairing link').disabled).toBe(false);
    } finally { await view.unmount(); }
  });

  it('keeps a newly created browser link visible when an older status response arrives late', async () => {
    vi.useFakeTimers();
    const value = { webAccessEnabled: true, pairingAvailable: false, listeningOnLan: false, listenerHost: '127.0.0.1', actualPort: 6767, ready: true };
    const view = await mountBrowser(value, async () => link);
    let release!: (value: OpenTigBrowserWebAccessStatus) => void;
    try {
      view.fetch.mockImplementationOnce(async () => ({ ok: true, json: () => new Promise<OpenTigBrowserWebAccessStatus>((resolve) => { release = resolve; }) }));
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      await act(async () => button(view.container, 'Create pairing link').click());
      await act(async () => release(value));
      expect(view.container.querySelector('.web-access-pairing img')).not.toBeNull();
    } finally { await view.unmount(); }
  });

  it('confirms disabling with a red action, keeps access on cancel, and explains saved pairings', async () => {
    const view = await mount({ ...status }, vi.fn(async () => link));
    try {
      await act(async () => button(view.container, 'Create pairing link').click());
      const toggle = view.container.querySelector('[aria-label="Web access"]') as HTMLButtonElement;
      await act(async () => toggle.click());
      let dialog = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.textContent).toContain('Paired devices stay saved');
      expect(view.setEnabled).not.toHaveBeenCalled();
      await act(async () => button(dialog, 'Cancel').click());
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(view.container.querySelector('.web-access-pairing')).not.toBeNull();
      await act(async () => toggle.click());
      dialog = document.querySelector('[role="dialog"]') as HTMLElement;
      await act(async () => button(dialog, 'Disable Web access').click());
      expect(view.setEnabled).toHaveBeenCalledExactlyOnceWith(false);
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      await act(async () => toggle.click());
      dialog = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.textContent).toContain('Saved paired devices can reconnect');
      await act(async () => button(dialog, 'Enable Web access').click());
      expect(view.setEnabled).toHaveBeenLastCalledWith(true);
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    } finally { await view.unmount(); }
  });

  it('closes a pending request immediately and ignores its late result, then creates a public URL and QR', async () => {
    let release!: (value: OpenTigPairingLink) => void;
    const create = vi.fn().mockImplementationOnce(() => new Promise<OpenTigPairingLink>((resolve) => { release = resolve; })).mockResolvedValue(link);
    const view = await mount(status, create);
    try {
      await choose(view.container, 'public');
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(view.container.querySelector('.web-access-pairing')).not.toBeNull();
      expect(button(view.container, 'Create pairing link').disabled).toBe(true);
      await act(async () => (view.container.querySelector('[aria-label="Close pairing link"]') as HTMLButtonElement).click());
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      await act(async () => release(link));
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(create).toHaveBeenLastCalledWith('https://git.example.com');
      expect(view.container.querySelector('.web-access-link')?.textContent).toBe(link.url);
      expect(view.container.querySelector('.web-access-pairing img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
      await act(async () => (view.container.querySelector('[aria-label="Close pairing link"]') as HTMLButtonElement).click());
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
    } finally { await view.unmount(); }
  });

  it('hides pairing while browser access is OFF and groups network controls with endpoints', async () => {
    const create = vi.fn();
    const view = await mount({ ...status, webAccessEnabled: false, listeningOnLan: true }, create);
    try {
      expect(view.container.querySelector('.web-access-actions')).toBeNull();
      expect(view.container.querySelector('#web-access-endpoint')).toBeNull();
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      expect((view.container.querySelector('[aria-label="LAN access"]') as HTMLButtonElement).disabled).toBe(true);
      expect(view.container.querySelector('.web-access-facts [aria-label="LAN access"]')).not.toBeNull();
      expect(view.container.querySelector('.web-access-pairing-options')).toBeNull();
      expect(view.container.querySelector('#web-access-public-origin')).toBeNull();
      expect(view.container.textContent).toContain('including through tunnels');
      expect(view.container.textContent).toContain('All network interfaces');
      expect(view.container.textContent).toContain('Paired devices are saved');
      expect(create).not.toHaveBeenCalled();
    } finally { await view.unmount(); }
  });

  it('saves a domain and uses it immediately for the next link and QR', async () => {
    const create = vi.fn(async (origin: string) => ({ ...link, url: `${origin}/pair#token=one-use-code` }));
    const view = await mount({ ...status, publicOrigin: null, pairingEndpoints: [status.localEndpoint!] }, create);
    try {
      await choose(view.container, 'public');
      expect(document.activeElement?.id).toBe('web-access-public-origin');
      expect(button(view.container, 'Create pairing link').disabled).toBe(true);
      await typeDomain(view.container, 'git.example.com/');
      await act(async () => button(view.container, 'Save and use').click());
      expect(view.setPublicOrigin).toHaveBeenCalledWith('https://git.example.com');
      expect(view.container.querySelector('#web-access-public-origin')).toBeNull();
      expect(view.container.querySelector('.web-access-saved-domain')?.textContent).toContain('https://git.example.com');
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(create).toHaveBeenLastCalledWith('https://git.example.com');
      expect(view.container.querySelector('.web-access-link')?.textContent).toBe(link.url);
      expect(view.container.querySelector('.web-access-pairing img')).not.toBeNull();
    } finally { await view.unmount(); }
  });

  it('cancels domain edits without changing the saved target, then removes it and returns to local', async () => {
    const create = vi.fn(async () => link);
    const view = await mount({ ...status }, create);
    try {
      await choose(view.container, 'public');
      await act(async () => button(view.container, 'Create pairing link').click());
      await act(async () => button(view.container, 'Edit').click());
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      expect(button(view.container, 'Create pairing link').disabled).toBe(true);
      await typeDomain(view.container, 'https://other.example.com');
      await act(async () => button(view.container, 'Cancel').click());
      expect(view.setPublicOrigin).not.toHaveBeenCalled();
      expect(view.container.querySelector('.web-access-link-destination')?.textContent).toContain(status.publicOrigin);
      expect(button(view.container, 'Create pairing link').disabled).toBe(false);
      await act(async () => button(view.container, 'Edit').click());
      await act(async () => button(view.container, 'Remove').click());
      expect(view.setPublicOrigin).toHaveBeenCalledWith('');
      expect((view.container.querySelector('input[value="local"]') as HTMLInputElement).checked).toBe(true);
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(create).toHaveBeenLastCalledWith(status.localEndpoint);
    } finally { await view.unmount(); }
  });

  it('cancels a new domain back to local and discards the draft when switching destinations', async () => {
    const view = await mount({ ...status, publicOrigin: null, pairingEndpoints: [status.localEndpoint!] }, vi.fn());
    try {
      await choose(view.container, 'public');
      await typeDomain(view.container, 'https://draft.example.com');
      await act(async () => button(view.container, 'Cancel').click());
      expect((view.container.querySelector('input[value="local"]') as HTMLInputElement).checked).toBe(true);
      await choose(view.container, 'public');
      expect((view.container.querySelector('#web-access-public-origin') as HTMLInputElement).value).toBe('');
      await typeDomain(view.container, 'https://draft.example.com');
      await choose(view.container, 'local');
      await choose(view.container, 'public');
      expect((view.container.querySelector('#web-access-public-origin') as HTMLInputElement).value).toBe('');
      expect(view.setPublicOrigin).not.toHaveBeenCalled();
    } finally { await view.unmount(); }
  });

  it('rejects paths and credentials and keeps failed saves editable without enabling pairing', async () => {
    const save = vi.fn(async () => { throw new Error('Could not persist address'); });
    const view = await mount({ ...status }, vi.fn(), save);
    try {
      await choose(view.container, 'public');
      await act(async () => button(view.container, 'Edit').click());
      for (const invalid of ['https://git.example.com/path', 'https://user:pass@git.example.com', 'ftp://git.example.com']) {
        await typeDomain(view.container, invalid);
        await act(async () => button(view.container, 'Save and use').click());
        expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
        expect(save).not.toHaveBeenCalled();
        expect(button(view.container, 'Create pairing link').disabled).toBe(true);
      }
      await typeDomain(view.container, 'https://other.example.com');
      await act(async () => button(view.container, 'Save and use').click());
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('Could not persist address');
      expect((view.container.querySelector('#web-access-public-origin') as HTMLInputElement).value).toBe('https://other.example.com');
      expect(button(view.container, 'Create pairing link').disabled).toBe(true);
    } finally { await view.unmount(); }
  });

  it('uses LAN endpoints and returns to local when LAN access is no longer available', async () => {
    vi.useFakeTimers();
    const lan = 'http://192.0.2.10:6767';
    const currentStatus = { ...status, listeningOnLan: true, networkEndpoints: [lan], pairingEndpoints: [...status.pairingEndpoints, lan] };
    const create = vi.fn(async () => link);
    const view = await mount(currentStatus, create);
    try {
      await choose(view.container, 'lan');
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(create).toHaveBeenLastCalledWith(lan);
      currentStatus.listeningOnLan = false;
      currentStatus.pairingEndpoints = status.pairingEndpoints;
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      expect(view.container.querySelector('input[value="lan"]')).toBeNull();
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      expect((view.container.querySelector('input[value="local"]') as HTMLInputElement).checked).toBe(true);
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(create).toHaveBeenLastCalledWith(status.localEndpoint);
    } finally { await view.unmount(); }
  });

  it('hides an existing pairing link when Web access turns off and restores controls when enabled', async () => {
    vi.useFakeTimers();
    const currentStatus = { ...status };
    const view = await mount(currentStatus, vi.fn(async () => link));
    try {
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(view.container.querySelector('.web-access-pairing img')).not.toBeNull();
      currentStatus.webAccessEnabled = false;
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      expect(view.container.querySelector('.web-access-actions')).toBeNull();
      expect(view.container.querySelector('#web-access-endpoint')).toBeNull();
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
      currentStatus.webAccessEnabled = true;
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      expect(button(view.container, 'Create pairing link').disabled).toBe(false);
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
    } finally { await view.unmount(); }
  });

  it('removes the displayed QR and code when the link expires', async () => {
    vi.useFakeTimers();
    const create = vi.fn(async () => ({ ...link, expiresAt: new Date(Date.now() + 1_000).toISOString() }));
    const view = await mount(status, create);
    try {
      await act(async () => button(view.container, 'Create pairing link').click());
      expect(view.container.querySelector('.web-access-pairing img')).not.toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(1_001));
      expect(view.container.querySelector('.web-access-pairing')).toBeNull();
    } finally { await view.unmount(); }
  });
});
