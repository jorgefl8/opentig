import { useMemo } from 'react';
import { IconGitBranch } from '@tabler/icons-react';
import type { BranchInfo } from '../../shared/git-types';
import { ToolbarPicker, type ToolbarPickerItem } from '@/components/ToolbarPicker';

export function BranchCombobox({ branches, currentLabel, disabled, onBranch, onManage }: {
  branches: BranchInfo[]; currentLabel: string; disabled?: boolean | undefined; onBranch(name: string | null): void; onManage(): void;
}) {
  const { groups, currentValue } = useMemo(() => {
    const local: ToolbarPickerItem[] = [];
    const remote: ToolbarPickerItem[] = [];
    let currentValue = '';
    for (const branch of branches) {
      if (branch.remote && branch.fullName.endsWith('/HEAD')) continue;
      const otherWorktree = Boolean(!branch.remote && branch.worktreePath && !branch.current);
      if (!branch.remote && branch.current) currentValue = branch.fullName;
      (branch.remote ? remote : local).push({
        value: branch.fullName,
        label: branch.name,
        description: branch.remote ? 'Remote branch' : branch.current ? 'Current branch' : otherWorktree ? 'In another worktree' : 'Local branch',
        search: branch.fullName,
        tooltip: branch.fullName,
        disabled: otherWorktree,
        icon: <IconGitBranch />,
      });
    }
    local.sort((a, b) => (a.value === currentValue ? -1 : b.value === currentValue ? 1 : 0));
    return { currentValue, groups: [
      { id: 'local', label: 'Local', items: local },
      { id: 'remote', label: 'Remote', items: remote },
    ] };
  }, [branches]);

  return <ToolbarPicker
    groups={groups}
    value={currentValue}
    onValueChange={onBranch}
    label="Select branch"
    triggerLabel={currentLabel}
    icon={<IconGitBranch />}
    triggerClassName="max-w-[220px]"
    placeholder="Search branches…"
    manageLabel="Manage local branches…"
    onManage={onManage}
    disabled={disabled}
  />;
}
