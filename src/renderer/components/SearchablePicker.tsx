import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const [scrolling, setScrolling] = useState(false);
  const triggerCopy = useRef<HTMLSpanElement>(null);
  const [triggerTruncated, setTriggerTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = triggerCopy.current;
    if (!element) return;
    const measure = () => setTriggerTruncated(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [triggerLabel]);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (scrollTimer.current !== null) clearTimeout(scrollTimer.current); }, []);
  const dismissScrollingTooltips = () => {
    setScrolling(true);
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => { scrollTimer.current = null; setScrolling(false); }, 150);
  };
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selected = items.find((item) => item.value === value) ?? null;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = groups.map((group) => ({ ...group, items: group.items.filter((item) =>
    item.pinned || `${group.label} ${item.label} ${item.description ?? ''} ${item.search ?? ''}`.toLocaleLowerCase().includes(needle),
  ) })).filter((group) => group.items.length > 0);
  const changeOpen = (next: boolean) => {
    setInternalOpen(next);
    if (!next) {
      setQuery('');
      setScrolling(false);
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
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
      <Tooltip disabled={!triggerTruncated || (controlledOpen ?? internalOpen) || disabled}>
        <TooltipTrigger id={triggerId} render={<ComboboxTrigger size={size} className={triggerClassName} aria-label={label} aria-keyshortcuts={shortcut} />}>
          {icon}
          <span ref={triggerCopy} className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
          {triggerHint}
        </TooltipTrigger>
        <TooltipContent className="break-all">{triggerLabel}</TooltipContent>
      </Tooltip>
      <ComboboxContent align={align} className={cn('searchable-picker', contentClassName)} initialFocus={focusSearch}>
        <ComboboxInput placeholder={placeholder} aria-label={placeholder} />
        <ComboboxList className="searchable-picker-list" aria-label={label} onScroll={dismissScrollingTooltips} onWheelCapture={dismissScrollingTooltips}>
          {filtered.length === 0 && <div className="searchable-picker-empty" role="status">No matches</div>}
          {filtered.map((group) => (
            <ComboboxGroup key={group.id}>
              {group.label && <ComboboxGroupLabel className="searchable-picker-group">{group.label}</ComboboxGroupLabel>}
              {group.items.map(item => <PickerOption key={item.value} item={item} scrolling={scrolling} />)}
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


function PickerOption({ item, scrolling }: { item: SearchablePickerItem; scrolling: boolean }) {
  const copy = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = copy.current;
    if (!element) return;
    const measure = () => setTruncated([...element.children].some(child => child.scrollWidth > child.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [item.label, item.description]);
  const visibleText = [item.label, item.description].filter(Boolean).join(' · ');
  const extraHint = item.tooltip && item.tooltip !== visibleText && item.tooltip !== item.label && item.tooltip !== item.description;
  return <Tooltip disabled={scrolling || (!truncated && !extraHint)}>
    <TooltipTrigger render={<ComboboxItem value={item} disabled={item.disabled} className={cn('searchable-picker-item', item.description && 'searchable-picker-item-detailed')} />}>
      {item.icon && <span className="searchable-picker-icon">{item.icon}</span>}
      <span ref={copy} className="searchable-picker-copy"><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
      {item.trailing && <span className="searchable-picker-trailing">{item.trailing}</span>}
    </TooltipTrigger>
    <TooltipContent>{extraHint ? item.tooltip : visibleText}</TooltipContent>
  </Tooltip>;
}
