import { useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown, IconDots } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { MobileSheet } from '@/components/MobileSheet';
import { useMobileChrome } from './mobile-chrome-context';

/** The top bar's title and optional second line. Pressable when it opens something, as a file's open-files sheet. */
export function MobileViewerTitle({ title, subtitle, mono = false, indicator, onPress, pressLabel }: {
  title: ReactNode;
  subtitle?: ReactNode;
  mono?: boolean;
  /** Beside the title, as a dot for other unsaved files. */
  indicator?: ReactNode;
  onPress?(): void;
  pressLabel?: string;
}) {
  const host = useMobileChrome()?.title;
  if (!host) return null;
  const copy = <>
    <strong className={mono ? 'mobile-viewer-mono' : undefined}><span>{title}</span>{onPress && <IconChevronDown aria-hidden="true" />}{indicator}</strong>
    {subtitle && <small>{subtitle}</small>}
  </>;
  return createPortal(onPress
    ? <button type="button" className="mobile-viewer-title" aria-label={pressLabel} aria-haspopup="dialog" onClick={onPress}>{copy}</button>
    : <div className="mobile-viewer-title">{copy}</div>, host);
}

/** The actions for what's on screen, at the end of the top bar. */
export function MobileViewerActions({ children }: { children: ReactNode }) {
  const host = useMobileChrome()?.actions;
  return host ? createPortal(children, host) : null;
}

/** The screen's one floating action above the bottom bar. A note above it says why it can't be pressed. */
export function MobileMainAction({ note, children }: { note?: ReactNode; children: ReactNode }) {
  const host = useMobileChrome()?.float;
  return host ? createPortal(<>{note && <p className="mobile-float-note" role="status">{note}</p>}{children}</>, host) : null;
}

export interface MobileMenuItem {
  label: string;
  icon?: ReactNode;
  disabled?: boolean | undefined;
  danger?: boolean;
  /** Set on a setting: the row becomes a switch and the sheet stays open to show the change. */
  checked?: boolean;
  onSelect(): void;
}

/** A row with a switch at its end, for a yes or no inside a sheet. */
export function MobileSwitchRow({ label, detail, icon, checked, disabled, onChange }: {
  label: string;
  detail?: ReactNode;
  icon?: ReactNode;
  checked: boolean;
  disabled?: boolean | undefined;
  onChange(next: boolean): void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="mobile-sheet-action" onClick={() => onChange(!checked)}>
      {icon}
      <span>{detail ? <><strong>{label}</strong><small>{detail}</small></> : label}</span>
      <i className="mobile-switch" aria-hidden="true" />
    </button>
  );
}

/**
 * Reaches a phone row's long-press sheet another way: from the keyboard, where it
 * shows once focused, and from a screen reader. Touch never lands on it.
 */
export function MobileRowSheetButton({ name, onPress }: { name: string; onPress(): void }) {
  return <button type="button" className="mobile-row-more" aria-label={`More actions for ${name}`} aria-haspopup="dialog" onClick={onPress}><IconDots aria-hidden="true" /></button>;
}

/** The `⋯` in the top bar and the sheet it opens. Dangerous items come last, under a line. */
export function MobileActionsMenu({ label, title, items, disabled, triggerRef, triggerClassName }: {
  label: string;
  title: string;
  items: MobileMenuItem[];
  disabled?: boolean | undefined;
  triggerRef?: Ref<HTMLButtonElement>;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ordered = [...items.filter((item) => !item.danger), ...items.filter((item) => item.danger)];
  return <>
    <Button ref={triggerRef} variant="ghost" size="icon" className={`mobile-bar-button${triggerClassName ? ` ${triggerClassName}` : ''}`} aria-label={label} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)}><IconDots /></Button>
    <MobileSheet open={open} onOpenChange={setOpen} title={title}>
      {ordered.map((item) => item.checked === undefined
        ? <button key={item.label} type="button" className={`mobile-sheet-action${item.danger ? ' destructive' : ''}`} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>{item.icon}<span>{item.label}</span></button>
        : <MobileSwitchRow key={item.label} label={item.label} icon={item.icon} checked={item.checked} disabled={item.disabled} onChange={() => item.onSelect()} />)}
    </MobileSheet>
  </>;
}
