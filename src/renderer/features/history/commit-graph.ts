export interface CommitGraphInput {
  oid: string;
  parentOids: string[];
  /** Reserved primary-line colors: local (0), published (1), base (2). */
  color?: number | undefined;
}

export interface CommitGraphSegment {
  fromLane: number;
  from: 'top' | 'node';
  toLane: number;
  to: 'node' | 'bottom';
  color: number;
}

export interface CommitGraphRow {
  lane: number;
  color: number;
  segments: CommitGraphSegment[];
  continuations: Array<{ lane: number; color: number }>;
}

export interface CommitGraphLayout {
  rows: CommitGraphRow[];
  laneCount: number;
}

/**
 * Builds graph lanes in Git's topological order. First parents continue their
 * current color; extra merge parents receive a separate stable color.
 */
export function buildCommitGraph(commits: readonly CommitGraphInput[]): CommitGraphLayout {
  let lanes: string[] = [];
  let nextColor = commits.some((commit) => commit.color !== undefined) ? 3 : 0;
  let laneCount = 1;
  const colors = new Map<string, number>();
  const rows: CommitGraphRow[] = [];
  // Reserve the first-parent line before visiting side branches so a branch
  // encountered first cannot steal the color of its eventual join point.
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const primary = new Set<string>();
  let current = commits[0];
  while (current && !primary.has(current.oid)) {
    primary.add(current.oid);
    if (current.color !== undefined) colors.set(current.oid, current.color);
    current = byOid.get(current.parentOids[0] ?? '');
  }

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.oid);
    const connectedFromAbove = lane >= 0;
    if (lane < 0) {
      lane = lanes.length;
      lanes = [...lanes, commit.oid];
    }
    const incoming = lanes;
    const incomingColor = ensureColor(colors, commit.oid, () => commit.color ?? nextColor++);
    // Reference states can change on the first-parent line. Side lanes retain
    // their own color until they rejoin, even when all their commits are on main.
    const commitColor = incomingColor < 3 ? commit.color ?? incomingColor : incomingColor;
    colors.set(commit.oid, commitColor);
    const outgoing = incoming.filter((_, index) => index !== lane);
    let insertionLane = Math.min(lane, outgoing.length);

    commit.parentOids.forEach((parentOid, index) => {
      if (!colors.has(parentOid)) {
        colors.set(parentOid, index === 0 ? commitColor : nextColor++);
      }
      if (outgoing.includes(parentOid)) return;
      outgoing.splice(insertionLane, 0, parentOid);
      insertionLane += 1;
    });

    const segments: CommitGraphSegment[] = [];
    incoming.forEach((oid, fromLane) => {
      if (fromLane === lane) {
        if (connectedFromAbove) segments.push({ fromLane, from: 'top', toLane: lane, to: 'node', color: incomingColor });
        return;
      }
      const toLane = outgoing.indexOf(oid);
      if (toLane >= 0) segments.push({ fromLane, from: 'top', toLane, to: 'bottom', color: colors.get(oid) ?? 0 });
    });
    commit.parentOids.forEach((parentOid) => {
      const toLane = outgoing.indexOf(parentOid);
      if (toLane >= 0) segments.push({ fromLane: lane, from: 'node', toLane, to: 'bottom', color: colors.get(parentOid) ?? commitColor });
    });

    laneCount = Math.max(laneCount, incoming.length, outgoing.length);
    rows.push({
      lane,
      color: commitColor,
      segments,
      continuations: outgoing.map((oid, continuationLane) => ({ lane: continuationLane, color: colors.get(oid) ?? 0 })),
    });
    lanes = outgoing;
  }

  return { rows, laneCount };
}

function ensureColor(colors: Map<string, number>, oid: string, create: () => number): number {
  const existing = colors.get(oid);
  if (existing !== undefined) return existing;
  const color = create();
  colors.set(oid, color);
  return color;
}
