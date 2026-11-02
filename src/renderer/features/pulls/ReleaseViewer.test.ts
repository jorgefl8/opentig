// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseDetails } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MobileChromeContext, type MobileChromeHosts } from '@/components/mobile-chrome-context';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { ReleaseViewer } from './ReleaseViewer';

const api = vi.hoisted(() => ({ getRelease: vi.fn(), deleteDraftRelease: vi.fn(), publishRelease: vi.fn(), updateRelease: vi.fn(), repositoryAccount: vi.fn(), listWorkflows: vi.fn(() => new Promise(() => {})) }));
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
const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
const panel = () => document.querySelector('.confirm-popover');
const moreButton = () => container.querySelector<HTMLButtonElement>('[aria-label="More release actions"]');
async function openMenu() {
  await act(async () => moreButton()!.click());
  await settle();
}
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
async function choose(label: string) {
  await act(async () => menuItems().find(item => item.textContent === label)!.click());
  await settle();
}

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
  await openMenu();
  await choose('Delete draft…');
  expect(api.deleteDraftRelease).not.toHaveBeenCalled();
  expect(panel()?.textContent).toContain("The tag isn't touched");
  expect(panel()?.textContent).toContain('as @sample');
  await act(async () => button('Delete draft')!.click());
  await settle();
  expect(api.deleteDraftRelease).toHaveBeenCalledWith({ repositoryId: 'repo', tagName: 'v1.0.0', expectedDatabaseId: 42, expectedAccount: { login: 'sample', revision: 3 } });
  expect(onClose).toHaveBeenCalledOnce();
});

it('cancels with Escape, and returns focus to the menu that asked', async () => {
  await render();
  await openMenu();
  await choose('Delete draft…');
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await settle();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(moreButton());
  expect(api.deleteDraftRelease).not.toHaveBeenCalled();
});

it('offers no deletion for a published release', async () => {
  await render(release({ isDraft: false, publishedAt: '2026-01-02T00:00:00Z', isLatest: true }));
  await openMenu();
  expect(menuItems().map(item => item.textContent)).toEqual(['Open on GitHub', 'Edit title and notes…']);
  expect(container.querySelector('.pr-status')?.textContent?.trim()).toBe('Latest');
});

it('leads the status line with the state and tag, as plain text', async () => {
  await render(release({ isPrerelease: true, isImmutable: true }));
  const status = container.querySelector('.pr-viewer-status')!;
  expect(status.querySelector('.pr-status')?.textContent?.trim()).toBe('Draft');
  expect(status.textContent).toContain('v1.0.0');
  expect(status.textContent).toContain('Pre-release');
  expect(status.textContent).toContain('Immutable');
  expect(container.querySelector('[data-slot="badge"]')).toBeNull();
});

it('edits in place, with the version of the notes it started from', async () => {
  api.updateRelease.mockResolvedValue(undefined);
  await render();
  await openMenu();
  await choose('Edit title and notes…');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('#edit-release-notes')?.value).toBe('Some **notes**');
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#edit-release-title')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, ' New name ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Save changes')!.click());
  await settle();
  expect(api.updateRelease).toHaveBeenCalledWith({ repositoryId: 'repo', tagName: 'v1.0.0', expectedDatabaseId: 42, expectedBodyHash: 'a'.repeat(64), title: 'New name', notes: 'Some **notes**', expectedAccount: { login: 'sample', revision: 3 } });
  expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Release updated' }));
  expect(container.querySelector('#edit-release-title')).toBeNull();
});

it('keeps the text in place when the notes changed on GitHub first', async () => {
  api.updateRelease.mockRejectedValue(Object.assign(new Error('changed'), { detail: { code: 'GH_PR_STATE_CHANGED', operation: 'gh-release-edit', message: 'These notes changed on GitHub. Your changes were not saved.' } }));
  await render();
  await openMenu();
  await choose('Edit title and notes…');
  await act(async () => button('Save changes')!.click());
  await settle();
  expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('not saved') }));
  expect(container.querySelector('#edit-release-title')).not.toBeNull();
});

it('offers nothing to change without write access', async () => {
  await render(release({ viewerCanWrite: false }));
  expect(moreButton()).toBeNull();
  expect(button('Publish')).toBeUndefined();
  expect(container.textContent).toContain('requires write access');
  expect(api.repositoryAccount).not.toHaveBeenCalled();
});

