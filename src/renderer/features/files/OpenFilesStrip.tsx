import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { IconX } from '@tabler/icons-react';
import { closestCenter, DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { OPEN_FILES_DROP_HOST_ID } from './file-tree';
import { edgeFades, type FileSession, horizontalWheelDelta, type RuntimeTab, tabLabels } from './open-files-model';

const TAB_MOTION = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const;

interface OpenFilesStripProps {
  session: FileSession;
  onActivate(path: string): void;
  onPin(path: string): void;
  onClose(path: string): void;
  onReorder(path: string, toIndex: number): void;
}

/**
 * Presentational strip of open working-tree files. It owns no drafts and loads
 * no files; every calculation comes from the pure helpers in
 * `open-files-model.ts` so the behaviour is testable without a DOM.
 */
export function OpenFilesStrip({ session, onActivate, onPin, onClose, onReorder }: OpenFilesStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [fades, setFades] = useState({ start: false, end: false });
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const labels = useMemo(() => tabLabels(session.tabs), [session.tabs]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const draggingTab = draggingPath ? session.tabs.find((tab) => tab.path === draggingPath) ?? null : null;

  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const next = edgeFades({ scrollLeft: strip.scrollLeft, clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth });
    setFades((current) => (current.start === next.start && current.end === next.end ? current : next));
  }, []);

  useLayoutEffect(measure, [measure, session.tabs]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!session.activePath) return;
    tabRefs.current.get(session.activePath)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [session.activePath]);

  // The toolbar is a window drag region and the scrollbar is hidden, so vertical
  // wheel movement is translated by hand while the strip actually overflows.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      const delta = horizontalWheelDelta(
        { scrollLeft: strip.scrollLeft, clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth },
        event.deltaX,
        event.deltaY,
      );
      if (delta === null) return;
      event.preventDefault();
      strip.scrollLeft += delta;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (session.tabs.length === 0) return null;

  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDraggingPath(null);
    if (!over || active.id === over.id) return;
    const toIndex = session.tabs.findIndex((tab) => tab.path === over.id);
    if (toIndex >= 0) onReorder(String(active.id), toIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setDraggingPath(String(active.id))}
      onDragCancel={() => setDraggingPath(null)}
      onDragEnd={finishDrag}
    >
      <SortableContext items={session.tabs.map((tab) => tab.path)} strategy={horizontalListSortingStrategy}>
        <div
          id={OPEN_FILES_DROP_HOST_ID}
          ref={stripRef}
          className={['open-files-strip', draggingPath ? 'sorting' : '', fades.start ? 'fade-start' : '', fades.end ? 'fade-end' : ''].filter(Boolean).join(' ')}
          role="tablist"
          aria-label="Open files"
          aria-orientation="horizontal"
          onScroll={measure}
        >
          {session.tabs.map((tab) => (
            <SortableFileTab
              key={tab.path}
              tab={tab}
              label={labels.get(tab.path)}
              active={session.activePath === tab.path}
              preview={session.previewPath === tab.path}
              register={(element) => {
                if (element) tabRefs.current.set(tab.path, element);
                else tabRefs.current.delete(tab.path);
              }}
              onActivate={onActivate}
              onPin={onPin}
              onClose={onClose}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={reducedMotion ? null : TAB_MOTION}>
        {draggingTab && (
          <FileTabSurface
            tab={draggingTab}
            label={labels.get(draggingTab.path)}
            preview={session.previewPath === draggingTab.path}
            overlay
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SortableFileTab({ tab, label, active, preview, register, onActivate, onPin, onClose }: {
  tab: RuntimeTab;
  label: { name: string; suffix: string | null } | undefined;
  active: boolean;
  preview: boolean;
  register(element: HTMLDivElement | null): void;
  onActivate(path: string): void;
  onPin(path: string): void;
  onClose(path: string): void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.path, transition: TAB_MOTION });
  const description = [
    preview ? 'preview' : null,
    tab.dirty ? 'unsaved changes' : null,
    tab.missing ? 'file no longer on disk' : null,
  ].filter(Boolean).join(', ');
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const setRefs = (element: HTMLDivElement | null) => {
    setNodeRef(element);
    register(element);
  };

  return (
    <Tooltip>
      <TooltipTrigger render={
        <div
          ref={setRefs}
          role="tab"
          tabIndex={0}
          aria-selected={active}
          aria-current={active ? 'page' : undefined}
          aria-keyshortcuts="Control+Shift+PageUp Control+Shift+PageDown"
          aria-label={description ? `${tab.path}, ${description}` : tab.path}
          className={tabClassName(tab, { active, preview, dragging: isDragging })}
          style={style}
          {...listeners}
          onClick={() => onActivate(tab.path)}
          onDoubleClick={() => onPin(tab.path)}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onClose(tab.path);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onActivate(tab.path);
              return;
            }
            if (event.key === 'Delete') {
              event.preventDefault();
              onClose(tab.path);
            }
          }}
        />
      }><FileTabContents tab={tab} label={label} onClose={onClose} /></TooltipTrigger>
      <TooltipContent>{description ? `${tab.path} · ${description}` : tab.path}</TooltipContent>
    </Tooltip>
  );
}

function FileTabSurface({ tab, label, preview, overlay = false }: {
  tab: RuntimeTab;
  label: { name: string; suffix: string | null } | undefined;
  preview: boolean;
  overlay?: boolean;
}) {
  return (
    <div className={tabClassName(tab, { preview, overlay })} aria-hidden="true">
      <FileTabContents tab={tab} label={label} />
    </div>
  );
}

function FileTabContents({ tab, label, onClose }: {
  tab: RuntimeTab;
  label: { name: string; suffix: string | null } | undefined;
  onClose?: ((path: string) => void) | undefined;
}) {
  return (
    <>
      <span className="open-file-tab-name">{label?.name ?? tab.path}</span>
      {label?.suffix && <span className="open-file-tab-suffix">{label.suffix}</span>}
      {onClose ? (
        <button
          type="button"
          className="open-file-tab-close"
          aria-label={`Close ${tab.path}`}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose(tab.path);
          }}
        >
          {tab.dirty && <span className="open-file-tab-dot" aria-hidden="true" />}
          <IconX className="open-file-tab-close-icon" aria-hidden="true" />
        </button>
      ) : (
        <span className="open-file-tab-close overlay-close" aria-hidden="true">
          {tab.dirty && <span className="open-file-tab-dot" />}
          <IconX className="open-file-tab-close-icon" />
        </span>
      )}
    </>
  );
}

function tabClassName(tab: RuntimeTab, state: { active?: boolean; preview?: boolean; dragging?: boolean; overlay?: boolean }): string {
  return [
    'open-file-tab',
    state.active ? 'active' : '',
    state.preview ? 'preview' : '',
    tab.dirty ? 'dirty' : '',
    tab.missing ? 'missing' : '',
    state.dragging ? 'dragging' : '',
    state.overlay ? 'drag-overlay' : '',
  ].filter(Boolean).join(' ');
}
