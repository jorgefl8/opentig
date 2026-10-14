import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
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
  const comboboxId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrolling, setScrolling] = useState(false);
  const [highlight, setHighlight] = useState({ index: -1, scroll: false });
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
  const filtered = useMemo(() => groups.map((group) => ({ ...group, items: group.items.filter((item) =>
    item.pinned || `${group.label} ${item.label} ${item.description ?? ''} ${item.search ?? ''}`.toLocaleLowerCase().includes(needle),
  ) })).filter((group) => group.items.length > 0), [groups, needle]);
  const filteredItems = useMemo(() => filtered.flatMap(group => group.items), [filtered]);
  // Small menus keep their ordinary layout; large menus mount only a viewport and overscan.
  const virtualized = filteredItems.length >= 100;
  const changeOpen = (next: boolean) => {
    setInternalOpen(next);
    if (!next) {
      setQuery('');
      setHighlight({ index: -1, scroll: false });
      setScrolling(false);
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
    onOpenChange?.(next);
  };

  return (
    <Combobox
      id={comboboxId}
      items={items}
      filteredItems={filteredItems}
      virtualized={virtualized}
      onItemHighlighted={(_item, details) => setHighlight({ index: details.index, scroll: details.reason !== 'pointer' })}
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
        {virtualized ? <VirtualPickerList groups={filtered} selectedIndex={selected ? filteredItems.indexOf(selected) : -1} highlight={highlight} scrolling={scrolling} label={label} comboboxId={comboboxId} onScroll={dismissScrollingTooltips} /> : <ComboboxList className="searchable-picker-list" aria-label={label} onScroll={dismissScrollingTooltips} onWheelCapture={dismissScrollingTooltips}>
          {filtered.length === 0 && <div className="searchable-picker-empty" role="status">No matches</div>}
          {filtered.map((group) => (
            <ComboboxGroup key={group.id}>
              {group.label && <ComboboxGroupLabel className="searchable-picker-group">{group.label}</ComboboxGroupLabel>}
              {group.items.map(item => {
                const index = filteredItems.indexOf(item);
                return <PickerOption key={item.value} item={item} scrolling={scrolling} index={index} id={`${comboboxId}-${index}`} />;
              })}
            </ComboboxGroup>
          ))}
        </ComboboxList>}
        {management && <div className="searchable-picker-footer">
          <button type="button" onClick={() => { changeOpen(false); management.onClick(); }}>
            <IconSettings /> {management.label}
          </button>
        </div>}
      </ComboboxContent>
    </Combobox>
  );
}

function VirtualPickerList({ groups, selectedIndex, highlight, scrolling, label, comboboxId, onScroll }: {
  groups: SearchablePickerGroup[];
  selectedIndex: number;
  highlight: { index: number; scroll: boolean };
  scrolling: boolean;
  label: string;
  comboboxId: string;
  onScroll(): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => groups.flatMap(group => group.items.map((item, index) => ({ group, item, first: index === 0 }))), [groups]);
  const activeIndex = highlight.index >= 0 && highlight.index < rows.length ? highlight.index : selectedIndex;
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => list.current,
    getItemKey: index => rows[index]!.item.value,
    // Measurements replace these estimates, including larger phone targets and custom fonts.
    estimateSize: index => (rows[index]!.item.description ? 42 : 32) + (rows[index]!.first ? (rows[index]!.group.label ? 23 : 0) : 2),
    overscan: 4,
    initialRect: { width: 340, height: 292 },
    rangeExtractor: range => {
      const indexes = defaultRangeExtractor(range);
      // Keep the active descendant mounted even when the user scrolls away from it.
      if (activeIndex >= 0 && activeIndex < rows.length && !indexes.includes(activeIndex)) indexes.push(activeIndex);
      return indexes.sort((a, b) => a - b);
    },
  });
  // A new filtered collection starts at the top; the next highlight can scroll to its own row.
  useLayoutEffect(() => { virtualizer.scrollToOffset(0); }, [rows, virtualizer]);
  useLayoutEffect(() => {
    if (activeIndex >= 0 && (highlight.scroll || highlight.index < 0)) virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, highlight, rows, virtualizer]);
  const visibleGroups = new Map<string, ReturnType<typeof virtualizer.getVirtualItems>>();
  for (const row of virtualizer.getVirtualItems()) {
    const id = rows[row.index]!.group.id;
    const groupRows = visibleGroups.get(id) ?? [];
    groupRows.push(row);
    visibleGroups.set(id, groupRows);
  }
  return <ComboboxList ref={list} className="searchable-picker-list" aria-label={label} onScroll={onScroll} onWheelCapture={onScroll}>
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {[...visibleGroups].map(([id, groupRows]) => {
        const first = groupRows[0]!;
        const group = rows[first.index]!.group;
        return <ComboboxGroup key={id} style={{ position: 'absolute', top: first.start, width: '100%', height: groupRows.at(-1)!.end - first.start }}>
          {group.label && !rows[first.index]!.first && <ComboboxGroupLabel className="sr-only">{group.label}</ComboboxGroupLabel>}
          {groupRows.map(row => {
            const entry = rows[row.index]!;
            return <div key={row.key} data-index={row.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: row.start - first.start, width: '100%', paddingTop: entry.first ? 0 : 2 }}>
              {entry.first && group.label && <ComboboxGroupLabel className="searchable-picker-group">{group.label}</ComboboxGroupLabel>}
              <PickerOption item={entry.item} scrolling={scrolling} index={row.index} id={`${comboboxId}-${row.index}`} setSize={rows.length} />
            </div>;
          })}
        </ComboboxGroup>;
      })}
    </div>
  </ComboboxList>;
}

function PickerOption({ item, scrolling, index, id, setSize }: { item: SearchablePickerItem; scrolling: boolean; index: number; id: string; setSize?: number }) {
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
  // TooltipTrigger also supplies an ID; it must agree with the combobox's active descendant.
  return <Tooltip disabled={scrolling || (!truncated && !extraHint)}>
    <TooltipTrigger id={id} render={<ComboboxItem value={item} index={index} aria-posinset={setSize === undefined ? undefined : index + 1} aria-setsize={setSize} disabled={item.disabled} className={cn('searchable-picker-item', item.description && 'searchable-picker-item-detailed')} />}>
      {item.icon && <span className="searchable-picker-icon">{item.icon}</span>}
      <span ref={copy} className="searchable-picker-copy"><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
      {item.trailing && <span className="searchable-picker-trailing">{item.trailing}</span>}
    </TooltipTrigger>
    <TooltipContent>{extraHint ? item.tooltip : visibleText}</TooltipContent>
  </Tooltip>;
}
