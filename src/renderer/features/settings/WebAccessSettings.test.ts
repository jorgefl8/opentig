// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenTigPairingLink, OpenTigWebAccessStatus } from '@shared/desktop-api';
import { WebAccessSettings } from './WebAccessSettings';

vi.mock('./owner-sessions', () => ({ loadOwnerSessions: async () => [], renameOwnerSession: vi.fn(), revokeAllBrowserSessions: vi.fn(), revokeOwnerSession: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete window.opentigDesktop; });

const status: OpenTigWebAccessStatus = {
  webAccessEnabled: true, lanAccessEnabled: false, listeningOnLan: false,
  publicOrigin: 'https://git.example.com', serverState: 'ready', actualPort: 6767,
  localEndpoint: 'http://127.0.0.1:6767', networkEndpoints: [],
  pairingEndpoints: ['https://git.example.com'], connectedSessionCount: 1, restartError: null,
};
const link = { url: 'https://git.example.com/pair#token=one-use-code', expiresAt: new Date(Date.now() + 300_000).toISOString() };

async function mount(value: OpenTigWebAccessStatus, createPairingLink: (endpoint: string) => Promise<OpenTigPairingLink>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'opentigDesktop', { configurable: true, value: { webAccess: { getStatus: async () => ({ ...value }), createPairingLink } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(WebAccessSettings)));
  return { container, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}
function button(container: HTMLElement, text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

describe('Web access settings display', () => {
  it('closes a pending request immediately and ignores its late result, then creates a public URL and QR', async () => {
    let release!: (value: OpenTigPairingLink) => void;
    const create = vi.fn().mockImplementationOnce(() => new Promise<OpenTigPairingLink>((resolve) => { release = resolve; })).mockResolvedValue(link);
    const view = await mount(status, create);
    try {
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
      expect(view.container.querySelector('.web-access-facts #web-access-public-origin')).not.toBeNull();
      expect(view.container.textContent).toContain('including through tunnels');
      expect(view.container.textContent).toContain('All network interfaces');
      expect(create).not.toHaveBeenCalled();
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
