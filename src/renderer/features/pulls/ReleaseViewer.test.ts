// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ReleaseDetails } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { ReleaseViewer } from './ReleaseViewer';

const api = vi.hoisted(() => ({ getRelease: vi.fn(), deleteDraftRelease: vi.fn(), publishRelease: vi.fn(), repositoryAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('sileo', () => ({ sileo: toast }));

const release = (overrides: Partial<ReleaseDetails> = {}): ReleaseDetails => ({
  tagName: 'v1.0.0', name: 'Version one', isDraft: true, isPrerelease: false, isLatest: false, isImmutable: false, createdAt: '2026-01-01T00:00:00Z', publishedAt: null,
  databaseId: 42, body: 'Some **notes**', bodyHash: 'a'.repeat(64), targetCommitish: 'b'.repeat(40), url: 'https://github.com/sample/demo/releases/tag/v1.0.0', assets: [{ name: 'app.exe', size: 2048 }], tagExists: true, viewerCanWrite: true, ...overrides,
});
const onClose = vi.fn();
// The notes load the Markdown pipeline on demand, which is slow the first time.
beforeAll(() => import('@/features/markdown/render-markdown'), 60_000);
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
  container.remove(); client.clear(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 200; tick++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2)); });
    if (client.isFetching() === 0 && client.isMutating() === 0 && tick > 4) return;
  }
}
async function render(value: ReleaseDetails = release()) {
  api.getRelease.mockResolvedValue(value);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(ReleaseViewer, { repositoryId: 'repo', tagName: 'v1.0.0', onClose })))));
  await settle();
}
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);

it('shows the release, rendered notes and assets', async () => {
  await render();
  expect(container.querySelector('h2')?.textContent).toBe('Version one');
  expect(container.querySelector('.release-notes strong')?.textContent).toBe('notes');
  expect(container.querySelector('.release-asset')?.textContent).toContain('app.exe');
  expect(container.querySelector('.release-asset small')?.textContent).toBe('2.0 KB');
});

it('removes what third-party notes could abuse', async () => {
  await render(release({ body: 'Fine<script>alert(1)</script><form action="https://example.invalid"><input></form>' }));
  const notes = container.querySelector('.release-notes')!;
  expect(notes.innerHTML).not.toContain('<script');
  expect(notes.innerHTML).not.toContain('<form');
});

it('asks before deleting a draft, says the tag stays, and closes when done', async () => {
  api.deleteDraftRelease.mockResolvedValue(undefined);
  await render();
  await act(async () => button('Delete draft')!.click());
  expect(api.deleteDraftRelease).not.toHaveBeenCalled();
  expect(container.querySelector('.pr-action-panel')?.textContent).toContain("The tag isn't touched");
  expect(container.querySelector('.pr-action-panel')?.textContent).toContain('as @sample');
  await act(async () => container.querySelector<HTMLButtonElement>('.pr-action-panel .local-refs-confirm-actions button')!.click());
  await settle();
  expect(api.deleteDraftRelease).toHaveBeenCalledWith({ repositoryId: 'repo', tagName: 'v1.0.0', expectedDatabaseId: 42, expectedAccount: { login: 'sample', revision: 3 } });
  expect(onClose).toHaveBeenCalledOnce();
});

it('cancels with Escape', async () => {
  await render();
  await act(async () => button('Delete draft')!.click());
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('.pr-action-panel')).toBeNull();
});

it('offers no deletion for a published release', async () => {
  await render(release({ isDraft: false, publishedAt: '2026-01-02T00:00:00Z', isLatest: true }));
  expect(button('Delete draft')).toBeUndefined();
  expect(button('Edit')).toBeDefined();
  expect(container.textContent).toContain('Latest');
});

it('offers nothing to change without write access', async () => {
  await render(release({ viewerCanWrite: false }));
  expect(button('Edit')).toBeUndefined();
  expect(button('Delete draft')).toBeUndefined();
  expect(container.textContent).toContain('requires write access');
  expect(api.repositoryAccount).not.toHaveBeenCalled();
});

it('says when the tag does not exist', async () => {
  await render(release({ tagExists: false }));
  expect(container.textContent).toContain("This tag doesn't exist yet");
});

it('says the deletion may have worked when there is no answer', async () => {
  api.deleteDraftRelease.mockRejectedValue(new ServerRequestTimeoutError('Server request timed out'));
  await render();
  await act(async () => button('Delete draft')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('.pr-action-panel .local-refs-confirm-actions button')!.click());
  await settle();
  expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have completed') }));
  expect(toast.error).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('offers a retry when it cannot load', async () => {
  api.getRelease.mockRejectedValue(new Error('Not found'));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(ReleaseViewer, { repositoryId: 'repo', tagName: 'v1.0.0', onClose })))));
  await settle();
  expect(container.textContent).toContain('Not found');
  expect(button('Try again')).toBeDefined();
});

it('asks before publishing, listing what will go out', async () => {
  api.publishRelease.mockResolvedValue(undefined);
  await render();
  await act(async () => button('Publish')!.click());
  expect(api.publishRelease).not.toHaveBeenCalled();
  const panel = container.querySelector('.pr-action-panel')!.textContent;
  expect(panel).toContain('v1.0.0');
  expect(panel).toContain('bbbbbbbbbbbb');
  expect(panel).toContain('app.exe');
  expect(panel).toContain('as @sample');
  expect(panel).toContain('any workflow that runs on publication starts');
  await act(async () => button('Publish release')!.click());
  await settle();
  expect(api.publishRelease).toHaveBeenCalledWith({ repositoryId: 'repo', tagName: 'v1.0.0', expectedDatabaseId: 42, expectedAccount: { login: 'sample', revision: 3 } });
  expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Release published' }));
});

it('warns when a draft has no assets', async () => {
  await render(release({ assets: [] }));
  await act(async () => button('Publish')!.click());
  expect(container.querySelector('.pr-action-panel')?.textContent).toContain('Check that nothing is missing');
});

it('keeps Publish off without a tag, and off for what is already published', async () => {
  await render(release({ tagExists: false }));
  expect(button('Publish')?.disabled).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(container);
  client.clear();
  await render(release({ isDraft: false, publishedAt: '2026-01-02T00:00:00Z' }));
  expect(button('Publish')).toBeUndefined();
});
