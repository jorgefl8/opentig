import { useMemo } from 'react';
import { IconChevronDown, IconGitBranch, IconHierarchy2 } from '@tabler/icons-react';
import type { BranchInfo, WorktreeInfo } from '../../shared/git-types';
import { SearchablePicker, type SearchablePickerItem } from '@/components/SearchablePicker';
import { samePath } from '@/features/refs/local-refs-model';

const WORKTREE_VALUE_PREFIX = 'worktree:';

export interface BranchComboboxWorktrees {
  items: WorktreeInfo[];
  currentPath: string;
  onSelect(path: string): void;
  onManage(): void;
}

/**
 * Branch selection, plus the worktrees when a caller has no selector of its own
 * for them. Their group appears only once there is another worktree to choose,
 * while managing them stays available so a first one can be added.
 */
export function BranchCombobox({ branches, currentLabel, disabled, readOnly, crumb, worktrees, onBranch, onManage }: {
  branches: BranchInfo[]; currentLabel: string; disabled?: boolean | undefined; readOnly?: boolean | undefined; crumb?: boolean | undefined;
  worktrees?: BranchComboboxWorktrees | undefined; onBranch(name: string | null): void; onManage(): void;
}) {
  const worktreeItems = worktrees?.items;
  const currentWorktreePath = worktrees?.currentPath;
  const { groups, currentValue } = useMemo(() => {
    const local: SearchablePickerItem[] = [];
    const remote: SearchablePickerItem[] = [];
    let currentValue = '';
    for (const branch of branches) {
      if (branch.remote && branch.fullName.endsWith('/HEAD')) continue;
      const otherWorktree = Boolean(!branch.remote && branch.worktreePath && !branch.current);
      if (!branch.remote && branch.current) currentValue = branch.fullName;
      (branch.remote ? remote : local).push({
        value: branch.fullName,
        label: branch.name,
        trailing: branch.current ? <span className="searchable-picker-status">Current</span>
          : otherWorktree ? <span className="searchable-picker-status">In use</span> : undefined,
        search: branch.fullName,
        tooltip: `${branch.fullName}${otherWorktree ? ' · In another worktree' : ''}`,
        disabled: otherWorktree || Boolean(readOnly),
        icon: <IconGitBranch />,
      });
    }
    local.sort((a, b) => (a.value === currentValue ? -1 : b.value === currentValue ? 1 : 0));
    const worktreeChoices: SearchablePickerItem[] = worktreeItems && worktreeItems.length > 1 ? worktreeItems.map((item) => ({
      value: `${WORKTREE_VALUE_PREFIX}${item.path}`,
      label: item.path.split(/[\\/]/).pop() ?? item.path,
      description: `${item.branch ?? 'Detached HEAD'}${item.locked ? ' · Locked' : item.prunable ? ' · Prunable' : item.bare ? ' · Bare' : ''}`,
      trailing: currentWorktreePath !== undefined && samePath(item.path, currentWorktreePath) ? <span className="searchable-picker-status">Current</span> : undefined,
      search: item.path,
      tooltip: item.path,
      icon: <IconHierarchy2 />,
      disabled: Boolean(item.locked || item.prunable || item.bare),
    })) : [];
    return { currentValue, groups: [
      { id: 'local', label: 'Local', items: local },
      { id: 'worktrees', label: 'Worktrees', items: worktreeChoices },
      { id: 'remote', label: 'Remote', items: remote },
    ] };
  }, [branches, currentWorktreePath, readOnly, worktreeItems]);
  const selectValue = (value: string) => {
    if (!value.startsWith(WORKTREE_VALUE_PREFIX)) { onBranch(value); return; }
    const path = value.slice(WORKTREE_VALUE_PREFIX.length);
    if (worktrees && !samePath(path, worktrees.currentPath)) worktrees.onSelect(path);
  };

  return <SearchablePicker
    groups={groups}
    value={currentValue}
    onValueChange={selectValue}
    label="Select branch"
    triggerLabel={currentLabel}
    icon={crumb ? undefined : <IconGitBranch />}
    triggerIndicator={crumb ? <IconChevronDown className="toolbar-crumb-chevron" /> : undefined}
    triggerClassName={crumb ? 'toolbar-crumb' : 'max-w-[220px]'}
    align={crumb ? 'start' : 'end'}
    placeholder={worktreeItems && worktreeItems.length > 1 ? 'Search branches and worktrees…' : 'Search branches…'}
    management={[
      { label: 'Manage branches…', onClick: onManage },
      ...(worktrees ? [{ label: 'Manage worktrees…', onClick: worktrees.onManage }] : []),
    ]}
    // A repository in the middle of an operation can't change branch, but its other worktrees stay available.
    disabled={disabled || (readOnly && !worktrees)}
  />;
}
