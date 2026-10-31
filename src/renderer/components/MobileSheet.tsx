import type { ReactNode } from 'react';
import { Drawer } from '@base-ui/react/drawer';

/**
 * Shared accessible sheets for phone context, file actions and destinations.
 * They close by dragging them down, Escape or a press outside. On touch the
 * drag starts anywhere; a mouse drags above the content, so text stays selectable.
 */
export function MobileSheet({ open, onOpenChange, title, description, children }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      {/* Same top-level layer as dialogs: Pierre's diff headers create their own stacking layers. */}
      <Drawer.Portal container={typeof document === 'undefined' ? undefined : document.body} className="mobile-sheet-layer">
        <Drawer.Backdrop className="mobile-sheet-backdrop" />
        <Drawer.Viewport className="mobile-sheet-viewport">
          <Drawer.Popup className="mobile-sheet">
            <div className="mobile-sheet-handle">
              {/* There is no visible X, but keyboards and screen readers still need a way out. */}
              <Drawer.Close className="mobile-sheet-close" aria-label={`Close ${title}`} />
            </div>
            <Drawer.Title className="mobile-sheet-title">{title}</Drawer.Title>
            {description && <Drawer.Description className="mobile-sheet-description">{description}</Drawer.Description>}
            <Drawer.Content className="mobile-sheet-body">{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
