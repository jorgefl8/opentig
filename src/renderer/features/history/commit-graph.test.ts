import { describe, expect, it } from 'vitest';
import { buildCommitGraph } from './commit-graph';

describe('commit graph', () => {
  it('colors reference boundaries without inventing a new lane', () => {
    const graph = buildCommitGraph([
      { oid: 'local', parentOids: ['remote'], color: 0 },
      { oid: 'remote', parentOids: ['main'], color: 1 },
      { oid: 'main', parentOids: [], color: 2 },
    ]);
    expect(graph.laneCount).toBe(1);
    expect(graph.rows.map((row) => row.color)).toEqual([0, 1, 2]);
    expect(graph.rows[0]?.continuations).toEqual([{ lane: 0, color: 1 }]);
    expect(graph.rows[1]?.segments[0]?.color).toBe(1);
  });

  it('keeps side branches distinct and restores the main color at their join', () => {
    const graph = buildCommitGraph([
      { oid: 'merge', parentOids: ['main', 'branch'], color: 2 },
      { oid: 'branch', parentOids: ['base'], color: 2 },
      { oid: 'main', parentOids: ['base'], color: 2 },
      { oid: 'base', parentOids: [], color: 2 },
    ]);
    expect(graph.rows.map((row) => row.color)).toEqual([2, 3, 2, 2]);
    expect(graph.rows[2]?.continuations).toEqual([{ lane: 0, color: 2 }]);
  });

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
