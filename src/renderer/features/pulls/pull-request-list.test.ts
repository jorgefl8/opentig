import { describe, expect, it } from 'vitest';
import type { PullRequestSummary } from '../../../shared/contracts';
import { withLineCounts, withStackMemberships } from './pull-request-list';

const pull = (number: number) => ({ number, title: `PR ${number}` }) as PullRequestSummary;
const stack = { number: 7, size: 2, position: 1, base: 'main' };

describe('withStackMemberships', () => {
  it('shows the list as it is until membership arrives, then marks only the members', () => {
    const pulls = [pull(1), pull(2)];
    expect(withStackMemberships(undefined, undefined)).toBeNull();
    expect(withStackMemberships(pulls, undefined)).toBe(pulls);
    expect(withStackMemberships(pulls, [{ number: 2, stack }])).toEqual([pull(1), { ...pull(2), stack }]);
  });
});

describe('withLineCounts', () => {
  it('fills in the rows that were waiting, and leaves a row still waiting marked instead of showing zero lines', () => {
    const open = { ...pull(1), additions: 4, deletions: 2 };
    const merged = { ...pull(2), additions: 0, deletions: 0, lineCountsPending: true as const };
    const closed = { ...pull(3), additions: 0, deletions: 0, lineCountsPending: true as const };
    expect(withLineCounts([open, merged], undefined)).toEqual([open, merged]);
    expect(withLineCounts([open, merged, closed], [{ number: 1, additions: 99, deletions: 99 }, { number: 2, additions: 12, deletions: 5 }]))
      .toEqual([open, { ...pull(2), additions: 12, deletions: 5 }, closed]);
  });
});
