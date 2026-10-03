import type { ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** Shared accessible sheets for phone context, file actions and destinations. */
export function MobileSheet({ open, onOpenChange, title, description, children }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="mobile-sheet">
        <div className="mobile-sheet-handle" aria-hidden="true" />
        <div className="mobile-sheet-heading">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose render={<Button variant="ghost" size="icon" aria-label={`Close ${title}`} />}><IconX /></DialogClose>
        </div>
        {description && <DialogDescription className="mobile-sheet-description">{description}</DialogDescription>}
        <div className="mobile-sheet-body">{children}</div>
      </DialogPopup>
    </Dialog>
  );
}
