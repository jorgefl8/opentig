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
      { fromLane: 0, from: 'node', toLane: 0, to: 'bottom' },
    ]);
    expect(graph.rows[0]?.continuations).toEqual([0]);
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
    expect(graph.rows[1]?.segments).toContainEqual({ fromLane: 0, from: 'top', toLane: 0, to: 'bottom' });
    expect(graph.rows[2]?.segments).toContainEqual({ fromLane: 0, from: 'node', toLane: 0, to: 'bottom' });
  });

  it('marks the branch line down to where its base starts', () => {
    const graph = buildCommitGraph([
      { oid: 'two', parentOids: ['one'], branch: true },
      { oid: 'one', parentOids: ['main'], branch: true },
      { oid: 'main', parentOids: ['old'] },
      { oid: 'old', parentOids: [] },
    ]);
    expect(graph.hasBranch).toBe(true);
    expect(graph.rows[0]?.segments).toEqual([{ fromLane: 0, from: 'node', toLane: 0, to: 'bottom', branch: true }]);
    expect(graph.rows[1]?.segments.every((segment) => segment.branch)).toBe(true);
    expect(graph.rows[1]?.branchLanes).toEqual([0]);
    expect(graph.rows[2]?.segments).toEqual([
      { fromLane: 0, from: 'top', toLane: 0, to: 'node', branch: true },
      { fromLane: 0, from: 'node', toLane: 0, to: 'bottom' },
    ]);
    expect(graph.rows[2]?.branchLanes).toEqual([]);
  });

  it('leaves the base its own line where it is merged into the branch', () => {
    const graph = buildCommitGraph([
      { oid: 'merge', parentOids: ['mine', 'main'], branch: true },
      { oid: 'main', parentOids: ['base'] },
      { oid: 'mine', parentOids: ['base'], branch: true },
      { oid: 'base', parentOids: [] },
    ]);
    const fromMerge = graph.rows[0]!.segments;
    expect(fromMerge.find((segment) => segment.toLane === 0)?.branch).toBe(true);
    expect(fromMerge.find((segment) => segment.toLane === 1)?.branch).toBeUndefined();
    expect(graph.rows[1]?.segments.find((segment) => segment.fromLane === 0)?.branch).toBe(true);
  });

  it('has no branch line when nothing is outside the base', () => {
    expect(buildCommitGraph([{ oid: 'b', parentOids: ['a'] }, { oid: 'a', parentOids: [] }]).hasBranch).toBe(false);
  });

  it('needs no second lane once a merge branch is grouped away', () => {
    const graph = buildCommitGraph([
      { oid: 'merge', parentOids: ['main'] },
      { oid: 'main', parentOids: ['base'] },
      { oid: 'base', parentOids: [] },
    ]);
    expect(graph.laneCount).toBe(1);
  });
});
