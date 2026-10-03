import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';
import { IconChevronDown } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return <AccordionPrimitive.Root data-slot="accordion" className={cn('w-full overflow-hidden rounded-xl border border-border', className)} {...props} />;
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn('not-last:border-b', className)} {...props} />;
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      data-slot="accordion-trigger"
      className={cn('group flex flex-1 items-center justify-between gap-4 rounded-lg p-4 text-left text-xs font-semibold outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-50', className)}
      {...props}
    >
      {children}
      <IconChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>;
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return <AccordionPrimitive.Panel data-slot="accordion-content" className="accordion-content" {...props}>
    <div className={cn('px-4 pb-4', className)}>{children}</div>
  </AccordionPrimitive.Panel>;
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
