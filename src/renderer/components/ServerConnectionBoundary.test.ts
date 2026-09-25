// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sileo, Toaster } from 'sileo';
import type { ServerConnectionState } from '@/lib/websocket-transport';
import { ServerConnectionBoundary } from './ServerConnectionBoundary';

const transport = vi.hoisted(() => ({ state: 'connecting' as ServerConnectionState, listeners: new Set<() => void>() }));
vi.mock('@/lib/opentig-api', () => ({ serverClient: { transport: {
  getState: () => transport.state,
  subscribeState: (listener: () => void) => { transport.listeners.add(listener); return () => transport.listeners.delete(listener); },
} } }));
vi.mock('@/features/auth/session-renewal', () => ({ maintainBrowserSession: () => () => undefined }));

let root: Root;
let container: HTMLDivElement;
const notices = () => [...container.querySelectorAll<HTMLElement>('[data-sileo-toast]:not([data-exiting="true"])')];
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(700); });
async function state(value: ServerConnectionState) {
  await act(async () => { transport.state = value; for (const listener of transport.listeners) listener(); });
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  transport.state = 'connecting';
  sileo.clear();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Fragment, null,
    createElement(Toaster, { theme: 'light', position: 'bottom-right' }),
    createElement(ServerConnectionBoundary, null, createElement('div', { id: 'workspace' }, 'Workspace')),
  )));
});
afterEach(async () => {
  await act(async () => root.unmount());
  sileo.clear(); transport.listeners.clear(); container.remove();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps one persistent outage notification and preserves unrelated notifications on recovery', async () => {
  await state('offline');
  expect(notices()).toHaveLength(0);
  expect(container.querySelector('.splash')?.textContent).toContain('OpenTig server is offline');
  await state('connected');
  await state('reconnecting'); await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.textContent).toContain('Reconnecting');
  await state('offline'); await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.textContent).toContain('OpenTig server is offline');
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(notices()).toHaveLength(1);
  await state('incompatible-version'); await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.textContent).toContain('versions are incompatible');
  await act(async () => { sileo.info({ title: 'Unrelated notification', duration: null }); });
  await settle();
  expect(notices()).toHaveLength(2);
  await state('connected'); await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.textContent).toContain('Unrelated notification');
});

it('does not let an earlier exit animation dismiss a new outage', async () => {
  await state('connected');
  await state('reconnecting'); await settle();
  await state('connected');
  await state('offline'); await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.textContent).toContain('OpenTig server is offline');
});

it('clears the outage notification when authentication replaces the workspace', async () => {
  await state('connected');
  await state('reconnecting'); await settle();
  await state('auth-required'); await settle();
  expect(notices()).toHaveLength(0);
  expect(container.querySelector('#workspace')).toBeNull();
  expect(container.querySelector('a[href="/pair"]')?.textContent).toBe('Pair this browser');
});
