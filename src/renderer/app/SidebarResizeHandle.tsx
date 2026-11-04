import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  SIDEBAR_DEFAULT_WIDTH, SIDEBAR_KEYBOARD_STEP, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH,
  clampSidebarWidth, resolveSidebarDrag,
} from './sidebar-layout';

/**
 * The draggable edge between the sidebar and the viewer. Dragging resizes;
 * releasing it far enough to the left folds the sidebar into its rail.
 * Double-click restores the default width.
 */
export function SidebarResizeHandle({ width, railWidth, onPreview, onResize, onCollapse }: {
  width: number;
  railWidth: number;
  /** The width to paint while dragging, or null once the drag ends. */
  onPreview: (width: number | null) => void;
  onResize: (width: number) => void;
  onCollapse: () => void;
}) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [collapsing, setCollapsing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setCollapsing(false);
    onPreview(null);
    if (!commit) return;
    const result = resolveSidebarDrag(current.startWidth, event.clientX - current.startX, railWidth);
    if (result.collapse) onCollapse();
    else if (result.width !== current.startWidth) onResize(result.width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? width - SIDEBAR_KEYBOARD_STEP
      : event.key === 'ArrowRight' ? width + SIDEBAR_KEYBOARD_STEP
      : event.key === 'Home' ? SIDEBAR_MIN_WIDTH
      : event.key === 'End' ? SIDEBAR_MAX_WIDTH
      : null;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampSidebarWidth(next);
    if (clamped !== width) onResize(clamped);
  };

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging ? '' : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        setDragging(true);
        onPreview(width);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const result = resolveSidebarDrag(current.startWidth, event.clientX - current.startX, railWidth);
        setCollapsing(result.collapse);
        onPreview(result.previewWidth);
      }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}
      onDoubleClick={() => { if (width !== SIDEBAR_DEFAULT_WIDTH) onResize(SIDEBAR_DEFAULT_WIDTH); }}
      onKeyDown={onKeyDown}
    >
      {collapsing && <span className="sidebar-resize-hint" role="status">Release to collapse</span>}
    </div>
  );
}
