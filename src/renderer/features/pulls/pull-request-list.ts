import type { PullRequestStackMembership, PullRequestSummary } from '../../../shared/contracts';

/** The list arrives before its stack membership, which then fills in the rows that have one. */
export function withStackMemberships(pulls: PullRequestSummary[] | undefined, stacks: Array<{ number: number; stack: PullRequestStackMembership }> | undefined): PullRequestSummary[] | null {
  if (!pulls) return null;
  if (!stacks?.length) return pulls;
  const byNumber = new Map(stacks.map(({ number, stack }) => [number, stack]));
  return pulls.map((pull) => { const stack = byNumber.get(pull.number); return stack ? { ...pull, stack } : pull; });
}
