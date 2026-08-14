import { describe, expect, it } from 'vitest';
import { parseCreatedPullRequestUrl, parsePullRequestDetails, parsePullRequestList } from './PullRequestParser';

const summary = {
  number: 12,
  title: 'Add feature',
  state: 'OPEN',
  isDraft: false,
  author: { login: 'octocat' },
  headRefName: 'feature',
  baseRefName: 'main',
  updatedAt: '2026-07-23T10:00:00Z',
  url: 'https://github.com/owner/repo/pull/12',
  reviewDecision: 'APPROVED',
};

describe('parsePullRequestList', () => {
  it('parses gh pr list JSON output', () => {
    const [first] = parsePullRequestList(JSON.stringify([summary]));
    expect(first).toEqual({
      number: 12, title: 'Add feature', state: 'OPEN', isDraft: false, author: 'octocat',
      headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-07-23T10:00:00Z',
      url: 'https://github.com/owner/repo/pull/12', reviewDecision: 'APPROVED',
    });
  });

  it('normalizes an empty reviewDecision to null and a missing author', () => {
    const [first] = parsePullRequestList(JSON.stringify([{ ...summary, reviewDecision: '', author: null }]));
    expect(first?.reviewDecision).toBeNull();
    expect(first?.author).toBe('unknown');
  });

  it('rejects output that is not JSON or not a list', () => {
    expect(() => parsePullRequestList('not json')).toThrow(/unexpected response/);
    expect(() => parsePullRequestList('{}')).toThrow(/unexpected response/);
    expect(() => parsePullRequestList(JSON.stringify([{ ...summary, number: 'x' }]))).toThrow(/unexpected response/);
    expect(() => parsePullRequestList(JSON.stringify([{ ...summary, state: 'WEIRD' }]))).toThrow(/unexpected response/);
  });
});

describe('parsePullRequestDetails', () => {
  it('parses gh pr view JSON output', () => {
    const details = parsePullRequestDetails(JSON.stringify({ ...summary, body: 'Description', additions: 10, deletions: 2, changedFiles: 3 }));
    expect(details.body).toBe('Description');
    expect(details.additions).toBe(10);
    expect(details.deletions).toBe(2);
    expect(details.changedFiles).toBe(3);
  });

  it('defaults missing counters to zero', () => {
    const details = parsePullRequestDetails(JSON.stringify({ ...summary, body: null, additions: -1 }));
    expect(details.body).toBe('');
    expect(details.additions).toBe(0);
  });
});

describe('parseCreatedPullRequestUrl', () => {
  it('extracts the URL and number printed by gh pr create', () => {
    const stdout = 'Creating pull request for feature into main in owner/repo\n\nhttps://github.com/owner/repo/pull/42\n';
    expect(parseCreatedPullRequestUrl(stdout)).toEqual({ url: 'https://github.com/owner/repo/pull/42', number: 42 });
  });

  it('returns null when no PR URL is present', () => {
    expect(parseCreatedPullRequestUrl('something went wrong')).toBeNull();
  });
});
