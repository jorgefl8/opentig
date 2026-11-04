import { describe, expect, it } from 'vitest';
import { classifyActionFailure } from './GitHubActionErrors';

const classify = (stderr: string) => classifyActionFailure({ stderr, exitCode: 1 }, 'gh-pr-action').detail;

describe('classifyActionFailure', () => {
  it.each([
    ['gh: Base branch was modified (HTTP 405)', 'GH_PROCESS_FAILED'],
    ['GraphQL: Pull request #401 is not mergeable (mergePullRequest)', 'GH_PROCESS_FAILED'],
    ['GraphQL: Pull request #403 is in clean status (enablePullRequestAutoMerge)', 'GH_PROCESS_FAILED'],
    ['! Pull request sample/demo#7 (Fix authentication) is already closed', 'GH_PROCESS_FAILED'],
    ['! Pull request sample/demo#7 (Return HTTP 404 for missing pages) is already closed', 'GH_PROCESS_FAILED'],
    ['! Pull request sample/demo#7 (Return (HTTP 404) for pages) is already closed', 'GH_PROCESS_FAILED'],
    ['GraphQL: Required status check "network-tools" is failing (mergePullRequest)', 'GH_PROCESS_FAILED'],
    ['GraphQL: Required status check "sso-portal" is failing (mergePullRequest)', 'GH_PROCESS_FAILED'],
    ['! Pull request sample/demo#7 (Improve rate limiting) is already closed', 'GH_PROCESS_FAILED'],
  ])('keeps a rejection that only mentions a failure as the rejection: %s', (stderr, code) => {
    const detail = classify(stderr);
    expect(detail.code).toBe(code);
    expect(detail.message).toContain(stderr.replace(/^gh: /, '').replace(/^GraphQL: /, ''));
  });

  it.each([
    ['gh: API rate limit exceeded for user ID 1. (HTTP 403)', 'GH_RATE_LIMITED'],
    ['gh: You have exceeded a secondary rate limit. Please wait a few minutes. (HTTP 403)', 'GH_RATE_LIMITED'],
    ['gh: Bad credentials (HTTP 401)', 'GH_AUTH_REQUIRED'],
    ['To get started with GitHub CLI, please run:  gh auth login', 'GH_AUTH_REQUIRED'],
    ['gh: Resource not accessible by integration (HTTP 403)', 'GH_ACCESS_DENIED'],
    ['gh: Not Found (HTTP 404)', 'GH_ACCESS_DENIED'],
    ['Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host', 'GH_PROCESS_FAILED'],
    ['unknown flag: --undo', 'GH_CLI_INCOMPATIBLE'],
    ['unknown shorthand flag: x in -x', 'GH_CLI_INCOMPATIBLE'],
    ['unknown command "revert" for "gh pr"', 'GH_CLI_INCOMPATIBLE'],
    ['GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)', 'GH_PR_STATE_CHANGED'],
  ])('recognises %s', (stderr, code) => {
    expect(classify(stderr).code).toBe(code);
  });

  it('passes GitHub\'s own message through, without the tool\'s prefixes', () => {
    expect(classify('gh: Pull Request is not mergeable\nmore detail').message).toBe('Pull Request is not mergeable');
    expect(classify('GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)').message).toBe('Auto merge is not allowed for this repository (enablePullRequestAutoMerge)');
  });

  it('has a message even when gh gives none', () => {
    expect(classify('').message).toBe('GitHub CLI could not complete the operation.');
  });
});
