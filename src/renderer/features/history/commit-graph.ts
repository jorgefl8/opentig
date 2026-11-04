export interface CommitGraphInput {
  oid: string;
  parentOids: string[];
  /** Only on the current branch, not yet in its base. */
  branch?: boolean | undefined;
}

export interface CommitGraphSegment {
  fromLane: number;
  from: 'top' | 'node';
  toLane: number;
  to: 'node' | 'bottom';
  /** The line between two of the branch's own commits, or from one of them down to where the base starts. */
  branch?: true;
}

export interface CommitGraphRow {
  lane: number;
  segments: CommitGraphSegment[];
  /** Lanes still open below this row, which an expanded row has to carry on. */
  continuations: number[];
  /** Which of those lanes carry a branch line. */
  branchLanes: number[];
}

export interface CommitGraphLayout {
  rows: CommitGraphRow[];
  laneCount: number;
  /** Some line belongs to the branch, so the graph is worth drawing even on one lane. */
  hasBranch: boolean;
}

/** Builds graph lanes in Git's topological order. */
export function buildCommitGraph(commits: readonly CommitGraphInput[]): CommitGraphLayout {
  let lanes: string[] = [];
  // Whether the line each lane carries down is the branch's, decided by the child that opened it.
  let laneBranch: boolean[] = [];
  let laneCount = 1;
  let hasBranch = false;
  const rows: CommitGraphRow[] = [];
  const branchOids = new Set(commits.filter((commit) => commit.branch).map((commit) => commit.oid));
  // A merge's first parent continues the branch; a later parent only does if it is the branch's too, so main merged in stays main's.
  const branchEdge = (commit: CommitGraphInput, parentOid: string, index: number) => Boolean(commit.branch) && (index === 0 || branchOids.has(parentOid));
  const tone = (branch: boolean) => branch ? { branch: true as const } : {};

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.oid);
    const connectedFromAbove = lane >= 0;
    if (lane < 0) {
      lane = lanes.length;
      lanes = [...lanes, commit.oid];
      laneBranch = [...laneBranch, false];
    }
    const incoming = lanes;
    const outgoing = incoming.filter((_, index) => index !== lane);
    const outgoingBranch = laneBranch.filter((_, index) => index !== lane);
    let insertionLane = Math.min(lane, outgoing.length);

    commit.parentOids.forEach((parentOid, index) => {
      if (outgoing.includes(parentOid)) return;
      outgoing.splice(insertionLane, 0, parentOid);
      outgoingBranch.splice(insertionLane, 0, branchEdge(commit, parentOid, index));
      insertionLane += 1;
    });

    const segments: CommitGraphSegment[] = [];
    incoming.forEach((oid, fromLane) => {
      if (fromLane === lane) {
        if (connectedFromAbove) segments.push({ fromLane, from: 'top', toLane: lane, to: 'node', ...tone(laneBranch[fromLane]!) });
        return;
      }
      const toLane = outgoing.indexOf(oid);
      if (toLane >= 0) segments.push({ fromLane, from: 'top', toLane, to: 'bottom', ...tone(laneBranch[fromLane]!) });
    });
    commit.parentOids.forEach((parentOid, index) => {
      const toLane = outgoing.indexOf(parentOid);
      if (toLane >= 0) segments.push({ fromLane: lane, from: 'node', toLane, to: 'bottom', ...tone(branchEdge(commit, parentOid, index)) });
    });

    laneCount = Math.max(laneCount, incoming.length, outgoing.length);
    hasBranch ||= segments.some((segment) => segment.branch);
    rows.push({
      lane,
      segments,
      continuations: outgoing.map((_, continuationLane) => continuationLane),
      branchLanes: outgoingBranch.flatMap((branch, continuationLane) => branch ? [continuationLane] : []),
    });
    lanes = outgoing;
    laneBranch = outgoingBranch;
  }

  return { rows, laneCount, hasBranch };
}