it('says why a draft without its tag cannot be published, and offers the way forward', async () => {
  await render(release({ tagExists: false }));
  expect(container.textContent).toContain("Can't publish yet: no tag on GitHub");
  api.listWorkflows.mockClear();
  await act(async () => button('Run a workflow…')!.click());
  await settle();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(api.listWorkflows).toHaveBeenCalledWith('repo');
});

it('only offers a workflow when the tag is what is missing', async () => {
  await render();
  expect(button('Run a workflow…')).toBeUndefined();
});

it('says the deletion may have worked when there is no answer', async () => {
  api.deleteDraftRelease.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
  await render();
  await openMenu();
  await choose('Delete draft…');
  await act(async () => button('Delete draft')!.click());
  await settle();
  expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have completed') }));
  expect(toast.error).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(panel()).toBeNull();
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
  const question = panel()!.textContent;
  expect(question).toContain('v1.0.0');
  expect(question).toContain('bbbbbbbbbbbb');
  expect(question).toContain('app.exe');
  expect(question).toContain('as @sample');
  expect(question).toContain('any workflow that runs on publication starts');
  await act(async () => button('Publish release')!.click());
  await settle();
  expect(api.publishRelease).toHaveBeenCalledWith({ repositoryId: 'repo', tagName: 'v1.0.0', expectedDatabaseId: 42, expectedAccount: { login: 'sample', revision: 3 } });
  expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Release published' }));
});

it('warns when a draft has no assets', async () => {
  await render(release({ assets: [] }));
  await act(async () => button('Publish')!.click());
  expect(panel()?.textContent).toContain('Check that nothing is missing');
});

it('keeps Publish off without a tag, and off for what is already published', async () => {
  await render(release({ tagExists: false }));
  // Still focusable, so its reason can be read from the tooltip.
  expect(button('Publish')?.getAttribute('aria-disabled')).toBe('true');
  await act(async () => button('Publish')!.click());
  await settle();
  expect(panel()).toBeNull();
  expect(api.publishRelease).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  root = createRoot(container);
  client.clear();
  await render(release({ isDraft: false, publishedAt: '2026-01-02T00:00:00Z' }));
  expect(button('Publish')).toBeUndefined();
});

describe('on a phone', () => {
  let hosts: MobileChromeHosts;
  async function renderPhone(value: ReleaseDetails = release()) {
    hosts = { title: document.createElement('div'), actions: document.createElement('div'), float: document.createElement('div') };
    document.body.append(hosts.title!, hosts.actions!, hosts.float!);
    api.getRelease.mockResolvedValue(value);
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(MobileChromeContext.Provider, { value: hosts }, createElement(ReleaseViewer, { repositoryId: 'repo', tagName: value.tagName, onClose }))))));
    await settle();
  }
  const publishPill = () => hosts.float!.querySelector<HTMLButtonElement>('button');
  const sheet = () => document.querySelector<HTMLElement>('.mobile-sheet');

  it('names the tag in the top bar', async () => {
    await renderPhone();
    expect(hosts.title!.textContent).toBe('v1.0.0');
    expect(hosts.actions!.querySelector('[aria-label="More release actions"]')).not.toBeNull();
    expect(moreButton()).toBeNull();
  });

  it('asks in a sheet before publishing, listing the same facts and who it acts as', async () => {
    api.publishRelease.mockResolvedValue(undefined);
    await renderPhone();
    await act(async () => publishPill()!.click());
    await settle();
    expect(api.publishRelease).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
    expect(sheet()!.querySelector('.mobile-sheet-title')?.textContent).toBe('Publish v1.0.0');
    for (const fact of ['bbbbbbbbbbbb', 'app.exe', 'any workflow that runs on publication starts', 'as @sample']) expect(sheet()!.textContent).toContain(fact);
    await act(async () => [...sheet()!.querySelectorAll('button')].find((item) => item.textContent === 'Publish release')!.click());
    await settle();
    expect(api.publishRelease).toHaveBeenCalledTimes(1);
  });

  it('keeps Publish off and says why when the tag is missing', async () => {
    await renderPhone(release({ tagExists: false }));
    expect(publishPill()!.disabled).toBe(true);
    expect(hosts.float!.querySelector('.mobile-float-note')?.textContent).toBe("The tag v1.0.0 isn't on GitHub yet. Run a workflow that creates it, or push it yourself.");
    await act(async () => publishPill()!.click());
    expect(sheet()).toBeNull();
  });

  it('floats nothing for what is published or out of reach', async () => {
    await renderPhone(release({ isDraft: false }));
    expect(publishPill()).toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPhone(release({ viewerCanWrite: false }));
    expect(publishPill()).toBeNull();
    expect(container.textContent).toContain('requires write access');
  });
});
