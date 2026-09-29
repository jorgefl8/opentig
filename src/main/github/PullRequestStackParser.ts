import { z } from 'zod';
import type { PullRequestStack, PullRequestStackMembership } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';

const positive = z.number().int().positive().safe();
const membershipSchema = z.object({
  stack: z.object({ number: positive, size: positive, baseRefName: z.string().min(1) }).nullable(),
  stackEntry: z.object({ position: positive }).nullable(),
});
const stackSchema = z.object({
  number: positive,
  base: z.union([z.string().min(1), z.object({ ref: z.string().min(1) })]),
  pull_requests: z.array(z.object({
    number: positive, title: z.string().optional(), draft: z.boolean().optional(),
    head: z.object({ ref: z.string().min(1) }),
    state: z.enum(['open', 'closed', 'merged']), merged_at: z.string().nullable().optional(),
  })).min(1),
});

function invalid(): GhOperationError {
  return new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation: 'gh-pr-stack', message: 'GitHub returned unreadable stack information.' });
}
function json(raw: string): unknown {
  try { return JSON.parse(raw); } catch { throw invalid(); }
}

export function stackMembershipQuery(numbers: readonly number[]): string {
  if (!numbers.length || numbers.some((number) => !positive.safeParse(number).success)) throw invalid();
  return `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${numbers.map((number) => `pr${number}:pullRequest(number:${number}){stack{number size baseRefName} stackEntry{position}}`).join(' ')}}}`;
}

export function parseStackMemberships(raw: string, numbers: readonly number[]): Map<number, PullRequestStackMembership> {
  const envelope = z.object({ data: z.object({ repository: z.record(z.string(), membershipSchema.nullable()) }), errors: z.array(z.unknown()).optional() }).safeParse(json(raw));
  if (!envelope.success || envelope.data.errors?.length) throw invalid();
  const result = new Map<number, PullRequestStackMembership>();
  for (const number of numbers) {
    const entry = envelope.data.data.repository[`pr${number}`];
    if (entry === undefined) throw invalid();
    if (!entry?.stack && !entry?.stackEntry) continue;
    if (!entry?.stack || !entry.stackEntry || entry.stackEntry.position > entry.stack.size) throw invalid();
    result.set(number, { number: entry.stack.number, size: entry.stack.size, position: entry.stackEntry.position, base: entry.stack.baseRefName });
  }
  return result;
}

export function parsePullRequestStack(raw: string, prNumber: number, listing = false): PullRequestStack | null {
  let value = json(raw);
  if (listing) {
    if (!Array.isArray(value) || value.length > 1) throw invalid();
    if (!value.length) return null;
    value = value[0];
  }
  const parsed = stackSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const stack = parsed.data;
  if (!stack.pull_requests.some((pr) => pr.number === prNumber)
    || new Set(stack.pull_requests.map((pr) => pr.number)).size !== stack.pull_requests.length) throw invalid();
  return {
    number: stack.number, base: typeof stack.base === 'string' ? stack.base : stack.base.ref,
    layers: stack.pull_requests.map((pr) => ({
      number: pr.number, title: pr.title || pr.head.ref, headRefName: pr.head.ref,
      state: pr.merged_at || pr.state === 'merged' ? 'MERGED' : pr.state === 'closed' ? 'CLOSED' : 'OPEN', isDraft: pr.draft ?? false,
    })),
  };
}
