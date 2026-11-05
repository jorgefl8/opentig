import type { ActionRunGraphNode } from '../../../shared/contracts';

export const NODE_WIDTH = 248;
export const NODE_HEADER_HEIGHT = 38;
export const JOB_ROW_HEIGHT = 30;
/** Rows a matrix shows before the rest collapse into "N more". */
export const MAX_VISIBLE_JOBS = 6;
const NODE_PADDING = 6;
const COLUMN_GAP = 72;
const ROW_GAP = 20;
export const CANVAS_MARGIN = 32;

export interface LaidOutNode {
  node: ActionRunGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  /** Jobs shown as rows; `hidden` more sit behind a "more" row. */
  visibleJobIds: number[];
  hidden: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  path: string;
}

export interface WorkflowLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

/**
 * A node's rows: one per job of a matrix, with a "more" row for a long one.
 * A single job is the node itself, and a job that hasn't started has only its header.
 */
export function nodeRows(jobCount: number, expanded = false): { visible: number; hidden: number; rows: number } {
  if (jobCount <= 1) return { visible: 0, hidden: 0, rows: 0 };
  if (jobCount <= MAX_VISIBLE_JOBS) return { visible: jobCount, hidden: 0, rows: jobCount };
  // Expanded, the last row folds it again.
  if (expanded) return { visible: jobCount, hidden: 0, rows: jobCount + 1 };
  const visible = MAX_VISIBLE_JOBS - 1;
  return { visible, hidden: jobCount - visible, rows: MAX_VISIBLE_JOBS };
}

/**
 * Columns follow dependencies: a job sits one column right of the furthest
 * job it needs. Within a column, jobs follow the average row of what they
 * need, so lines cross less, and columns are centred on the tallest one.
 */
export function layoutWorkflowGraph(graph: ActionRunGraphNode[], expanded: ReadonlySet<string> = new Set()): WorkflowLayout {
  const byId = new Map(graph.map((node) => [node.id, node]));
  const columnOf = new Map<string, number>();
  const visiting = new Set<string>();
  const column = (id: string): number => {
    const known = columnOf.get(id);
    if (known !== undefined) return known;
    // A cycle isn't valid in a workflow; break it rather than recurse forever.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const needs = byId.get(id)?.needs.filter((need) => byId.has(need)) ?? [];
    const value = needs.length ? Math.max(...needs.map(column)) + 1 : 0;
    visiting.delete(id);
    columnOf.set(id, value);
    return value;
  };
  graph.forEach((node) => column(node.id));

  const columns: ActionRunGraphNode[][] = [];
  for (const node of graph) (columns[columnOf.get(node.id)!] ??= []).push(node);
  const order = new Map<string, number>();
  columns.forEach((nodes, index) => {
    if (index > 0) {
      const weight = (node: ActionRunGraphNode) => {
        const positions = node.needs.map((need) => order.get(need)).filter((value): value is number => value !== undefined);
        return positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : Number.POSITIVE_INFINITY;
      };
      // Stable: equal weights keep the workflow file's order.
      nodes.sort((left, right) => weight(left) - weight(right));
    }
    nodes.forEach((node, position) => order.set(node.id, position));
  });

  const sized = columns.map((nodes) => nodes.map((node) => {
    const rows = nodeRows(node.jobIds.length, expanded.has(node.id));
    return { node, rows, height: NODE_HEADER_HEIGHT + (rows.rows ? rows.rows * JOB_ROW_HEIGHT + NODE_PADDING * 2 : 0) };
  }));
  const columnHeights = sized.map((nodes) => nodes.reduce((sum, item) => sum + item.height, 0) + Math.max(0, nodes.length - 1) * ROW_GAP);
  const tallest = Math.max(0, ...columnHeights);

  const laidOut: LaidOutNode[] = [];
  sized.forEach((nodes, index) => {
    let y = CANVAS_MARGIN + (tallest - columnHeights[index]!) / 2;
    const x = CANVAS_MARGIN + index * (NODE_WIDTH + COLUMN_GAP);
    for (const { node, rows, height } of nodes) {
      laidOut.push({ node, x, y, width: NODE_WIDTH, height, column: index, visibleJobIds: node.jobIds.slice(0, rows.visible), hidden: rows.hidden });
      y += height + ROW_GAP;
    }
  });

  const placed = new Map(laidOut.map((item) => [item.node.id, item]));
  const edges: LaidOutEdge[] = [];
  for (const item of laidOut) {
    for (const need of item.node.needs) {
      const source = placed.get(need);
      if (!source) continue;
      const startX = source.x + source.width;
      const startY = source.y + NODE_HEADER_HEIGHT / 2;
      const endX = item.x;
      const endY = item.y + NODE_HEADER_HEIGHT / 2;
      const bend = Math.max(24, (endX - startX) / 2);
      edges.push({ from: need, to: item.node.id, path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}` });
    }
  }

  return {
    nodes: laidOut,
    edges,
    width: CANVAS_MARGIN * 2 + Math.max(1, columns.length) * NODE_WIDTH + Math.max(0, columns.length - 1) * COLUMN_GAP,
    height: CANVAS_MARGIN * 2 + tallest,
  };
}
