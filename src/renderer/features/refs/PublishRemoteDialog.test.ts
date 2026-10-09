// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublicationContext } from '@shared/repository-access';
import { PublishRemoteDialog } from './PublishRemoteDialog';
import type { RemoteChoice } from './useBranchPush';

const refs = vi.hoisted(() => ({ pushContext: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { refs } }));
vi.mock('motion/react', async original => ({ ...await original<typeof import('motion/react')>(), useReducedMotion: () => true }));
const context: PublicationContext = { id: 'review', repositoryId: 'repo', branch: 'main', oid: 'a'.repeat(40), targetRef: 'refs/heads/main', remote: 'origin', remotes: ['origin'], urls: ['https://github.com/org/demo.git'], mode: 'external', login: null, hasUpstream: true };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function mount(value: PublicationContext) {
  refs.pushContext.mockResolvedValue(value);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const select = vi.fn();
  const choice: RemoteChoice = { id: 'choice', repositoryId: 'repo', label: 'Demo', hasUpstream: value.hasUpstream ?? false,
    result: { status: 'remote-required', branch: 'main', oid: value.oid!, remotes: ['origin'] }, resolve: vi.fn() };
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(PublishRemoteDialog, { choice, onSelect: select }))); await settle(); });
  await act(settle);
  return { select, close: async () => { await act(async () => root.unmount()); client.clear(); node.remove(); } };
}

it('reviews an ordinary push without describing the branch as unpublished and identifies external credentials', async () => {
  const view = await mount(context);
  try {
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Confirm push');
    expect(document.querySelector('[role=dialog]')?.textContent).not.toContain('sets an upstream');
    expect(document.body.textContent).toContain('Git credentials · account unverified');
    expect(document.body.textContent).toContain('credentials on the server');
    expect(document.body.textContent).toContain('remembered on this client');
    const push = [...document.querySelectorAll('button')].find(node => node.textContent === 'Push commits');
    expect(push).toHaveProperty('disabled', false);
    await act(async () => push!.click());
    expect(view.select).toHaveBeenCalledWith(context);
  } finally { await view.close(); }
});

it('publishes a new branch with its managed account and explains upstream creation', async () => {
  const value = { ...context, mode: 'managed' as const, login: 'alice', hasUpstream: false };
  const view = await mount(value);
  try {
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Publish branch');
    expect(document.body.textContent).toContain('sets an upstream');
    expect(document.querySelector('.repository-access-status')?.textContent).toContain('@alice');
    expect(document.body.textContent).not.toContain('account unverified');
    const publish = [...document.querySelectorAll('button')].find(node => node.textContent === 'Publish branch');
    await act(async () => publish!.click());
    expect(view.select).toHaveBeenCalledWith(value);
  } finally { await view.close(); }
});

it('keeps blocked contexts unconfirmable', async () => {
  const view = await mount({ ...context, blocked: 'The destination changed.' });
  try {
    expect(document.querySelector('[role=alert]')?.textContent).toBe('The destination changed.');
    expect([...document.querySelectorAll('button')].find(node => node.textContent === 'Push commits')).toHaveProperty('disabled', true);
    expect(view.select).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
