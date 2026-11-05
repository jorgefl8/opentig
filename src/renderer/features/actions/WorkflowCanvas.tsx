import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { IconFocusCentered, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import type { ActionRunGraphNode, ActionRunJob } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ActionStatusIcon } from './ActionStatusIcon';
import { actionStatusLabel, actionTone, combinedTone, elapsed, formatDuration, jobLabel, type ActionTone } from './action-status';
import { layoutWorkflowGraph, type LaidOutNode } from './workflow-canvas-layout';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const KEY_PAN = 48;
/** A mouse wheel notch (about 100) zooms by roughly a fifth; a trackpad pinch sends small steps. */
const WHEEL_ZOOM_SPEED = 0.002;

interface View { x: number; y: number; scale: number }

/** --motion-med and --ease-out: buttons and keys glide the graph; dragging, the wheel and pinching follow the hand. */
const GLIDE = { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The whole graph, centred, no larger than its natural size. */
function fitView(width: number, height: number, contentWidth: number, contentHeight: number): View {
  if (!width || !height) return { x: 0, y: 0, scale: 1 };
  const scale = clampScale(Math.min(1, width / contentWidth, height / contentHeight));
  return { x: (width - contentWidth * scale) / 2, y: (height - contentHeight * scale) / 2, scale };
}

export interface WorkflowCanvasProps {
  graph: ActionRunGraphNode[];
  jobs: ReadonlyMap<number, ActionRunJob>;
  runCompleted: boolean;
  selectedJobId: number | null;
  onSelectJob(jobId: number): void;
  now: number;
}

/**
 * The run's jobs as a graph that can be dragged and zoomed. A node is a job of
 * the workflow file; a matrix lists its jobs inside it. Lines show `needs`.
 */
export function WorkflowCanvas({ graph, jobs, runCompleted, selectedJobId, onSelectJob, now }: WorkflowCanvasProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const layout = useMemo(() => layoutWorkflowGraph(graph, expanded), [graph, expanded]);
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  useLayoutEffect(() => { viewRef.current = view; }, [view]);
  const reduceMotion = useReducedMotion();
  const glide = useRef<AnimationPlaybackControls | null>(null);
  const stopGlide = useCallback(() => { glide.current?.stop(); glide.current = null; }, []);
  useEffect(() => stopGlide, [stopGlide]);
  /** Moves to a view, gliding there unless motion is reduced. */
  const glideTo = useCallback((target: View) => {
    stopGlide();
    const from = viewRef.current;
    if (reduceMotion) { setView(target); return; }
    glide.current = animate(0, 1, {
      ...GLIDE,
      onUpdate: (t) => setView({ x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t, scale: from.scale + (target.scale - from.scale) * t }),
    });
  }, [reduceMotion, stopGlide]);
  // Until someone moves the graph, it keeps fitting the space as the panel or the graph changes size.
  const touched = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitted = useCallback(() => fitView(size.width, size.height, layout.width, layout.height), [layout.height, layout.width, size.height, size.width]);
  const fit = useCallback(() => { touched.current = false; glideTo(fitted()); }, [fitted, glideTo]);

  // Resizing the pane or the graph refits at once, until someone moves it.
  useLayoutEffect(() => { if (!touched.current) { stopGlide(); setView(fitted()); } }, [fitted, stopGlide]);

  const zoomed = useCallback((current: View, factor: number, originX?: number, originY?: number): View => {
    const scale = clampScale(current.scale * factor);
    const x = originX ?? size.width / 2;
    const y = originY ?? size.height / 2;
    const ratio = scale / current.scale;
    return { scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio };
  }, [size.height, size.width]);

  /** Wheel and pinch: immediate, so the graph stays under the fingers. */
  const zoomAt = useCallback((factor: number, originX?: number, originY?: number) => {
    touched.current = true;
    stopGlide();
    setView((current) => zoomed(current, factor, originX, originY));
  }, [stopGlide, zoomed]);

  /** Buttons and keys: a step that glides. */
  const zoomStep = useCallback((factor: number) => {
    touched.current = true;
    glideTo(zoomed(viewRef.current, factor));
  }, [glideTo, zoomed]);

  const panBy = useCallback((dx: number, dy: number) => {
    touched.current = true;
    stopGlide();
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, [stopGlide]);

  // Wheel scrolls the graph; Ctrl or ⌘ with the wheel, and trackpad pinches, zoom. React's wheel listener is passive.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), event.clientX - rect.left, event.clientY - rect.top);
      else panBy(-event.deltaX, -event.deltaY);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [panBy, zoomAt]);

  // Dragging the background moves the graph; two fingers also zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button') || event.button !== 0) return;
    stopGlide();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = event.currentTarget.getBoundingClientRect();
      if (pinch.current.distance > 0) zoomAt(distance / pinch.current.distance, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      pinch.current = { distance };
      return;
    }
    panBy(next.x - previous.x, next.y - previous.y);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const actions: Record<string, () => void> = {
      '+': () => zoomStep(1.2), '=': () => zoomStep(1.2), '-': () => zoomStep(1 / 1.2), '0': fit,
      ArrowLeft: () => panBy(KEY_PAN, 0), ArrowRight: () => panBy(-KEY_PAN, 0), ArrowUp: () => panBy(0, KEY_PAN), ArrowDown: () => panBy(0, -KEY_PAN),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const nodeTones = useMemo(() => new Map(layout.nodes.map((item) => [item.node.id, nodeTone(item.node, jobs, runCompleted)])), [jobs, layout.nodes, runCompleted]);
  const selectedNode = selectedJobId === null ? null : graph.find((node) => node.jobIds.includes(selectedJobId))?.id ?? null;
  const focus = hovered ?? selectedNode;

  return (
    <div className="workflow-canvas">
      <div
        ref={viewport}
        className="workflow-canvas-viewport"
        tabIndex={0}
        role="group"
        aria-label="Workflow graph. Drag or use the arrow keys to move it; plus and minus zoom, 0 fits it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <div className="workflow-canvas-layer" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="workflow-canvas-edges" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.edges.map((edge) => {
              const tone = nodeTones.get(edge.from) ?? 'queued';
              const done = tone === 'success' || tone === 'skipped' || tone === 'neutral';
              const active = focus !== null && (edge.from === focus || edge.to === focus);
              return <path key={`${edge.from}->${edge.to}`} d={edge.path} className={`workflow-edge ${done ? 'done' : ''} ${active ? 'active' : ''}`} />;
            })}
          </svg>
          {layout.nodes.map((item) => (
            <WorkflowNode
              key={item.node.id}
              item={item}
              jobs={jobs}
              tone={nodeTones.get(item.node.id) ?? 'queued'}
              runCompleted={runCompleted}
              selectedJobId={selectedJobId}
              onSelectJob={onSelectJob}
              onHover={setHovered}
              expanded={expanded.has(item.node.id)}
              onToggleExpanded={() => setExpanded((current) => {
                const next = new Set(current);
                if (next.has(item.node.id)) next.delete(item.node.id); else next.add(item.node.id);
                return next;
              })}
              now={now}
            />
          ))}
        </div>
      </div>
      <div className="workflow-canvas-controls">
        <CanvasButton label="Zoom out" disabled={view.scale <= MIN_SCALE} onClick={() => zoomStep(1 / 1.2)}><IconZoomOut /></CanvasButton>
        <Tooltip>
          <TooltipTrigger render={<button type="button" className="workflow-canvas-scale" onClick={() => zoomStep(1 / viewRef.current.scale)} />}>{Math.round(view.scale * 100)}%</TooltipTrigger>
          <TooltipContent>Actual size</TooltipContent>
        </Tooltip>
        <CanvasButton label="Zoom in" disabled={view.scale >= MAX_SCALE} onClick={() => zoomStep(1.2)}><IconZoomIn /></CanvasButton>
        <CanvasButton label="Fit to view" onClick={fit}><IconFocusCentered /></CanvasButton>
      </div>
    </div>
  );
}

