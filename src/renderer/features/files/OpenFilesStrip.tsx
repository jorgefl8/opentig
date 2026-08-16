import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { dropIndex, edgeFades, type FileSession, horizontalWheelDelta, tabLabels } from './open-files-model';

/**
 * Private to tab reordering. Files tree rows carry their own drag type, so a
 * file move can never be mistaken for a tab move in either direction.
 */
const TAB_DRAG_TYPE = 'application/x-justgit-tab-path';

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
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const labels = useMemo(() => tabLabels(session.tabs), [session.tabs]);

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

  if (session.tabs.length === 0) return null;

  const resolveDropIndex = (clientX: number): number => {
    const rects = session.tabs.map((tab) => {
      const element = tabRefs.current.get(tab.path);
      const rect = element?.getBoundingClientRect();
      return { left: rect?.left ?? 0, width: rect?.width ?? 0 };
    });
    return dropIndex(rects, clientX);
  };

  return (
    <div
      ref={stripRef}
      className={['open-files-strip', fades.start ? 'fade-start' : '', fades.end ? 'fade-end' : ''].filter(Boolean).join(' ')}
      role="tablist"
      aria-label="Open files"
      aria-orientation="horizontal"
      onScroll={measure}
      onDragOver={(event) => {
        if (!draggingPath) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(resolveDropIndex(event.clientX));
      }}
      onDrop={(event) => {
        const path = event.dataTransfer.getData(TAB_DRAG_TYPE);
        if (!path) return;
        event.preventDefault();
        onReorder(path, resolveDropIndex(event.clientX));
        setDraggingPath(null);
        setDropTarget(null);
      }}
    >
      {session.tabs.map((tab, index) => {
        const label = labels.get(tab.path);
        const active = session.activePath === tab.path;
        const preview = session.previewPath === tab.path;
        const description = [
          preview ? 'preview' : null,
          tab.dirty ? 'unsaved changes' : null,
          tab.missing ? 'file no longer on disk' : null,
        ].filter(Boolean).join(', ');
        return (
          <div
            key={tab.path}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.path, element);
              else tabRefs.current.delete(tab.path);
            }}
            role="tab"
            tabIndex={0}
            draggable
            title={description ? `${tab.path} (${description})` : tab.path}
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            aria-describedby={undefined}
            aria-label={description ? `${tab.path}, ${description}` : tab.path}
            className={[
              'open-file-tab',
              active ? 'active' : '',
              preview ? 'preview' : '',
              tab.dirty ? 'dirty' : '',
              tab.missing ? 'missing' : '',
              draggingPath === tab.path ? 'dragging' : '',
              dropTarget === index && draggingPath && draggingPath !== tab.path ? 'drop-target' : '',
            ].filter(Boolean).join(' ')}
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
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_DRAG_TYPE, tab.path);
              event.dataTransfer.effectAllowed = 'move';
              setDraggingPath(tab.path);
            }}
            onDragEnd={() => {
              setDraggingPath(null);
              setDropTarget(null);
            }}
          >
            <span className="open-file-tab-name">{label?.name ?? tab.path}</span>
            {label?.suffix && <span className="open-file-tab-suffix">{label.suffix}</span>}
            <button
              type="button"
              className="open-file-tab-close"
              aria-label={`Close ${tab.path}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.path);
              }}
            >
              {/* The dot marks unsaved changes and gives way to the close icon
                  on hover or focus, so the control never moves. */}
              {tab.dirty && <span className="open-file-tab-dot" aria-hidden="true" />}
              <IconX className="open-file-tab-close-icon" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
