// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestLiveState } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MobileChromeContext, type MobileChromeHosts } from '@/components/mobile-chrome-context';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { PullRequestComposer } from './PullRequestComposer';
import { forgetViewerDrafts } from './viewer-drafts';

const api = vi.hoisted(() => ({ commentOnPullRequest: vi.fn(), reviewPullRequest: vi.fn(), repositoryAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('sileo', () => ({ sileo: toast }));

const oid = 'a'.repeat(40);
const live = (overrides: { state?: PullRequestLiveState['state']; didAuthor?: boolean } = {}) => ({ state: overrides.state ?? 'OPEN', headRefOid: oid, viewer: { didAuthor: overrides.didAuthor ?? false } }) as PullRequestLiveState;
const account = { expectedAccount: { login: 'sample', revision: 3 } };
const onRefresh = vi.fn();

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 3 });
  api.commentOnPullRequest.mockResolvedValue(undefined);
  api.reviewPullRequest.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 }, mutations: { networkMode: 'always', retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); document.body.innerHTML = ''; forgetViewerDrafts(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 5; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
function Composer({ state }: { state: PullRequestLiveState }) {
  const [draft, setDraft] = useState('');
  return createElement(PullRequestComposer, { repositoryId: 'repo', number: 7, live: state, draft, onDraftChange: setDraft, onRefresh });
}
async function render(state = live()) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(Composer, { state })))));
  await settle();
}
async function type(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
async function expand() {
  await act(async () => container.querySelector('textarea')!.focus());
}
async function press(key: string) {
  await act(async () => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
}
async function openReview() {
  await expand();
  await act(async () => button('Review')!.click());
  await settle();
}
const items = () => [...document.querySelectorAll('[role="menuitem"]')];
const item = (label: string) => items().find(entry => entry.textContent === label) as HTMLElement;
async function choose(label: string) {
  await act(async () => item(label).click());
  await settle();
}

it('starts as one line, and offers the rest once focused', async () => {
  await render();
  const box = container.querySelector('textarea')!;
  expect(box.getAttribute('placeholder')).toBe('Write a comment');
  expect(box.getAttribute('aria-label')).toBe('Add a comment');
  expect(button('Comment')).toBeUndefined();
  expect(button('Review')).toBeUndefined();
  await expand();
  expect(container.querySelector('textarea')).toBe(box);
  expect(document.activeElement).toBe(box);
  expect(button('Comment')?.disabled).toBe(true);
  expect(button('Review')).toBeDefined();
  expect(container.querySelector('label')?.textContent).toBe('Add a comment');
});

it('folds an empty box when focus leaves, and stays open with text in it', async () => {
  await render();
  const outside = document.createElement('button');
  document.body.append(outside);
  await expand();
  await act(async () => outside.focus());
  expect(button('Comment')).toBeUndefined();
  await type('Important');
  expect(button('Comment')).toBeDefined();
  await act(async () => outside.focus());
  expect(button('Comment')).toBeDefined();
  outside.remove();
});

it('keeps the draft when Escape folds it, and opens again with it', async () => {
  await render();
  await type('Important');
  await press('Escape');
  expect(button('Comment')).toBeUndefined();
  expect(container.querySelector('textarea')?.value).toBe('Important');
  await act(async () => container.querySelector('textarea')!.click());
  expect(button('Comment')?.disabled).toBe(false);
  expect(container.querySelector('textarea')?.value).toBe('Important');
});

it('shows a draft kept across tabs instead of folding it', async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestComposer, { repositoryId: 'repo', number: 7, live: live(), draft: 'Kept', onDraftChange: vi.fn(), onRefresh })))));
  await settle();
  expect(button('Comment')).toBeDefined();
  expect(container.querySelector('textarea')?.value).toBe('Kept');
});

it('does not fold while its review menu takes the focus', async () => {
  await render();
  await openReview();
  await act(async () => item('Approve').focus());
  expect(button('Review')).toBeDefined();
});

it('posts a comment and clears the box', async () => {
  await render();
  await expand();
  expect(button('Comment')?.disabled).toBe(true);
  await type('Looks good');
  await act(async () => button('Comment')!.click());
  await settle();
  expect(api.commentOnPullRequest).toHaveBeenCalledWith({ repositoryId: 'repo', number: 7, body: 'Looks good', ...account });
  expect(container.querySelector('textarea')?.value).toBe('');
  expect(button('Comment')).toBeUndefined();
  expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Comment posted' }));
});

it('approves without text, with the head that was read', async () => {
  await render();
  await openReview();
  await choose('Approve');
  expect(api.reviewPullRequest).toHaveBeenCalledWith({ repositoryId: 'repo', number: 7, body: '', expectedHeadOid: oid, verdict: 'approve', ...account });
  expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pull request approved' }));
});

it('needs text to request changes or comment as a review', async () => {
  await render();
  await openReview();
  expect(item('Request changes').hasAttribute('data-disabled')).toBe(true);
  expect(item('Comment as a review').hasAttribute('data-disabled')).toBe(true);
  expect(item('Approve').hasAttribute('data-disabled')).toBe(false);
});

