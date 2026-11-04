// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestLiveState, PullRequestSummary } from '@shared/contracts';
import type { GitHubRepositoryAccount } from '@shared/github-accounts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryKeys } from '@/lib/query-client';
import { PullRequestsView } from './PullRequestsView';

const api = vi.hoisted(() => ({ getPullRequestLiveState: vi.fn(), listReleases: vi.fn() }));
const browser = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('@/lib/browser-capabilities', async (original) => ({ ...await original<object>(), openExternalUrl: browser.openExternalUrl }));

const pull = (number: number, overrides: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number, title: `Change ${number}`, state: 'OPEN', isDraft: false, author: 'sample', authorAvatarUrl: 'https://example.invalid/a.png', headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z', url: `https://github.com/sample/demo/pull/${number}`, reviewDecision: null, additions: 3, deletions: 1, checksState: 'PASSING', ...overrides,
});
const onRefresh = vi.fn();
const onSelect = vi.fn();
const onSectionChange = vi.fn();
const onOpenGitHubSettings = vi.fn();
const onStateChange = vi.fn();

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let mobile = false;
beforeEach(() => {
  mobile = false;
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // Virtual rows only appear in a list with a height.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 5; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render(overrides: Partial<Parameters<typeof PullRequestsView>[0]> = {}) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestsView, {
    repositoryId: 'repo', account: { state: 'ready', login: 'sample' } as GitHubRepositoryAccount, onOpenGitHubSettings, info: { isGitHub: true, nameWithOwner: 'sample/demo' },
    ghStatus: { installed: true, authStatus: 'authenticated' } as never, pulls: [pull(2, { reviewDecision: 'REVIEW_REQUIRED' }), pull(1)], loading: false, error: null, states: ['OPEN'], activeNumber: null, createDisabledReason: null,
    onRefresh, onStateChange, onSelect, onCreate: vi.fn(), onCopyCommand: vi.fn(), section: 'pulls', onSectionChange, activeRelease: null, onSelectRelease: vi.fn(), ...overrides,
  })))));
  await settle();
}
const rows = () => [...container.querySelectorAll('.pull-item')];
const meta = () => rows().map(row => row.querySelector('.pull-meta')?.textContent);
async function openMenu() {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Filter pull requests"]')!.click());
  await settle();
}
const action = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.pulls-menu-action')].find(item => item.textContent?.includes(label))!;

it('shows a dot, the title, where it stands, and who changed how much and when', async () => {
  await render();
  expect(meta()).toEqual(['#2 · Review required', '#1 · Checks passing']);
  expect(rows()[0]?.querySelector('.status-dot')?.classList.contains('tone-attention')).toBe(true);
  const row = rows()[0]!;
  expect(row.querySelector('.pull-avatar-status img')?.getAttribute('src')).toBe('https://example.invalid/a.png');
  expect(row.querySelector('.pull-avatar-status .status-dot')).not.toBeNull();
  expect(row.querySelector('.pull-author')?.textContent).toBe('· sample');
  expect(row.querySelector('.pull-lines .add')?.textContent).toMatch(/^\+\d+$/);
  expect(row.querySelector('.pull-lines .del')?.textContent).toMatch(/^−\d+$/);
  expect(row.querySelector('.pull-age')?.textContent).toMatch(/ ago$/);
  await act(async () => rows()[1]!.querySelector<HTMLButtonElement>('.pull-main')!.click());
  expect(onSelect).toHaveBeenCalledWith(1);
});

it('agrees with the viewer on the selected row, without asking GitHub for any row', async () => {
  client.setQueryData(queryKeys.pullRequestLiveState('repo', 1), { state: 'OPEN', isDraft: false, baseRefName: 'main', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', mergeQueue: { enabled: false, queued: false }, checks: { rollup: 'NONE', items: [], truncated: false, partial: false } } as unknown as PullRequestLiveState);
  await render({ activeNumber: 1 });
  expect(meta()).toEqual(['#2 · Review required', '#1 · Conflicts with main']);
  expect(rows()[1]?.classList.contains('active')).toBe(true);
  expect(api.getPullRequestLiveState).not.toHaveBeenCalled();
  await render({ activeNumber: 2 });
  expect(meta()).toEqual(['#2 · Review required', '#1 · Checks passing']);
  expect(api.getPullRequestLiveState).not.toHaveBeenCalled();
});

it('switches sections with plain tabs', async () => {
  await render();
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  expect(tabs.map(tab => tab.textContent)).toEqual(['Pull requests', 'Releases']);
  expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  await act(async () => (tabs[1] as HTMLElement).click());
  expect(onSectionChange).toHaveBeenCalledWith('releases');
});

it('keeps the filter, refreshing, GitHub and the account in one menu', async () => {
  await render();
  await openMenu();
  await act(async () => document.querySelector<HTMLElement>('#pulls-state-closed')!.click());
  expect(onStateChange).toHaveBeenCalledWith('CLOSED', true);
  await act(async () => action('Refresh pull requests').click());
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(action('Open on GitHub').textContent).toContain('sample/demo');
  await act(async () => action('Open on GitHub').click());
  await settle();
  expect(browser.openExternalUrl).toHaveBeenCalledWith('https://github.com/sample/demo/pulls');
  await openMenu();
  await act(async () => action('@sample').click());
  expect(onOpenGitHubSettings).toHaveBeenCalledOnce();
});

it('stops refreshing twice, and leaves out what the repository does not have', async () => {
  await render({ loading: true, account: null, info: { isGitHub: true, nameWithOwner: null } });
  await openMenu();
  expect(action('Refresh pull requests').disabled).toBe(true);
  expect(action('Open on GitHub')).toBeUndefined();
  expect(action('@')).toBeUndefined();
});

it('marks a filter that hides what the list shows by default', async () => {
  await render({ states: ['OPEN', 'MERGED'] });
  expect(container.querySelector('[aria-label="Filter pull requests"]')?.getAttribute('aria-pressed')).toBe('true');
});

it('keeps New off with a reason that can still be reached', async () => {
  const onCreate = vi.fn();
  await render({ createDisabledReason: 'Check out a branch first', onCreate });
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Create pull request"]')!;
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(onCreate).not.toHaveBeenCalled();
});

it('makes the whole row the target on a phone, with its stack as text and the rest in the viewer', async () => {
  mobile = true;
  await render({ pulls: [pull(3, { stack: { number: 9, position: 2, size: 3, base: 'main' }, url: 'https://github.com/sample/demo/pull/3' })] });
  const [row] = rows();
  expect([...row!.querySelectorAll('button')].map((button) => button.className)).toEqual(['pull-main']);
  expect(row!.querySelector('.pull-meta')?.textContent).toContain('Layer 2 of 3');
  await act(async () => row!.querySelector<HTMLButtonElement>('.pull-main')!.click());
  expect(onSelect).toHaveBeenCalledWith(3);
});

it('keeps a row\'s stack and link beside it elsewhere', async () => {
  await render({ pulls: [pull(3, { stack: { number: 9, position: 2, size: 3, base: 'main' }, url: 'https://github.com/sample/demo/pull/3' })] });
  const [row] = rows();
  expect(row!.querySelector('.pr-stack-trigger')).not.toBeNull();
  expect(row!.querySelector('[aria-label="Open #3 on GitHub"]')).not.toBeNull();
  expect(row!.querySelector('.pull-meta')?.textContent).not.toContain('Layer');
});
