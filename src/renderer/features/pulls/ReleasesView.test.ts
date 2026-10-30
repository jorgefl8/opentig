// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReleaseSummary } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReleasesView } from './ReleasesView';

const api = vi.hoisted(() => ({ listReleases: vi.fn(), createRelease: vi.fn(), repositoryAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('sileo', () => ({ sileo: toast }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogPopup: ({ children }: { children: ReactNode }) => createElement('div', { role: 'dialog' }, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
}));

const release = (overrides: Partial<ReleaseSummary>): ReleaseSummary => ({ tagName: 'v1', name: 'One', isDraft: false, isPrerelease: false, isLatest: false, isImmutable: false, createdAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-01T00:00:00Z', ...overrides });
const onSelect = vi.fn();
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 3 });
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 }, mutations: { networkMode: 'always', retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 6; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(ReleasesView, { repositoryId: 'repo', activeTag: 'v2', onSelect })))));
  await settle();
}
async function type(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);

it('labels each state, marks the active one and selects on click', async () => {
  api.listReleases.mockResolvedValue([release({ tagName: 'v3', name: 'Three', isDraft: true, publishedAt: null }), release({ tagName: 'v2', name: 'Two', isLatest: true }), release({ tagName: 'v2-rc', name: 'RC', isPrerelease: true }), release({ tagName: 'v1', name: 'One' })]);
  await render();
  const items = [...container.querySelectorAll('.release-item')];
  expect(items.map(item => item.querySelector('[data-slot="badge"]')?.textContent)).toEqual(['Draft', 'Latest', 'Pre-release', 'Published']);
  expect(items[1]?.classList.contains('active')).toBe(true);
  await act(async () => (items[2] as HTMLButtonElement).click());
  expect(onSelect).toHaveBeenCalledWith('v2-rc');
});

it('says when there are none', async () => {
  api.listReleases.mockResolvedValue([]);
  await render();
  expect(container.textContent).toContain('No releases yet.');
});

it('offers a retry when it cannot load', async () => {
  api.listReleases.mockRejectedValue(new Error('Rate limited'));
  await render();
  expect(container.textContent).toContain('Rate limited');
  expect(button('Retry')).toBeDefined();
});

it('creates a draft for a tag and opens it', async () => {
  api.listReleases.mockResolvedValue([]);
  api.createRelease.mockResolvedValue(undefined);
  await render();
  await act(async () => button('New')!.click());
  await settle();
  expect(button('Create draft')?.disabled).toBe(true);
  await type('#release-tag', ' v2.0.0 ');
  await type('#release-title', ' Two ');
  await act(async () => button('Create draft')!.click());
  await settle();
  expect(api.createRelease).toHaveBeenCalledWith({ repositoryId: 'repo', tagName: 'v2.0.0', title: 'Two', notes: '', generateNotes: false, prerelease: false, expectedAccount: { login: 'sample', revision: 3 } });
  expect(onSelect).toHaveBeenCalledWith('v2.0.0');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps the dialog and its text when GitHub refuses', async () => {
  api.listReleases.mockResolvedValue([]);
  api.createRelease.mockRejectedValue(Object.assign(new Error('no'), { detail: { code: 'GH_PR_ACTION_NOT_ALLOWED', operation: 'gh-release-create', message: "The tag v2.0.0 doesn't exist on GitHub." } }));
  await render();
  await act(async () => button('New')!.click());
  await settle();
  await type('#release-tag', 'v2.0.0');
  await type('#release-title', 'Two');
  await act(async () => button('Create draft')!.click());
  await settle();
  expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("doesn't exist") }));
  expect(container.querySelector<HTMLInputElement>('#release-tag')?.value).toBe('v2.0.0');
  expect(onSelect).not.toHaveBeenCalled();
});