it('lets an author only comment on their own PR', async () => {
  await render(live({ didAuthor: true }));
  await openReview();
  expect(items().map(entry => entry.textContent)).toEqual(['Comment as a review']);
});

it('offers no review once the PR is finished, and still takes comments', async () => {
  await render(live({ state: 'MERGED' }));
  await expand();
  expect(button('Review')).toBeUndefined();
  expect(button('Comment')).toBeDefined();
});

it('keeps the text after a rejection', async () => {
  api.commentOnPullRequest.mockRejectedValue(Object.assign(new Error('no'), { detail: { code: 'GH_PROCESS_FAILED', operation: 'gh-pr-comment', message: 'Locked conversation' } }));
  await render();
  await type('Important');
  await act(async () => button('Comment')!.click());
  await settle();
  expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ description: 'Locked conversation' }));
  expect(container.querySelector('textarea')?.value).toBe('Important');
});

it('still holds sending back after the composer has left the screen and returned', async () => {
  api.commentOnPullRequest.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
  await render();
  await type('Important');
  await act(async () => button('Comment')!.click());
  await settle();
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toContain('It may have been posted');
  await act(async () => { container.querySelector('textarea')?.focus(); });
  expect(button('Comment')?.disabled ?? true).toBe(true);
});

it('holds sending back after no answer, until the conversation is checked', async () => {
  api.commentOnPullRequest.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
  await render();
  await type('Important');
  await act(async () => button('Comment')!.click());
  await settle();
  expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have been posted') }));
  expect(container.querySelector('textarea')?.value).toBe('Important');
  expect(button('Comment')?.disabled).toBe(true);
  expect(button('Review')?.disabled).toBe(true);
  await press('Escape');
  expect(button('Refresh')).toBeDefined();
  await act(async () => button('Refresh')!.click());
  await settle();
  expect(onRefresh).toHaveBeenCalled();
  expect(button('Comment')?.disabled).toBe(false);
});

describe('on a phone', () => {
  let float: HTMLDivElement;
  async function renderPhone(initial = '') {
    float = document.createElement('div');
    document.body.append(float);
    const hosts: MobileChromeHosts = { title: null, actions: null, float };
    function Phone() {
      const [draft, setDraft] = useState(initial);
      return createElement(MobileChromeContext.Provider, { value: hosts }, createElement(PullRequestComposer, { repositoryId: 'repo', number: 7, live: live(), draft, onDraftChange: setDraft, onRefresh }));
    }
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(Phone)))));
    await settle();
  }
  const dock = () => float.querySelector<HTMLButtonElement>('.mobile-main-dock')!;
  const sheet = () => document.querySelector<HTMLElement>('.mobile-sheet');
  const write = async (value: string) => {
    await act(async () => {
      const input = sheet()!.querySelector<HTMLTextAreaElement>('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const inSheet = (label: string) => [...sheet()!.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
  const dismiss = async () => {
    await act(async () => sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Close Comment"]')!.click());
    await settle();
  };

  it('docks a one-line field that opens the composer in a sheet', async () => {
    await renderPhone();
    expect(dock().textContent).toBe('Write a comment');
    expect(sheet()).toBeNull();
    await act(async () => dock().click());
    await settle();
    expect(sheet()!.querySelector('.mobile-sheet-title')?.textContent).toBe('Comment');
    expect(inSheet('Comment').disabled).toBe(true);
    expect(sheet()!.textContent).toContain('Posting as @sample');
  });

  it('keeps the draft when the sheet closes, showing it on the field', async () => {
    await renderPhone();
    await act(async () => dock().click());
    await settle();
    await write('Looks good\nsecond line');
    await dismiss();
    expect(sheet()).toBeNull();
    expect(dock().textContent).toBe('Looks good');
    await act(async () => dock().click());
    await settle();
    expect(sheet()!.querySelector('textarea')!.value).toBe('Looks good\nsecond line');
  });

  it('does not open by itself for a draft that survived switching tabs', async () => {
    await renderPhone('Kept');
    expect(sheet()).toBeNull();
    expect(dock().textContent).toBe('Kept');
  });

  it('remembers what may have been posted after the sheet closes, and blocks a second send', async () => {
    api.commentOnPullRequest.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
    await renderPhone();
    await act(async () => dock().click());
    await settle();
    await write('Once only');
    await act(async () => inSheet('Comment').click());
    await settle();
    await dismiss();
    expect(float.textContent).toContain('It may have been posted');
    await act(async () => dock().click());
    await settle();
    expect(inSheet('Comment').disabled).toBe(true);
    expect(api.commentOnPullRequest).toHaveBeenCalledTimes(1);
  });

  it('closes and clears after sending', async () => {
    await renderPhone();
    await act(async () => dock().click());
    await settle();
    await write('Done');
    await act(async () => inSheet('Comment').click());
    await settle();
    expect(sheet()).toBeNull();
    expect(dock().textContent).toBe('Write a comment');
  });
});
