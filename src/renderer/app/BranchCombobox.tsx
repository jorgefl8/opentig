import { useMemo } from 'react';
import { IconChevronDown, IconGitBranch } from '@tabler/icons-react';
import { formatTimeAgo } from '../../shared/date-format';
import type { BranchInfo, WorktreeAgents, WorktreeInfo } from '../../shared/git-types';
import { SearchablePicker, type SearchablePickerItem } from '@/components/SearchablePicker';
import { AgentLabel } from '@/features/refs/AgentLabel';
import { agentsAt, listAgents, samePath } from '@/features/refs/local-refs-model';

export interface BranchComboboxWorktrees {
  items: WorktreeInfo[];
  /** Where coding agents are working, so a branch shows who is on it. */
  agents?: readonly WorktreeAgents[] | undefined;
  onSelect(path: string): void;
  onManage(): void;
}

/**
 * Branch selection. Local branches come in the order someone looks for them: the
 * current one, then the default branch, then the rest by how recently their tip
 * was committed. A branch checked out in another worktree opens that worktree
 * instead of being refused. Managing worktrees stays here only while there is
 * one, because from two on they have their own selector.
 */
export function BranchCombobox({ branches, currentLabel, disabled, readOnly, crumb, worktrees, onBranch, onManage }: {
  branches: BranchInfo[]; currentLabel: string; disabled?: boolean | undefined; readOnly?: boolean | undefined; crumb?: boolean | undefined;
  worktrees?: BranchComboboxWorktrees | undefined; onBranch(name: string | null): void; onManage(): void;
}) {
  const worktreeItems = worktrees?.items;
  const worktreeAgents = worktrees?.agents;
  const { groups, currentValue, openable } = useMemo(() => {
    const local: { item: SearchablePickerItem; rank: number; time: number }[] = [];
    const remote: SearchablePickerItem[] = [];
    const localNames = new Set(branches.filter((branch) => !branch.remote).map((branch) => branch.name));
    // Without a remote HEAD to ask, the conventional names stand in for the default branch.
    const defaultName = localNames.has('main') ? 'main' : localNames.has('master') ? 'master' : null;
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
      const agents = !branch.remote && branch.worktreePath && (branch.current || canOpen) ? agentsAt(worktreeAgents, branch.worktreePath) : [];
      const isDefault = !branch.remote && branch.name === defaultName;
      const state = branch.current ? <span className="searchable-picker-status">Current</span>
        : canOpen ? <span className="searchable-picker-status">Open</span>
          : otherPath ? <span className="searchable-picker-status">In use</span>
            : isDefault ? <span className="searchable-picker-status">Default</span> : undefined;
      const time = branch.date ? Date.parse(branch.date) : Number.NaN;
      const age = Number.isNaN(time) ? null : <time className="searchable-picker-status searchable-picker-age" dateTime={branch.date}>{formatTimeAgo(branch.date)}</time>;
      const item: SearchablePickerItem = {
        value: branch.fullName,
        label: branch.name,
        ...(canOpen ? { description: `In ${folder}` } : {}),
        trailing: agents.length > 0 || state || age ? <>{agents.length > 0 && <AgentLabel agents={agents} compact />}{state}{age}</> : undefined,
        search: branch.fullName,
        tooltip: `${branch.fullName}${otherPath ? ` · In ${otherPath}` : ''}${agents.length > 0 ? ` · ${listAgents(agents)} working there` : ''}`,
        // Opening a worktree changes nothing in this one, so an operation here doesn't stop it.
        disabled: otherPath ? !canOpen : Boolean(readOnly),
        icon: <IconGitBranch />,
      };
      if (branch.remote) remote.push(item);
      else local.push({ item, rank: branch.current ? 0 : isDefault ? 1 : 2, time });
    }
    // A branch whose date Git left out goes last. Equal dates keep Git's alphabetical order.
    local.sort((a, b) => a.rank - b.rank || (Number.isNaN(b.time) ? -Infinity : b.time) - (Number.isNaN(a.time) ? -Infinity : a.time));
    return { currentValue, openable, groups: [
      { id: 'local', label: 'Local', items: local.map((entry) => entry.item) },
      { id: 'remote', label: 'Remote', items: remote },
    ] };
  }, [branches, readOnly, worktreeItems, worktreeAgents]);
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
