import type { PullRequestLineCounts, PullRequestStackMembership, PullRequestSummary } from '../../../shared/contracts';

/** The list arrives before its stack membership, which then fills in the rows that have one. */
export function withStackMemberships(pulls: PullRequestSummary[] | undefined, stacks: Array<{ number: number; stack: PullRequestStackMembership }> | undefined): PullRequestSummary[] | null {
  if (!pulls) return null;
  if (!stacks?.length) return pulls;
  const byNumber = new Map(stacks.map(({ number, stack }) => [number, stack]));
  return pulls.map((pull) => { const stack = byNumber.get(pull.number); return stack ? { ...pull, stack } : pull; });
}

/** Closed and merged rows arrive without line counts, which then fill in. A row still waiting keeps saying so, rather than showing zero. */
export function withLineCounts(pulls: PullRequestSummary[] | undefined, counts: PullRequestLineCounts[] | undefined): PullRequestSummary[] | undefined {
  if (!pulls || !counts?.length) return pulls;
  const byNumber = new Map(counts.map((count) => [count.number, count]));
  return pulls.map((pull) => {
    const count = pull.lineCountsPending ? byNumber.get(pull.number) : undefined;
    if (!count) return pull;
    const { lineCountsPending: _pending, ...rest } = pull;
    return { ...rest, additions: count.additions, deletions: count.deletions };
  });
}
