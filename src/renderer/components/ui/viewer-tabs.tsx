import { Tabs } from '@base-ui/react/tabs';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';
import './viewer-tabs.css';

interface ViewerTabsProps<Value extends string> extends Omit<ComponentProps<typeof Tabs.Root>, 'value' | 'onValueChange'> {
  value: Value;
  onValueChange(value: Value): void;
}

interface ViewerTabItem<Value extends string> {
  value: Value;
  label: ReactNode;
}

interface ViewerTabsListProps<Value extends string> extends Omit<ComponentProps<typeof Tabs.List>, 'children'> {
  label: string;
  items: readonly ViewerTabItem<Value>[];
}

export function ViewerTabs<Value extends string>({ value, onValueChange, ...props }: ViewerTabsProps<Value>) {
  return <Tabs.Root value={value} onValueChange={(nextValue) => onValueChange(nextValue as Value)} {...props} />;
}

export function ViewerTabsList<Value extends string>({ label, items, className, ...props }: ViewerTabsListProps<Value>) {
  return (
    <Tabs.List aria-label={label} activateOnFocus className={cn('viewer-tabs-list', className)} {...props}>
      <Tabs.Indicator className="viewer-tabs-indicator" />
      {items.map((item) => <Tabs.Tab key={item.value} value={item.value}>{item.label}</Tabs.Tab>)}
    </Tabs.List>
  );
}

export function ViewerTabsPanel({ ref, ...props }: ComponentProps<typeof Tabs.Panel> & { ref?: Ref<HTMLDivElement> }) {
  return <Tabs.Panel ref={ref} {...props} />;
}
