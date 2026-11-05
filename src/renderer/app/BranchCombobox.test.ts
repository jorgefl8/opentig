// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BranchInfo, WorktreeInfo } from '../../shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BranchCombobox, type BranchComboboxWorktrees } from './BranchCombobox';

const branchInfo = (name: string, extra: Partial<BranchInfo> = {}) => ({ name, fullName: name, current: false, remote: false, worktreePath: null, ...extra }) as BranchInfo;
const worktreeInfo = (path: string, branch: string, extra: Partial<WorktreeInfo> = {}) => ({ path, branch, bare: false, locked: null, prunable: null, ...extra }) as WorktreeInfo;
const main = worktreeInfo('/sample/app', 'main');
const hotfix = worktreeInfo('/sample/app-hotfix', 'hotfix');
const branches = [branchInfo('main', { current: true }), branchInfo('feature'), branchInfo('hotfix', { worktreePath: hotfix.path })];

let root: Root;
let container: HTMLDivElement;
const onBranch = vi.fn();
const onManage = vi.fn();
const onSelectWorktree = vi.fn();
const onManageWorktrees = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

const worktreeProps = (items: WorktreeInfo[]): BranchComboboxWorktrees => ({ items, onSelect: onSelectWorktree, onManage: onManageWorktrees });
const trigger = () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const option = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.querySelector('strong')?.textContent === name);
const groups = () => [...document.querySelectorAll('.searchable-picker-group')].map(group => group.textContent);
const footer = () => [...document.querySelectorAll<HTMLButtonElement>('.searchable-picker-footer button')];

async function open(props: { worktrees?: BranchComboboxWorktrees; readOnly?: boolean; disabled?: boolean }) {
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(BranchCombobox, { branches, currentLabel: 'main', onBranch, onManage, ...props }))));
  if (!trigger().disabled) await act(async () => trigger().click());
}

it('offers to manage worktrees only while there is one, since from two on they have their own selector', async () => {
  await open({ worktrees: worktreeProps([main]) });
  expect(groups()).toEqual(['Local']);
  expect(footer().map(row => row.textContent?.trim())).toEqual(['Manage branches…', 'Manage worktrees…']);
  await act(async () => footer()[1]!.click());
  expect(onManageWorktrees).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  root = createRoot(container);
  await open({ worktrees: worktreeProps([main, hotfix]) });
  expect(footer().map(row => row.textContent?.trim())).toEqual(['Manage branches…']);
});

it('opens the worktree of a branch in use there, instead of switching to it', async () => {
  await open({ worktrees: worktreeProps([main, hotfix]) });
  expect(option('hotfix')?.textContent).toContain('In app-hotfix');
  await act(async () => option('hotfix')!.click());
  expect(onSelectWorktree).toHaveBeenCalledExactlyOnceWith(hotfix.path);
  expect(onBranch).not.toHaveBeenCalled();
});

it('still switches branches that no worktree holds', async () => {
  await open({ worktrees: worktreeProps([main, hotfix]) });
  await act(async () => option('feature')!.click());
  expect(onBranch).toHaveBeenCalledExactlyOnceWith('feature');
  expect(onSelectWorktree).not.toHaveBeenCalled();
});

it('refuses a branch whose worktree can not be opened', async () => {
  await open({ worktrees: worktreeProps([main, { ...hotfix, prunable: 'gitdir file points to non-existent location' } as WorktreeInfo]) });
  expect(option('hotfix')?.textContent).toContain('In use');
  await act(async () => option('hotfix')!.click());
  expect(onSelectWorktree).not.toHaveBeenCalled();
  expect(onBranch).not.toHaveBeenCalled();
});

it('opens the worktree of a branch even when a tool has locked it', async () => {
  await open({ worktrees: worktreeProps([main, { ...hotfix, locked: 'claude session hotfix (pid 3692)' } as WorktreeInfo]) });
  expect(option('hotfix')?.textContent).toContain('Open');
  await act(async () => option('hotfix')!.click());
  expect(onSelectWorktree).toHaveBeenCalledExactlyOnceWith(hotfix.path);
});

it('keeps other worktrees reachable during a read-only operation while branches stay locked', async () => {
  await open({ worktrees: worktreeProps([main, hotfix]), readOnly: true });
  expect(trigger().disabled).toBe(false);
  await act(async () => option('feature')!.click());
  expect(onBranch).not.toHaveBeenCalled();
  await act(async () => option('hotfix')!.click());
  expect(onSelectWorktree).toHaveBeenCalledExactlyOnceWith(hotfix.path);
});

it('disables the menu in a read-only operation when it can offer no worktree', async () => {
  await open({ readOnly: true });
  expect(trigger().disabled).toBe(true);
});

it('honours the busy state whatever else it can offer', async () => {
  await open({ worktrees: worktreeProps([main, hotfix]), disabled: true });
  expect(trigger().disabled).toBe(true);
});
