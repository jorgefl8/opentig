import type { ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Button } from '@/components/ui/button';

/**
 * A question beside the button that asked it, rendered only while it's being asked. It stays until
 * it's answered, nothing else can be pressed meanwhile, and closing it returns focus to that button.
 * While an answer is being sent it can't be dismissed.
 */
export function ConfirmPopover({ anchor, label, busy, confirm, onCancel, children }: {
  /** The button that opened it. */
  anchor: HTMLElement;
  label: string;
  busy: boolean;
  /** The confirming button. */
  confirm: ReactNode;
  onCancel(): void;
  children: ReactNode;
}) {
  return (
    <Popover.Root open modal onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="end" sideOffset={6} collisionPadding={12} className="isolate z-50 outline-none">
          <Popover.Popup className="confirm-popover" aria-label={label} finalFocus={() => anchor}>
            {children}
            <div className="confirm-popover-actions">
              <Popover.Close render={<Button variant="ghost" size="xs" disabled={busy} />}>Cancel</Popover.Close>
              {confirm}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
