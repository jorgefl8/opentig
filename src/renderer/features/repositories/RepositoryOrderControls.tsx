import { type ReactNode } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconArrowDown, IconArrowUp, IconGripVertical } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function RepositoryOrderList({ items, onMove, children }: {
  items: { id: string; label: string }[];
  onMove(id: string, toIndex: number): void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const label = (id: string | number) => items.find((item) => item.id === id)?.label ?? 'Item';
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ announcements: {
      onDragStart: ({ active }) => `Picked up ${label(active.id)}.`,
      onDragOver: ({ active, over }) => over ? `${label(active.id)} at position ${items.findIndex((item) => item.id === over.id) + 1}.` : undefined,
      onDragEnd: ({ active, over }) => over ? `Placed ${label(active.id)} at position ${items.findIndex((item) => item.id === over.id) + 1}.` : 'Reordering cancelled.',
      onDragCancel: () => 'Reordering cancelled.',
    } }}
    onDragEnd={({ active, over }) => {
      if (!over || active.id === over.id) return;
      const index = items.findIndex((item) => item.id === over.id);
      if (index >= 0) onMove(String(active.id), index);
    }}>
    <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>;
}

export function RepositoryOrderRow({ id, label, className, disabled, busy, children }: {
  id: string; label: string; className: string; disabled: boolean; busy?: boolean | undefined; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return <div ref={setNodeRef} className={className} aria-busy={busy || undefined} data-dragging={isDragging || undefined}
    style={{ transform: CSS.Transform.toString(transform), transition }}>
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="repository-order-handle" ref={setActivatorNodeRef}
        {...attributes} {...listeners} aria-label={`Reorder ${label}`} disabled={disabled} />}><IconGripVertical /></TooltipTrigger>
      <TooltipContent>Drag to reorder · Space and arrow keys also work</TooltipContent>
    </Tooltip>
    {children}
  </div>;
}

export function RepositoryOrderButtons({ label, index, count, disabled, onMove }: {
  label: string; index: number; count: number; disabled: boolean; onMove(toIndex: number): void;
}) {
  return <span className="repository-order-buttons">
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(index - 1)} />}><IconArrowUp /></TooltipTrigger><TooltipContent>Move up</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Move ${label} down`} disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)} />}><IconArrowDown /></TooltipTrigger><TooltipContent>Move down</TooltipContent></Tooltip>
  </span>;
}
