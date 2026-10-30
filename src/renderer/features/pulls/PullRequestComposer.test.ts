// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestLiveState } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { PullRequestComposer } from './PullRequestComposer';

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
  container.remove(); client.clear(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.resetAllMocks();
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
async function openReview() {
  await act(async () => button('Review')!.click());
  await settle();
}
const items = () => [...document.querySelectorAll('[role="menuitem"]')];
const item = (label: string) => items().find(entry => entry.textContent === label) as HTMLElement;
async function choose(label: string) {
  await act(async () => item(label).click());
  await settle();
}

it('posts a comment and clears the box', async () => {
  await render();
  expect(button('Comment')?.disabled).toBe(true);
  await type('Looks good');
  await act(async () => button('Comment')!.click());
  await settle();
  expect(api.commentOnPullRequest).toHaveBeenCalledWith({ repositoryId: 'repo', number: 7, body: 'Looks good', ...account });
  expect(container.querySelector('textarea')?.value).toBe('');
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

it('holds sending back after no answer, until the conversation is checked', async () => {
  api.commentOnPullRequest.mockRejectedValue(new ServerRequestTimeoutError('Server request timed out'));
  await render();
  await type('Important');
  await act(async () => button('Comment')!.click());
  await settle();
  expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have been posted') }));
  expect(container.querySelector('textarea')?.value).toBe('Important');
  expect(button('Comment')?.disabled).toBe(true);
  expect(button('Review')?.disabled).toBe(true);
  await act(async () => button('Refresh')!.click());
  await settle();
  expect(onRefresh).toHaveBeenCalled();
  expect(button('Comment')?.disabled).toBe(false);
});
