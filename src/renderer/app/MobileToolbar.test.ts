// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryStatus } from '@shared/git-types';
import type { PullRequestSummary } from '@shared/contracts';
import type { ToolbarProps } from './Toolbar';
import { MobileToolbar } from './MobileToolbar';

vi.mock('@/components/MobileSheet', () => ({ MobileSheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? createElement('section', null, children) : null }));
vi.mock('@/features/settings/UpdateSettings', () => ({ DesktopUpdateIndicator: () => null }));
const initialStatus: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};
let root: Root;
let container: HTMLDivElement;
const pull = vi.fn(); const push = vi.fn(); const settings = vi.fn(); const back = vi.fn();
async function render(status: RepositoryStatus | null, syncBusy = false, branchPullRequest: PullRequestSummary | null = null, pendingRepositoryName: string | null = null, overrides: Partial<ToolbarProps> = {}) {
  const props = { repository: { repositoryName: 'sample' }, status, branchPullRequest, worktrees: [], onPull: pull, onPush: push, onSettingsOpen: settings, repositoryLoadPhase: pendingRepositoryName ? 'opening' : null, ...overrides } as unknown as ToolbarProps;
  await act(async () => root.render(createElement(MobileToolbar, { props, repositoryControl: null, branchControl: null, worktreeControl: createElement('i', { className: 'worktree-control' }), pendingRepositoryName, loadIndicator: null, contextOpen: true, onContextOpen: () => {}, syncBusy })));
}
const syncButtons = () => [...container.querySelectorAll<HTMLButtonElement>('.mobile-context-sync button')];
const syncRow = (label: string) => syncButtons().find((button) => button.textContent?.startsWith(label));
const pill = () => container.querySelector<HTMLButtonElement>('.mobile-sync-pill');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  pull.mockClear(); push.mockClear(); settings.mockClear(); back.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('offers only the sync actions that apply, with their counts', async () => {
  await render(initialStatus);
  expect(syncButtons().map((button) => button.textContent)).toEqual(['Refresh']);
  await render({ ...initialStatus, behind: 3, ahead: 2 });
  expect(syncButtons().map((button) => [button.textContent, button.disabled])).toEqual([['Push2 commits', false], ['Pull3 commits', false], ['Refresh', false]]);
  expect(syncRow('Push')!.classList.contains('go')).toBe(true);
  await act(async () => { syncRow('Pull')!.click(); syncRow('Push')!.click(); });
  expect(pull).toHaveBeenCalledOnce(); expect(push).toHaveBeenCalledOnce();
});

it('keeps publication available without pending commits and blocks unsafe or busy sync', async () => {
  await render({ ...initialStatus, upstream: null });
  expect(syncRow('Pull')).toBeUndefined();
  expect(syncRow('Publish')!.textContent).toBe('Publish this branch');
  expect(syncRow('Publish')!.disabled).toBe(false);
  for (const blocked of [{ readOnly: true }, { detached: true }, { unborn: true }]) {
    await render({ ...initialStatus, behind: 3, ahead: 2, ...blocked });
    expect([syncRow('Pull')!.disabled, syncRow('Push')!.disabled]).toEqual([true, true]);
    expect(pill()).toBeNull();
  }
  await render({ ...initialStatus, behind: 3, ahead: 2 }, true);
  expect(syncButtons().every((button) => button.disabled)).toBe(true);
  expect(pill()!.disabled).toBe(true);
  await render(null);
  expect(syncButtons().map((button) => button.textContent)).toEqual(['Refresh']);
  expect(pill()).toBeNull();
});

it('shows one sync pill in the bar, pulling before pushing', async () => {
  await render(initialStatus);
  expect(pill()).toBeNull();
  await render({ ...initialStatus, upstream: null });
  expect(pill()!.textContent).toBe('Publish');
  await act(async () => pill()!.click());
  expect(push).toHaveBeenCalledOnce();
  await render({ ...initialStatus, ahead: 2 });
  expect(pill()!.textContent).toBe('Push 2');
  expect(pill()!.getAttribute('aria-label')).toBe('Push 2 commits');
  await render({ ...initialStatus, behind: 3, ahead: 2 });
  expect(pill()!.textContent).toBe('Pull 3');
  await act(async () => pill()!.click());
  expect(pull).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledOnce();
});

it('reaches settings from the gear, and leaves the settings row out of the sheet', async () => {
  await render(initialStatus);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!.click());
  expect(settings).toHaveBeenCalledWith(true);
  expect([...container.querySelectorAll('.mobile-sheet-action')].map((row) => row.textContent)).not.toContain('Settings');
});

it('lists a worktree picker only when there are several', async () => {
  await render(initialStatus);
  expect(container.querySelector('.worktree-control')).toBeNull();
  await render(initialStatus, false, null, null, { worktrees: [{ path: 'a' }, { path: 'b' }] } as unknown as Partial<ToolbarProps>);
  expect(container.querySelector('.worktree-control')).not.toBeNull();
});

it('becomes a back arrow with slots for the viewer, and moves focus to the arrow', async () => {
  const setTitleHost = vi.fn(); const setActionsHost = vi.fn();
  await render(initialStatus, false, null, null, { mobileViewer: { onBack: back, setTitleHost, setActionsHost } });
  const arrow = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!;
  expect(document.activeElement).toBe(arrow);
  expect(setTitleHost).toHaveBeenCalledWith(expect.any(HTMLElement));
  expect(setActionsHost).toHaveBeenCalledWith(expect.any(HTMLElement));
  expect(container.querySelector('.mobile-repository-context')).toBeNull();
  expect(container.querySelector('.mobile-sync-pill')).toBeNull();
  await act(async () => arrow.click());
  expect(back).toHaveBeenCalledOnce();
});

it('labels merged PRs in the repository menu with the merge icon', async () => {
  await render(initialStatus, false, { number: 12, state: 'MERGED' } as PullRequestSummary);
  const action = container.querySelector<HTMLButtonElement>('.mobile-branch-pr')!;
  expect(action.textContent).toBe('View merged pull request #12');
  expect(action.querySelector('.tabler-icon-git-merge')).not.toBeNull();
  await render(initialStatus, false, { number: 13, state: 'OPEN' } as PullRequestSummary);
  expect(container.querySelector('.mobile-branch-pr')?.textContent).toBe('Open pull request #13');
  expect(container.querySelector('.mobile-repository-context small')?.textContent).toBe('main · #13');
});

it('names the repository being opened and does not report a detached HEAD before its status loads', async () => {
  await render(null, false, null, 'todor');
  const context = container.querySelector('.mobile-repository-context')!;
  expect(context.querySelector('strong')?.textContent).toBe('Opening todor…');
  expect(context.querySelector('small')?.textContent).toBe('Loading…');
  await render(initialStatus);
  expect(context.querySelector('strong')?.textContent).toBe('sample');
  expect(context.querySelector('small')?.textContent).toBe('main');
});
