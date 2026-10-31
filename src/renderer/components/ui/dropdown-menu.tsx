import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { IconCheck } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

const ITEM_CLASS = 'flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-xs outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-45 md:min-h-8 [&_svg]:size-3.5 [&_svg]:shrink-0';

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;

function DropdownMenuContent({ className, children, align = 'end', sideOffset = 4, ...props }:
  MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'sideOffset'>) {
  return <MenuPrimitive.Portal>
    <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="isolate z-50 outline-none">
      <MenuPrimitive.Popup data-slot="dropdown-menu-content" className={cn(
        'min-w-44 origin-(--transform-origin) rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )} {...props}>{children}</MenuPrimitive.Popup>
    </MenuPrimitive.Positioner>
  </MenuPrimitive.Portal>;
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return <MenuPrimitive.Item data-slot="dropdown-menu-item" className={cn(ITEM_CLASS, className)} {...props} />;
}

/** An option that stays open when toggled and shows a check at the end while on. */
function DropdownMenuCheckboxItem({ className, children, ...props }: MenuPrimitive.CheckboxItem.Props) {
  return <MenuPrimitive.CheckboxItem data-slot="dropdown-menu-checkbox-item" className={cn(ITEM_CLASS, 'justify-between', className)} {...props}>
    {children}
    <MenuPrimitive.CheckboxItemIndicator className="flex text-muted-foreground"><IconCheck /></MenuPrimitive.CheckboxItemIndicator>
  </MenuPrimitive.CheckboxItem>;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem };
