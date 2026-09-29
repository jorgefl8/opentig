import { useMemo, useState, type ReactNode } from 'react';
import { IconSettings } from '@tabler/icons-react';
import { Combobox, ComboboxContent, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface ToolbarPickerItem {
  value: string;
  label: string;
  description: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  tooltip?: string;
  search?: string;
  disabled?: boolean;
}

export interface ToolbarPickerGroup {
  id: string;
  label: string;
  items: ToolbarPickerItem[];
}

interface ToolbarPickerProps {
  groups: ToolbarPickerGroup[];
  value: string;
  onValueChange(value: string): void;
  label: string;
  triggerLabel: string;
  icon: ReactNode;
  triggerHint?: ReactNode;
  triggerClassName?: string;
  shortcut?: string;
  placeholder: string;
  manageLabel: string;
  onManage(): void;
  disabled?: boolean | undefined;
  align?: 'start' | 'end';
  open?: boolean;
  onOpenChange?(open: boolean): void;
  focusSearch?: boolean;
  onSearchChange?(): void;
}

/** Shared searchable toolbar selection; management is an action outside the listbox. */
export function ToolbarPicker({ groups, value, onValueChange, label, triggerLabel, icon, triggerHint,
  triggerClassName, shortcut, placeholder, manageLabel, onManage, disabled, align = 'end',
  open: controlledOpen, onOpenChange, focusSearch = true, onSearchChange,
}: ToolbarPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selected = items.find((item) => item.value === value) ?? null;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = groups.map((group) => ({ ...group, items: group.items.filter((item) =>
    `${group.label} ${item.label} ${item.description} ${item.search ?? ''}`.toLocaleLowerCase().includes(needle),
  ) })).filter((group) => group.items.length > 0);
  const changeOpen = (next: boolean) => {
    setInternalOpen(next);
    if (!next) setQuery('');
    onOpenChange?.(next);
  };

  return (
    <Combobox
      items={items}
      value={selected}
      open={controlledOpen ?? internalOpen}
      onOpenChange={changeOpen}
      inputValue={query}
      onInputValueChange={(next) => { setQuery(next); onSearchChange?.(); }}
      filter={null}
      disabled={disabled}
      itemToStringLabel={(item: ToolbarPickerItem | null) => item?.label ?? ''}
      itemToStringValue={(item: ToolbarPickerItem | null) => item?.value ?? ''}
      isItemEqualToValue={(a: ToolbarPickerItem | null, b: ToolbarPickerItem | null) => a?.value === b?.value}
      onValueChange={(item: ToolbarPickerItem | null) => {
        if (!item || item.disabled) return;
        changeOpen(false);
        if (item.value !== value) onValueChange(item.value);
      }}
    >
      <ComboboxTrigger size="sm" className={triggerClassName} aria-label={label} aria-keyshortcuts={shortcut}>
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        {triggerHint}
      </ComboboxTrigger>
      <ComboboxContent align={align} className="toolbar-picker" initialFocus={focusSearch}>
        <ComboboxInput placeholder={placeholder} aria-label={placeholder} />
        <ComboboxList className="toolbar-picker-list" aria-label={label}>
          {filtered.length === 0 && <div className="toolbar-picker-empty" role="status">No matches</div>}
          {filtered.map((group) => (
            <ComboboxGroup key={group.id}>
              <ComboboxGroupLabel className="toolbar-picker-group">{group.label}</ComboboxGroupLabel>
              {group.items.map((item) => {
                const content = <>
                  <span className="toolbar-picker-icon">{item.icon}</span>
                  <span className="toolbar-picker-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                  {item.trailing && <span className="toolbar-picker-trailing">{item.trailing}</span>}
                </>;
                return (
                  <Tooltip key={item.value}>
                    <TooltipTrigger render={<ComboboxItem value={item} disabled={item.disabled} className="toolbar-picker-item" />}>
                      {content}
                    </TooltipTrigger>
                    <TooltipContent>{item.tooltip ?? `${item.label} · ${item.description}`}</TooltipContent>
                  </Tooltip>
                );
              })}
            </ComboboxGroup>
          ))}
        </ComboboxList>
        <div className="toolbar-picker-footer">
          <button type="button" onClick={() => { changeOpen(false); onManage(); }}>
            <IconSettings /> {manageLabel}
          </button>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}
