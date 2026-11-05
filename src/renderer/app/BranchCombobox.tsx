import { useMemo } from 'react';
import { IconChevronDown, IconGitBranch } from '@tabler/icons-react';
import type { BranchInfo, WorktreeInfo } from '../../shared/git-types';
import { SearchablePicker, type SearchablePickerItem } from '@/components/SearchablePicker';
import { samePath } from '@/features/refs/local-refs-model';

export interface BranchComboboxWorktrees {
  items: WorktreeInfo[];
  onSelect(path: string): void;
  onManage(): void;
}

/**
 * Branch selection. A branch checked out in another worktree opens that worktree
 * instead of being refused. Managing worktrees stays here only while there is
 * one, because from two on they have their own selector.
 */
export function BranchCombobox({ branches, currentLabel, disabled, readOnly, crumb, worktrees, onBranch, onManage }: {
  branches: BranchInfo[]; currentLabel: string; disabled?: boolean | undefined; readOnly?: boolean | undefined; crumb?: boolean | undefined;
  worktrees?: BranchComboboxWorktrees | undefined; onBranch(name: string | null): void; onManage(): void;
}) {
  const worktreeItems = worktrees?.items;
  const { groups, currentValue, openable } = useMemo(() => {
    const local: SearchablePickerItem[] = [];
    const remote: SearchablePickerItem[] = [];
    const openable = new Map<string, string>();
    let currentValue = '';
    for (const branch of branches) {
      if (branch.remote && branch.fullName.endsWith('/HEAD')) continue;
      const otherPath = !branch.remote && !branch.current ? branch.worktreePath : null;
      const other = otherPath ? worktreeItems?.find((item) => samePath(item.path, otherPath)) : undefined;
      // A lock only protects the worktree from removal, so it still opens.
      const canOpen = Boolean(other && !other.prunable && !other.bare);
      const folder = otherPath?.split(/[\\/]/).pop();
      if (other && canOpen) openable.set(branch.fullName, other.path);
      if (!branch.remote && branch.current) currentValue = branch.fullName;
      (branch.remote ? remote : local).push({
        value: branch.fullName,
        label: branch.name,
        ...(canOpen ? { description: `In ${folder}` } : {}),
        trailing: branch.current ? <span className="searchable-picker-status">Current</span>
          : canOpen ? <span className="searchable-picker-status">Open</span>
            : otherPath ? <span className="searchable-picker-status">In use</span> : undefined,
        search: branch.fullName,
        tooltip: `${branch.fullName}${otherPath ? ` · In ${otherPath}` : ''}`,
        // Opening a worktree changes nothing in this one, so an operation here doesn't stop it.
        disabled: otherPath ? !canOpen : Boolean(readOnly),
        icon: <IconGitBranch />,
      });
    }
    local.sort((a, b) => (a.value === currentValue ? -1 : b.value === currentValue ? 1 : 0));
    return { currentValue, openable, groups: [
      { id: 'local', label: 'Local', items: local },
      { id: 'remote', label: 'Remote', items: remote },
    ] };
  }, [branches, readOnly, worktreeItems]);
  const selectValue = (value: string) => {
    const path = openable.get(value);
    if (path && worktrees) worktrees.onSelect(path);
    else onBranch(value);
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
    placeholder="Search branches…"
    management={[
      { label: 'Manage branches…', onClick: onManage },
      ...(worktrees && worktrees.items.length < 2 ? [{ label: 'Manage worktrees…', onClick: worktrees.onManage }] : []),
    ]}
    // A repository in the middle of an operation can't change branch, but its other worktrees stay available.
    disabled={disabled || (readOnly && !worktrees)}
  />;
}
