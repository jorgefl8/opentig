// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryStatus } from '@shared/git-types';
import type { ToolbarProps } from './Toolbar';
import { MobileToolbar } from './MobileToolbar';

vi.mock('@/components/MobileSheet', () => ({ MobileSheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? createElement('section', null, children) : null }));
vi.mock('@/features/settings/UpdateSettings', () => ({ DesktopUpdateIndicator: () => null }));
vi.mock('@/features/repositories/RepositoryFavicon', () => ({ RepositoryFaviconImage: () => null }));
const initialStatus: RepositoryStatus = {
  branch: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0,
};
let root: Root;
let container: HTMLDivElement;
const pull = vi.fn(); const push = vi.fn();
async function render(status: RepositoryStatus | null, syncBusy = false) {
  const props = { repository: { repositoryName: 'sample' }, status, openFiles: { tabs: [] }, onPull: pull, onPush: push } as unknown as ToolbarProps;
  await act(async () => root.render(createElement(MobileToolbar, { props, repositoryControl: null, branchControl: null, worktreeControl: null, favicon: undefined, contextOpen: true, onContextOpen: () => {}, syncBusy })));
}
const syncButtons = () => [...container.querySelectorAll<HTMLButtonElement>('.mobile-context-sync button')];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  pull.mockClear(); push.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('disables up-to-date sync actions and enables pending actions with their counts', async () => {
  await render(initialStatus);
  expect(syncButtons().slice(1).map((button) => button.disabled)).toEqual([true, true]);
  await act(async () => { syncButtons()[1]!.click(); syncButtons()[2]!.click(); });
  expect(pull).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  await render({ ...initialStatus, behind: 3, ahead: 2 });
  expect(syncButtons().slice(1).map((button) => [button.textContent, button.disabled])).toEqual([['Pull (3)', false], ['Push (2)', false]]);
  await act(async () => { syncButtons()[1]!.click(); syncButtons()[2]!.click(); });
  expect(pull).toHaveBeenCalledOnce(); expect(push).toHaveBeenCalledOnce();
});

it('keeps publication available without pending commits and blocks unsafe or busy sync', async () => {
  await render({ ...initialStatus, upstream: null });
  expect(syncButtons()[1]!.disabled).toBe(true);
  expect(syncButtons()[2]!.textContent).toBe('Publish');
  expect(syncButtons()[2]!.disabled).toBe(false);
  for (const blocked of [{ readOnly: true }, { detached: true }, { unborn: true }]) {
    await render({ ...initialStatus, behind: 3, ahead: 2, ...blocked });
    expect(syncButtons().slice(1).every((button) => button.disabled)).toBe(true);
  }
  await render({ ...initialStatus, behind: 3, ahead: 2 }, true);
  expect(syncButtons().every((button) => button.disabled)).toBe(true);
  await render(null);
  expect(syncButtons().slice(1).every((button) => button.disabled)).toBe(true);
});
