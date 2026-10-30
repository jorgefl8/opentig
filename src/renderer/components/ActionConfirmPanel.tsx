import { useEffect, type ReactNode } from 'react';
import { IconAlertTriangle, IconHelpCircle } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

interface ActionConfirmPanelProps {
  /** `danger` for what can't be undone, `warning` for what rewrites something, `neutral` for the rest. */
  tone?: 'danger' | 'warning' | 'neutral';
  busy?: boolean;
  /** The confirming button. */
  confirm: ReactNode;
  onCancel(): void;
  /** The question, as paragraphs, and any option to choose before confirming. */
  children: ReactNode;
}

/** A two-step confirmation in place. No timer: the question stays until it's answered, and Escape declines it. */
export function ActionConfirmPanel({ tone = 'danger', busy = false, confirm, onCancel, children }: ActionConfirmPanelProps) {
  useEffect(() => {
    if (busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // An open list inside the question, such as the merge method, closes first.
      if (event.target instanceof Element && event.target.closest('[role="listbox"], [role="menu"]')) return;
      // Only this question closes, not a dialog or menu around it.
      event.stopPropagation();
      event.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [busy, onCancel]);
  const Icon = tone === 'neutral' ? IconHelpCircle : IconAlertTriangle;
  return (
    <div className={`local-refs-confirm ${tone}`} role="alert">
      <Icon aria-hidden="true" />
      {children}
      <span className="local-refs-confirm-actions">
        {confirm}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
      </span>
    </div>
  );
}
