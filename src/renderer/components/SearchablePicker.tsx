import { useMemo, useState, type ReactNode } from 'react';
import { IconSettings } from '@tabler/icons-react';
import { Combobox, ComboboxContent, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface SearchablePickerItem {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  tooltip?: string;
  search?: string;
  disabled?: boolean;
  pinned?: boolean;
}

export interface SearchablePickerGroup {
  id: string;
  label: string;
  items: SearchablePickerItem[];
}

interface SearchablePickerProps {
  groups: SearchablePickerGroup[];
  value: string;
  onValueChange(value: string): void;
  label: string;
  triggerLabel: string;
  icon?: ReactNode;
  triggerId?: string;
  size?: 'sm' | 'default';
  triggerHint?: ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  shortcut?: string;
  placeholder: string;
  management?: { label: string; onClick(): void };
  disabled?: boolean | undefined;
  align?: 'start' | 'end';
  open?: boolean;
  onOpenChange?(open: boolean): void;
  focusSearch?: boolean;
  onSearchChange?(): void;
}

/** Compact selection for toolbars and forms; optional management stays outside the listbox. */
export function SearchablePicker({ groups, value, onValueChange, label, triggerLabel, icon, triggerHint,
  triggerId, size = 'sm', triggerClassName, contentClassName, shortcut, placeholder, management, disabled, align = 'end',
  open: controlledOpen, onOpenChange, focusSearch = true, onSearchChange,
}: SearchablePickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selected = items.find((item) => item.value === value) ?? null;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = groups.map((group) => ({ ...group, items: group.items.filter((item) =>
    item.pinned || `${group.label} ${item.label} ${item.description ?? ''} ${item.search ?? ''}`.toLocaleLowerCase().includes(needle),
  ) })).filter((group) => group.items.length > 0);
  const changeOpen = (next: boolean) => {
    setInternalOpen(next);
    if (!next) setQuery('');
    onOpenChange?.(next);
  };

  return (
    <Combobox
      items={items}
      filteredItems={filtered.flatMap((group) => group.items)}
      value={selected}
      open={controlledOpen ?? internalOpen}
      onOpenChange={changeOpen}
      inputValue={query}
      onInputValueChange={(next) => { setQuery(next); onSearchChange?.(); }}
      filter={null}
      disabled={disabled}
      itemToStringLabel={(item: SearchablePickerItem | null) => item?.label ?? ''}
      itemToStringValue={(item: SearchablePickerItem | null) => item?.value ?? ''}
      isItemEqualToValue={(a: SearchablePickerItem | null, b: SearchablePickerItem | null) => a?.value === b?.value}
      onValueChange={(item: SearchablePickerItem | null) => {
        if (!item || item.disabled) return;
        changeOpen(false);
        if (item.value !== value) onValueChange(item.value);
      }}
    >
      <ComboboxTrigger id={triggerId} size={size} className={triggerClassName} aria-label={label} aria-keyshortcuts={shortcut}>
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        {triggerHint}
      </ComboboxTrigger>
      <ComboboxContent align={align} className={cn('searchable-picker', contentClassName)} initialFocus={focusSearch}>
        <ComboboxInput placeholder={placeholder} aria-label={placeholder} />
        <ComboboxList className="searchable-picker-list" aria-label={label}>
          {filtered.length === 0 && <div className="searchable-picker-empty" role="status">No matches</div>}
          {filtered.map((group) => (
            <ComboboxGroup key={group.id}>
              {group.label && <ComboboxGroupLabel className="searchable-picker-group">{group.label}</ComboboxGroupLabel>}
              {group.items.map((item) => {
                const content = <>
                  {item.icon && <span className="searchable-picker-icon">{item.icon}</span>}
                  <span className="searchable-picker-copy"><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
                  {item.trailing && <span className="searchable-picker-trailing">{item.trailing}</span>}
                </>;
                return (
                  <Tooltip key={item.value}>
                    <TooltipTrigger render={<ComboboxItem value={item} disabled={item.disabled} className={cn('searchable-picker-item', item.description && 'searchable-picker-item-detailed')} />}>
                      {content}
                    </TooltipTrigger>
                    <TooltipContent>{item.tooltip ?? [item.label, item.description].filter(Boolean).join(' · ')}</TooltipContent>
                  </Tooltip>
                );
              })}
            </ComboboxGroup>
          ))}
        </ComboboxList>
        {management && <div className="searchable-picker-footer">
          <button type="button" onClick={() => { changeOpen(false); management.onClick(); }}>
            <IconSettings /> {management.label}
          </button>
        </div>}
      </ComboboxContent>
    </Combobox>
  );
}
