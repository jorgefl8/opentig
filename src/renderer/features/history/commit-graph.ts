export interface CommitGraphInput {
  oid: string;
  parentOids: string[];
}

export interface CommitGraphSegment {
  fromLane: number;
  from: 'top' | 'node';
  toLane: number;
  to: 'node' | 'bottom';
}

export interface CommitGraphRow {
  lane: number;
  segments: CommitGraphSegment[];
  /** Lanes still open below this row, which an expanded row has to carry on. */
  continuations: number[];
}

export interface CommitGraphLayout {
  rows: CommitGraphRow[];
  laneCount: number;
}

/** Builds graph lanes in Git's topological order. */
export function buildCommitGraph(commits: readonly CommitGraphInput[]): CommitGraphLayout {
  let lanes: string[] = [];
  let laneCount = 1;
  const rows: CommitGraphRow[] = [];

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.oid);
    const connectedFromAbove = lane >= 0;
    if (lane < 0) {
      lane = lanes.length;
      lanes = [...lanes, commit.oid];
    }
    const incoming = lanes;
    const outgoing = incoming.filter((_, index) => index !== lane);
    let insertionLane = Math.min(lane, outgoing.length);

    commit.parentOids.forEach((parentOid) => {
      if (outgoing.includes(parentOid)) return;
      outgoing.splice(insertionLane, 0, parentOid);
      insertionLane += 1;
    });

    const segments: CommitGraphSegment[] = [];
    incoming.forEach((oid, fromLane) => {
      if (fromLane === lane) {
        if (connectedFromAbove) segments.push({ fromLane, from: 'top', toLane: lane, to: 'node' });
        return;
      }
      const toLane = outgoing.indexOf(oid);
      if (toLane >= 0) segments.push({ fromLane, from: 'top', toLane, to: 'bottom' });
    });
    commit.parentOids.forEach((parentOid) => {
      const toLane = outgoing.indexOf(parentOid);
      if (toLane >= 0) segments.push({ fromLane: lane, from: 'node', toLane, to: 'bottom' });
    });

    laneCount = Math.max(laneCount, incoming.length, outgoing.length);
    rows.push({ lane, segments, continuations: outgoing.map((_, continuationLane) => continuationLane) });
    lanes = outgoing;
  }

  return { rows, laneCount };
}
