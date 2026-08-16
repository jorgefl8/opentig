import { describe, expect, it } from 'vitest';
import { parseCreatedPullRequestUrl, parsePullRequestDetails, parsePullRequestList, selectPullRequestsNewestFirst, sortPullRequestsNewestFirst } from './PullRequestParser';

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
  additions: 10,
  deletions: 2,
  statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }],
};

describe('parsePullRequestList', () => {
  it('parses gh pr list JSON output', () => {
    const [first] = parsePullRequestList(JSON.stringify([summary]));
    expect(first).toEqual({
      number: 12, title: 'Add feature', state: 'OPEN', isDraft: false, author: 'octocat',
      authorAvatarUrl: 'https://github.com/octocat.png?size=40',
      headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-07-23T10:00:00Z',
      url: 'https://github.com/owner/repo/pull/12', reviewDecision: 'APPROVED',
      additions: 10, deletions: 2, checksState: 'PASSING',
    });
  });

  it('normalizes an empty reviewDecision to null and a missing author', () => {
    const [first] = parsePullRequestList(JSON.stringify([{ ...summary, reviewDecision: '', author: null }]));
    expect(first?.reviewDecision).toBeNull();
    expect(first?.author).toBe('unknown');
    expect(first?.authorAvatarUrl).toBeNull();
  });

  it('derives bot avatars and summarizes failing and pending checks', () => {
    const [failing] = parsePullRequestList(JSON.stringify([{ ...summary, author: { login: 'app/dependabot', is_bot: true }, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }]));
    const [pending] = parsePullRequestList(JSON.stringify([{ ...summary, statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] }]));
    expect(failing?.authorAvatarUrl).toBe('https://avatars.githubusercontent.com/in/29110?s=40&v=4');
    expect(failing?.checksState).toBe('FAILING');
    expect(pending?.checksState).toBe('PENDING');
  });

  it('rejects output that is not JSON or not a list', () => {
    expect(() => parsePullRequestList('not json')).toThrow(/unexpected response/);
    expect(() => parsePullRequestList('{}')).toThrow(/unexpected response/);
    expect(() => parsePullRequestList(JSON.stringify([{ ...summary, number: 'x' }]))).toThrow(/unexpected response/);
    expect(() => parsePullRequestList(JSON.stringify([{ ...summary, state: 'WEIRD' }]))).toThrow(/unexpected response/);
  });
});

describe('sortPullRequestsNewestFirst', () => {
  it('orders every PR state by updated date without mutating the source list', () => {
    const pulls = parsePullRequestList(JSON.stringify([
      { ...summary, number: 1, state: 'OPEN', updatedAt: '2026-07-20T10:00:00Z' },
      { ...summary, number: 2, state: 'CLOSED', updatedAt: '2026-07-22T10:00:00Z' },
      { ...summary, number: 3, state: 'MERGED', updatedAt: '2026-07-23T10:00:00Z' },
      { ...summary, number: 4, state: 'CLOSED', updatedAt: 'invalid' },
    ]));

    expect(sortPullRequestsNewestFirst(pulls).map((pull) => pull.number)).toEqual([3, 2, 1, 4]);
    expect(pulls.map((pull) => pull.number)).toEqual([1, 2, 3, 4]);
  });
});

describe('selectPullRequestsNewestFirst', () => {
  it('removes merged PRs leaked by the closed query and deduplicates combined results', () => {
    const pulls = parsePullRequestList(JSON.stringify([
      { ...summary, number: 15, state: 'MERGED', updatedAt: '2026-07-24T10:00:00Z' },
      { ...summary, number: 14, state: 'CLOSED', updatedAt: '2026-07-23T10:00:00Z' },
      { ...summary, number: 15, state: 'MERGED', updatedAt: '2026-07-24T10:00:00Z' },
    ]));

    expect(selectPullRequestsNewestFirst(pulls, ['CLOSED']).map((pull) => pull.number)).toEqual([14]);
    expect(selectPullRequestsNewestFirst(pulls, ['CLOSED', 'MERGED']).map((pull) => pull.number)).toEqual([15, 14]);
  });
});

describe('parsePullRequestDetails', () => {
  it('parses gh pr view JSON output', () => {
    const details = parsePullRequestDetails(JSON.stringify({
      ...summary,
      body: 'Description',
      changedFiles: 3,
      labels: [{ name: 'bug', color: 'd73a4a' }],
      commits: [{ oid: 'a'.repeat(40), messageHeadline: 'Fix issue', authoredDate: '2026-07-23T09:00:00Z', authors: [{ login: 'octocat', name: 'The Octocat' }] }],
    }));
    expect(details.body).toBe('Description');
    expect(details.additions).toBe(10);
    expect(details.deletions).toBe(2);
    expect(details.changedFiles).toBe(3);
    expect(details.labels).toEqual([{ name: 'bug', color: 'd73a4a' }]);
    expect(details.commits[0]).toEqual({
      oid: 'a'.repeat(40), messageHeadline: 'Fix issue', authoredAt: '2026-07-23T09:00:00Z',
      author: 'The Octocat', authorAvatarUrl: 'https://github.com/octocat.png?size=40',
    });
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
