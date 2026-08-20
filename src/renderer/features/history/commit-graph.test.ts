import { describe, expect, it } from 'vitest';
import { buildCommitGraph } from './commit-graph';

describe('commit graph', () => {
  it('keeps linear history on one lane', () => {
    const graph = buildCommitGraph([
      { oid: 'c', parentOids: ['b'] },
      { oid: 'b', parentOids: ['a'] },
      { oid: 'a', parentOids: [] },
    ]);

    expect(graph.laneCount).toBe(1);
    expect(graph.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(graph.rows[0]?.segments).toEqual([
      { fromLane: 0, from: 'node', toLane: 0, to: 'bottom', color: 0 },
    ]);
    expect(graph.rows[0]?.continuations).toEqual([{ lane: 0, color: 0 }]);
  });

  it('opens and rejoins a merge lane', () => {
    const graph = buildCommitGraph([
      { oid: 'merge', parentOids: ['main', 'branch'] },
      { oid: 'branch', parentOids: ['base'] },
      { oid: 'main', parentOids: ['base'] },
      { oid: 'base', parentOids: [] },
    ]);

    expect(graph.laneCount).toBe(2);
    expect(graph.rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
    expect(graph.rows[0]?.segments.filter((segment) => segment.from === 'node')).toHaveLength(2);
    expect(graph.rows[1]?.segments).toContainEqual({ fromLane: 0, from: 'top', toLane: 0, to: 'bottom', color: 0 });
    expect(graph.rows[2]?.segments).toContainEqual({ fromLane: 0, from: 'node', toLane: 0, to: 'bottom', color: 1 });
  });
});
