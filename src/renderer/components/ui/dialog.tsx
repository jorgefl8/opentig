import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogPopup({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal
      // Nested FloatingPortals mount inside the parent portal by default, so a
      // confirm from Settings inherits that popup's transform, overflow, and
      // 760px width. Always land on `document.body` instead.
      container={typeof document === "undefined" ? undefined : document.body}
      // Pierre's virtualized diff headers create their own stacking layers.
      // The portal itself must be a positioned top-level layer; putting z-index
      // only on its children let those headers paint over the upper part of a
      // dialog while the rest of the popup remained visible below the diff.
      data-slot="dialog-portal"
      className="fixed inset-0 isolate z-[1000]"
    >
      <DialogPrimitive.Backdrop
        // Nested dialogs omit their backdrop unless forced, which leaves the
        // parent fully visible around the child (a card sitting on Settings).
        forceRender
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-0 bg-black/45 backdrop-blur-[2px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-popup"
        className={cn(
          "fixed top-1/2 left-1/2 z-10 w-[min(760px,92vw)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 origin-center overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl shadow-black/30 duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPopup,
  DialogTitle,
  DialogDescription,
}
