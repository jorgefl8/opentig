// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestConversation, PullRequestConversationEntry } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PullRequestConversationView } from './PullRequestConversationView';

const api = vi.hoisted(() => ({ getPullRequestConversation: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));

const entry = (overrides: Partial<PullRequestConversationEntry>): PullRequestConversationEntry => ({
  id: 'c1', kind: 'comment', author: { login: 'ana', avatarUrl: null, isBot: false }, body: 'Hello **there**', createdAt: '2026-01-01T00:00:00Z', url: 'https://github.com/sample/demo/pull/1#c1', verdict: null, minimized: false, ...overrides,
});
const conversation = (entries: PullRequestConversationEntry[], overrides: Partial<PullRequestConversation> = {}): PullRequestConversation => ({ entries, truncated: false, partial: false, ...overrides });

// Entries load the Markdown pipeline on demand, which is slow the first time.
beforeAll(() => import('@/features/markdown/render-markdown'), 60_000);
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestConversationView, { repositoryId: 'repo', number: 1, url: 'https://github.com/sample/demo/pull/1', live: null, draft: '', onDraftChange: vi.fn() })))));
  for (let tick = 0; tick < 40 && (container.textContent?.includes('Loading conversation') || client.isFetching() > 0); tick++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
}

it('renders Markdown and removes what a third party could abuse', async () => {
  api.getPullRequestConversation.mockResolvedValue(conversation([entry({ body: 'Hello **there**<script>alert(1)</script><img src=x onerror="alert(1)">[x](javascript:alert(1))' })]));
  await render();
  const body = container.querySelector('.pr-conversation-body')!;
  expect(body.querySelector('strong')?.textContent).toBe('there');
  expect(body.innerHTML).not.toContain('<script');
  expect(body.innerHTML).not.toContain('onerror');
  expect(body.innerHTML).not.toContain('javascript:');
});

it('shows each kind of review', async () => {
  api.getPullRequestConversation.mockResolvedValue(conversation([
    entry({ id: 'r1', kind: 'review', verdict: 'APPROVED', body: '' }),
    entry({ id: 'r2', kind: 'review', verdict: 'CHANGES_REQUESTED', body: 'Please fix' }),
    entry({ id: 'r3', kind: 'review', verdict: 'COMMENTED', body: '' }),
  ]));
  await render();
  const metas = [...container.querySelectorAll('.pr-conversation-meta')].map(meta => meta.textContent);
  expect(metas[0]).toContain('approved');
  expect(metas[1]).toContain('requested changes');
  expect(container.textContent).toContain('Left comments on the code');
});

it('hides bots on request, and only offers it when there are bots', async () => {
  api.getPullRequestConversation.mockResolvedValue(conversation([entry({ id: 'c1' }), entry({ id: 'c2', author: { login: 'github-actions', avatarUrl: null, isBot: true } })]));
  await render();
  expect(container.querySelectorAll('.pr-conversation-entry')).toHaveLength(2);
  expect(container.querySelector('.pr-conversation-bot')?.textContent).toBe('bot');
  await act(async () => container.querySelector<HTMLElement>('.pr-conversation-filter [data-slot="checkbox"]')!.click());
  expect(container.querySelectorAll('.pr-conversation-entry')).toHaveLength(1);
  expect(container.querySelector('h3 span')?.textContent).toBe('1');
});

it('does not offer the filter without bots', async () => {
  api.getPullRequestConversation.mockResolvedValue(conversation([entry({})]));
  await render();
  expect(container.querySelector('.pr-conversation-filter')).toBeNull();
});

it('keeps comments hidden on GitHub collapsed, and survives a deleted account', async () => {
  api.getPullRequestConversation.mockResolvedValue(conversation([entry({ minimized: true, author: null })]));
  await render();
  expect(container.querySelector('details.pr-conversation-hidden')?.hasAttribute('open')).toBe(false);
  expect(container.textContent).toContain('Deleted account');
});

it('says when the list is incomplete and when the account sees less', async () => {
  api.getPullRequestConversation.mockResolvedValue(conversation([entry({})], { truncated: true, partial: true }));
  await render();
  expect(container.querySelector('h3 span')?.textContent).toBe('1+');
  expect(container.textContent).toContain('Showing the most recent comments and reviews');
  expect(container.textContent).toContain('some of the conversation may be missing');
});

it('offers a retry when it cannot load', async () => {
  api.getPullRequestConversation.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(conversation([]));
  await render();
  expect(container.textContent).toContain("Couldn't load the conversation.");
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Retry'))!.click());
  for (let tick = 0; tick < 10; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(container.textContent).toContain('Nobody has commented yet.');
});
