import { useMemo, useState } from 'react';
import { IconChevronDown, IconGitBranch, IconSettings } from '@tabler/icons-react';
import type { BranchInfo } from '../../shared/git-types';
import { Combobox, ComboboxContent, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';

interface BranchItem { value: string; label: string; search: string; disabled: boolean; hint?: string | undefined }
const BRANCH_GROUP_LIMIT = 5;

export function BranchCombobox({ branches, currentLabel, disabled, onBranch, onManage }: {
  branches: BranchInfo[]; currentLabel: string; disabled?: boolean | undefined; onBranch(name: string | null): void; onManage(): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState({ local: BRANCH_GROUP_LIMIT, remote: BRANCH_GROUP_LIMIT });
  const resetView = () => setVisible({ local: BRANCH_GROUP_LIMIT, remote: BRANCH_GROUP_LIMIT });

  const { items, locals, remotes, currentValue } = useMemo(() => {
    const locals: BranchItem[] = [];
    const remotes: BranchItem[] = [];
    let currentValue = '';
    for (const branch of branches) {
      if (branch.remote) {
        if (branch.fullName.endsWith('/HEAD')) continue;
        remotes.push({ value: branch.fullName, label: branch.name, search: (branch.name + " " + branch.fullName).toLowerCase(), disabled: false });
      } else {
        if (branch.current) currentValue = branch.fullName;
        const otherWorktree = Boolean(branch.worktreePath && !branch.current);
        locals.push({ value: branch.fullName, label: branch.name, search: (branch.name + " " + branch.fullName).toLowerCase(), disabled: otherWorktree, hint: otherWorktree ? 'another worktree' : undefined });
      }
    }
    locals.sort((a, b) => (a.value === currentValue ? -1 : b.value === currentValue ? 1 : 0));
    return { items: [...locals, ...remotes], locals, remotes, currentValue };
  }, [branches]);

  const capGroup = (list: BranchItem[], count: number) => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? list.filter((item) => item.label.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle))
      : list;
    return { shown: matched.slice(0, count), hidden: Math.max(0, matched.length - count) };
  };

  const localView = capGroup(locals, visible.local);
  const remoteView = capGroup(remotes, visible.remote);
  const noResults = localView.shown.length === 0 && remoteView.shown.length === 0;
  const selectedItem = items.find((item) => item.value === currentValue) ?? null;

  return (
    <Combobox
      items={items}
      value={selectedItem}
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) { setQuery(''); resetView(); } }}
      inputValue={query}
      onInputValueChange={(value) => { setQuery(value); resetView(); }}
      filter={null}
      disabled={disabled}
      itemToStringLabel={(item: BranchItem | null) => item?.label ?? ''}
      itemToStringValue={(item: BranchItem | null) => item?.value ?? ''}
      isItemEqualToValue={(a: BranchItem | null, b: BranchItem | null) => a?.value === b?.value}
      onValueChange={(item: BranchItem | null) => { if (item && item.value !== currentValue) onBranch(item.value); }}
    >
      <ComboboxTrigger size="sm" className="max-w-[220px]">
        <IconGitBranch />
        <span className="block min-w-0 flex-1 overflow-hidden text-left text-ellipsis whitespace-nowrap">{currentLabel}</span>
      </ComboboxTrigger>
      <ComboboxContent align="end" className="w-[min(300px,calc(100vw-24px))] max-w-[calc(100vw-24px)]">
        <ComboboxInput placeholder="Search branches…" />
        {noResults ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</div>
        ) : (
          <ComboboxList>
            {localView.shown.length > 0 && (
              <ComboboxGroup>
                <ComboboxGroupLabel>Local</ComboboxGroupLabel>
                {localView.shown.map((item) => (
                  <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.hint && <small className="shrink-0 text-muted-foreground">· {item.hint}</small>}
                  </ComboboxItem>
                ))}
                {localView.hidden > 0 && <BranchMoreRow count={localView.hidden} onClick={() => setVisible((v) => ({ ...v, local: v.local + BRANCH_GROUP_LIMIT }))} />}
              </ComboboxGroup>
            )}
            {remoteView.shown.length > 0 && (
              <ComboboxGroup>
                <ComboboxGroupLabel>Remote</ComboboxGroupLabel>
                {remoteView.shown.map((item) => (
                  <ComboboxItem key={item.value} value={item}>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </ComboboxItem>
                ))}
                {remoteView.hidden > 0 && <BranchMoreRow count={remoteView.hidden} onClick={() => setVisible((v) => ({ ...v, remote: v.remote + BRANCH_GROUP_LIMIT }))} />}
              </ComboboxGroup>
            )}
          </ComboboxList>
        )}
        <button
          type="button"
          className="branch-combobox-manage"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { setOpen(false); onManage(); }}
        >
          <IconSettings /> Manage local branches…
        </button>
      </ComboboxContent>
    </Combobox>
  );
}

function BranchMoreRow({ count, onClick }: { count: number; onClick(): void }) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <IconChevronDown className="size-3.5" /> Show {count} more {count === 1 ? 'branch' : 'branches'}
    </button>
  );
}
