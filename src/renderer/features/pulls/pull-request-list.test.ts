import { describe, expect, it } from 'vitest';
import type { PullRequestSummary } from '../../../shared/contracts';
import { withStackMemberships } from './pull-request-list';

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
