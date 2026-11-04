// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestConversationEntry } from '@shared/contracts';
import { MobileChromeContext } from '@/components/mobile-chrome-context';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { PullRequestEntryEditor, PullRequestEntryMenu } from './PullRequestEntryActions';
import { forgetViewerDrafts, hasViewerDraft, pullRequestEntryEditDraft } from './viewer-drafts';

const api = vi.hoisted(() => ({ editPullRequestEntry: vi.fn(), deletePullRequestEntry: vi.fn(), repositoryAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('sileo', () => ({ sileo: toast }));

const version = '2026-01-02T00:00:00Z';
const entry = (overrides: Partial<PullRequestConversationEntry> = {}): PullRequestConversationEntry => ({
  id: 'c1', kind: 'comment', author: { login: 'sample', avatarUrl: null, isBot: false }, body: 'Old text', createdAt: version, url: null, verdict: null, minimized: false, updatedAt: version, edited: false, canEdit: true, canDelete: true, ...overrides,
});
const identity = { repositoryId: 'repo', number: 7, entryId: 'c1', expectedAccount: { login: 'sample', revision: 3 } };
const gh = (code: string, message: string) => Object.assign(new Error(message), { detail: { code, message } });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 3 });
  api.editPullRequestEntry.mockResolvedValue(undefined);
  api.deletePullRequestEntry.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 }, mutations: { networkMode: 'always', retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); document.body.innerHTML = ''; forgetViewerDrafts(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 6; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
const wrap = (child: ReturnType<typeof createElement>) => createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, child));
const inPage = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
const click = async (element: HTMLElement | undefined) => { await act(async () => element!.click()); await settle(); };
async function type(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLTextAreaElement>('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the menu', () => {
  const onEdit = vi.fn();
  async function renderMenu(value = entry()) {
    await act(async () => root.render(wrap(createElement(PullRequestEntryMenu, { repositoryId: 'repo', number: 7, entry: value, onEdit }))));
    await settle();
    await click(container.querySelector<HTMLElement>('[aria-label^="More actions"]')!);
  }
  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const item = (label: string) => items().find(element => element.textContent === label);

  it('only offers what this entry allows', async () => {
    await renderMenu(entry({ kind: 'review', verdict: 'APPROVED', canDelete: false }));
    expect(items().map(element => element.textContent)).toEqual(['Edit']);
    await click(item('Edit'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('asks before deleting, naming the account, and sends the version that was seen', async () => {
    await renderMenu();
    await click(item('Delete'));
    expect(api.deletePullRequestEntry).not.toHaveBeenCalled();
    expect(document.querySelector('.confirm-popover')?.textContent).toContain('@sample');
    await click(inPage('Delete comment'));
    expect(api.deletePullRequestEntry).toHaveBeenCalledWith({ ...identity, expectedUpdatedAt: version });
    expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Comment deleted' }));
    expect(document.querySelector('.confirm-popover')).toBeNull();
  });

  it('deletes nothing on cancel', async () => {
    await renderMenu();
    await click(item('Delete'));
    await click(inPage('Cancel'));
    expect(api.deletePullRequestEntry).not.toHaveBeenCalled();
    expect(document.querySelector('.confirm-popover')).toBeNull();
  });

  it('does not call a request without an answer a failure, and rereads the conversation', async () => {
    api.deletePullRequestEntry.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
    const refresh = vi.spyOn(client, 'invalidateQueries');
    await renderMenu();
    await click(item('Delete'));
    await click(inPage('Delete comment'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have been deleted') }));
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['repository', 'repo', 'pull-request-conversation'] });
  });

  it("shows GitHub's message when it refuses", async () => {
    api.deletePullRequestEntry.mockRejectedValue(gh('GH_PROCESS_FAILED', "Can't delete this comment"));
    await renderMenu();
    await click(item('Delete'));
    await click(inPage('Delete comment'));
    expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ description: "Can't delete this comment" }));
  });
});

describe('the editor', () => {
  const onClose = vi.fn();
  async function renderEditor(value = entry()) {
    await act(async () => root.render(wrap(createElement(PullRequestEntryEditor, { repositoryId: 'repo', number: 7, entry: value, onClose }))));
    await settle();
  }
  const draftKey = pullRequestEntryEditDraft('repo', 7, 'c1');

  it('starts from the text and only saves a real change', async () => {
    await renderEditor();
    expect(document.querySelector('textarea')?.value).toBe('Old text');
    expect(inPage('Save changes')?.disabled).toBe(true);
    await type('   ');
    expect(inPage('Save changes')?.disabled).toBe(true);
    await type('New text');
    await click(inPage('Save changes'));
    expect(api.editPullRequestEntry).toHaveBeenCalledWith({ ...identity, body: 'New text', expectedUpdatedAt: version });
    expect(onClose).toHaveBeenCalled();
    expect(hasViewerDraft(draftKey)).toBe(false);
  });

  it('keeps the version the text came from when the conversation refreshes', async () => {
    await renderEditor();
    await type('New text');
    await renderEditor(entry({ updatedAt: '2026-01-03T00:00:00Z' }));
    await click(inPage('Save changes'));
    expect(api.editPullRequestEntry).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: version }));
  });

  it('keeps the text after GitHub changed first, and only then lets saving again replace that version', async () => {
    api.editPullRequestEntry.mockRejectedValueOnce(gh('GH_PR_STATE_CHANGED', 'This comment changed on GitHub.'));
    await renderEditor();
    await type('New text');
    await click(inPage('Save changes'));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('textarea')?.value).toBe('New text');
    expect(document.body.textContent).toContain('saving again replaces that version');
    await renderEditor(entry({ updatedAt: '2026-01-03T00:00:00Z' }));
    await click(inPage('Save changes'));
    expect(api.editPullRequestEntry).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: '2026-01-03T00:00:00Z' }));
  });

  it('keeps the text when GitHub does not answer', async () => {
    api.editPullRequestEntry.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
    await renderEditor();
    await type('New text');
    await click(inPage('Save changes'));
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    expect(document.querySelector('textarea')?.value).toBe('New text');
  });

  it('survives leaving and coming back, and Cancel throws the text away', async () => {
    await renderEditor();
    await type('New text');
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderEditor();
    expect(document.querySelector('textarea')?.value).toBe('New text');
    await click(inPage('Cancel'));
    expect(hasViewerDraft(draftKey)).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  it('only lets Escape leave untouched text', async () => {
    await renderEditor();
    await type('New text');
    await act(async () => document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    await type('Old text');
    await act(async () => document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens in a sheet on a phone', async () => {
    const hosts = { title: null, actions: null, float: document.createElement('div') };
    function Phone() {
      const [open, setOpen] = useState(true);
      return open ? createElement(MobileChromeContext.Provider, { value: hosts }, createElement(PullRequestEntryEditor, { repositoryId: 'repo', number: 7, entry: entry(), onClose: () => setOpen(false) })) : null;
    }
    await act(async () => root.render(wrap(createElement(Phone))));
    await settle();
    expect(document.querySelector('.mobile-sheet textarea')).not.toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });
});
