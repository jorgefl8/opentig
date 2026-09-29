import { describe, expect, it } from 'vitest';
import { parsePullRequestStack, parseStackMemberships, stackMembershipQuery } from './PullRequestStackParser';

const stack = { number: 7, base: { ref: 'main' }, pull_requests: [
  { number: 101, title: 'Model', state: 'closed', merged_at: '2026-09-01T00:00:00Z', head: { ref: 'model' } },
  { number: 102, state: 'open', draft: true, head: { ref: 'api' } },
] };

describe('native PR stack parsing', () => {
  it('preserves native layer order, merged state, drafts and branch title fallback', () => {
    expect(parsePullRequestStack(JSON.stringify(stack), 102)).toEqual({ number: 7, base: 'main', layers: [
      { number: 101, title: 'Model', headRefName: 'model', state: 'MERGED', isDraft: false },
      { number: 102, title: 'api', headRefName: 'api', state: 'OPEN', isDraft: true },
    ] });
    expect(parsePullRequestStack(JSON.stringify([{ ...stack, base: 'release' }]), 102, true)?.base).toBe('release');
    expect(parsePullRequestStack('[]', 102, true)).toBeNull();
  });
  it('rejects malformed, unrelated, duplicated and ambiguous stacks instead of inventing absence', () => {
    for (const data of ['{', '{}', JSON.stringify([{ ...stack, number: 0 }]), JSON.stringify([stack, stack]), JSON.stringify([{ ...stack, pull_requests: [stack.pull_requests[0], stack.pull_requests[0]] }])]) {
      expect(() => parsePullRequestStack(data, 101, true)).toThrow();
    }
    expect(() => parsePullRequestStack(JSON.stringify(stack), 999)).toThrow();
  });
  it('maps batched native membership by PR number without deriving branch relationships', () => {
    const raw = JSON.stringify({ data: { repository: { pr101: { stack: { number: 7, size: 2, baseRefName: 'main' }, stackEntry: { position: 1 } }, pr102: { stack: null, stackEntry: null } } } });
    expect([...parseStackMemberships(raw, [101, 102])]).toEqual([[101, { number: 7, size: 2, position: 1, base: 'main' }]]);
    expect(stackMembershipQuery([101, 102])).toContain('pr102:pullRequest(number:102)');
  });
  it('rejects partial GraphQL failures, missing entries and impossible positions', () => {
    const entry = { stack: { number: 7, size: 2, baseRefName: 'main' }, stackEntry: { position: 3 } };
    for (const value of [{ data: { repository: {} } }, { data: { repository: { pr101: entry } } }, { errors: [{ message: 'Unavailable' }], data: { repository: { pr101: null } } }]) {
      expect(() => parseStackMemberships(JSON.stringify(value), [101])).toThrow();
    }
    expect(() => stackMembershipQuery([NaN])).toThrow();
  });
});
