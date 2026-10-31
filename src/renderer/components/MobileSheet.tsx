import type { ReactNode, Ref } from 'react';
import { Drawer } from '@base-ui/react/drawer';

/**
 * Shared accessible sheets for phone context, file actions and destinations.
 * They close by dragging them down, Escape or a press outside. On touch the
 * drag starts anywhere; a mouse drags above the content, so text stays selectable.
 */
export function MobileSheet({ open, onOpenChange, onClosed, title, leading, description, tall = false, locked = false, finalFocus, bodyRef, children }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** After the closing animation, for a sheet that's only rendered while it's asking something. */
  onClosed?(): void;
  title: string;
  /** Before the title, as the way back from a section. */
  leading?: ReactNode;
  description?: ReactNode;
  /** Takes the whole height, for content that scrolls or changes size. */
  tall?: boolean;
  /** Won't follow a drag, while an answer is being sent. */
  locked?: boolean;
  /** Where focus returns when it closes. */
  finalFocus?: (() => HTMLElement | null);
  bodyRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} onOpenChangeComplete={(next) => { if (!next) onClosed?.(); }}>
      {/* Same top-level layer as dialogs: Pierre's diff headers create their own stacking layers. */}
      <Drawer.Portal container={typeof document === 'undefined' ? undefined : document.body} className="mobile-sheet-layer">
        <Drawer.Backdrop className="mobile-sheet-backdrop" />
        <Drawer.Viewport className="mobile-sheet-viewport">
          <Drawer.Popup className={`mobile-sheet${tall ? ' tall' : ''}`} finalFocus={finalFocus} {...(locked ? { 'data-base-ui-swipe-ignore': '' } : {})}>
            <div className="mobile-sheet-handle">
              {/* There is no visible X, but keyboards and screen readers still need a way out. */}
              <Drawer.Close className="mobile-sheet-close" aria-label={`Close ${title}`} />
            </div>
            <div className={`mobile-sheet-heading${leading ? ' has-leading' : ''}`}>
              {leading}
              <Drawer.Title className="mobile-sheet-title">{title}</Drawer.Title>
            </div>
            {description && <Drawer.Description className="mobile-sheet-description">{description}</Drawer.Description>}
            <Drawer.Content ref={bodyRef} className="mobile-sheet-body">{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