function CanvasButton({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={label} disabled={disabled} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A job of the workflow without run jobs is waiting, or wasn't run once the run is over. */
function nodeTone(node: ActionRunGraphNode, jobs: ReadonlyMap<number, ActionRunJob>, runCompleted: boolean): ActionTone {
  const tones = node.jobIds.flatMap((id) => {
    const job = jobs.get(id);
    return job ? [actionTone(job.status, job.conclusion)] : [];
  });
  if (tones.length === 0) return runCompleted ? 'skipped' : 'queued';
  return combinedTone(tones);
}

function jobDuration(job: ActionRunJob, now: number): string | null {
  const value = elapsed(job.startedAt, job.completedAt, now);
  return value === null ? null : formatDuration(value);
}

function WorkflowNode({ item, jobs, tone, runCompleted, selectedJobId, onSelectJob, onHover, expanded, onToggleExpanded, now }: {
  item: LaidOutNode;
  jobs: ReadonlyMap<number, ActionRunJob>;
  tone: ActionTone;
  runCompleted: boolean;
  selectedJobId: number | null;
  onSelectJob(jobId: number): void;
  onHover(id: string | null): void;
  expanded: boolean;
  onToggleExpanded(): void;
  now: number;
}) {
  const { node } = item;
  const nodeJobs = node.jobIds.flatMap((id) => jobs.get(id) ?? []);
  const single = nodeJobs.length === 1 ? nodeJobs[0]! : null;
  const done = nodeJobs.filter((job) => job.status === 'completed').length;
  const meta = single
    ? jobDuration(single, now) ?? actionStatusLabel(single.status, single.conclusion)
    : nodeJobs.length === 0
      ? runCompleted ? 'Not run' : 'Waiting'
      : `${done}/${nodeJobs.length}`;
  const status = single ? actionStatusLabel(single.status, single.conclusion) : nodeJobs.length ? `${done} of ${nodeJobs.length} jobs done` : meta;
  const header = (
    <>
      <ActionStatusIcon tone={tone} />
      <span className="workflow-node-name">{node.name}</span>
      <span className="workflow-node-meta">{meta}</span>
    </>
  );
  return (
    <section
      className={`workflow-node tone-${tone} ${single && single.id === selectedJobId ? 'selected' : ''}`}
      style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
      aria-label={`${node.name}: ${status}`}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
    >
      {single
        ? <Tooltip>
          <TooltipTrigger render={<button type="button" className="workflow-node-header" aria-pressed={single.id === selectedJobId} onClick={() => onSelectJob(single.id)} />}>{header}</TooltipTrigger>
          <TooltipContent>{single.name} · {status}</TooltipContent>
        </Tooltip>
        : <div className="workflow-node-header">{header}</div>}
      {nodeJobs.length > 1 && (
        <div className="workflow-node-jobs">
          {item.visibleJobIds.map((id) => {
            const job = jobs.get(id);
            if (!job) return null;
            const jobTone = actionTone(job.status, job.conclusion);
            return (
              <Tooltip key={id}>
                <TooltipTrigger render={<button type="button" className={`workflow-job ${id === selectedJobId ? 'selected' : ''}`} aria-pressed={id === selectedJobId} onClick={() => onSelectJob(id)} />}>
                  <ActionStatusIcon tone={jobTone} />
                  <span className="workflow-job-name">{jobLabel(job.name, node.name)}</span>
                  <span className="workflow-node-meta">{jobDuration(job, now) ?? actionStatusLabel(job.status, job.conclusion)}</span>
                </TooltipTrigger>
                <TooltipContent>{job.name} · {actionStatusLabel(job.status, job.conclusion)}</TooltipContent>
              </Tooltip>
            );
          })}
          {(item.hidden > 0 || expanded) && (
            <button type="button" className="workflow-job more" aria-expanded={expanded} onClick={onToggleExpanded}>
              {expanded ? 'Show fewer' : `${item.hidden} more`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
