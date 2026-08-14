import { describe, expect, it } from 'vitest';
import { parseGitHubRemote } from './GitHubRemoteParser';

describe('parseGitHubRemote', () => {
  it.each([
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo/', 'owner/repo'],
    ['https://user@github.com/owner/repo.git', 'owner/repo'],
    ['http://github.com/owner/repo.git', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['git@github.com:owner/repo', 'owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'owner/repo'],
    ['ssh://git@github.com:22/owner/repo.git', 'owner/repo'],
    ['git://github.com/owner/repo.git', 'owner/repo'],
    ['https://github.com/My-Org/some.repo-name.git', 'My-Org/some.repo-name'],
    ['  https://github.com/owner/repo.git \n', 'owner/repo'],
  ])('accepts %s', (url, expected) => {
    expect(parseGitHubRemote(url)).toEqual({ nameWithOwner: expected });
  });

  it.each([
    '',
    '   ',
    'https://gitlab.com/owner/repo.git',
    'git@gitlab.com:owner/repo.git',
    'https://github.com.evil.com/owner/repo.git',
    'https://evil.com/github.com/owner/repo.git',
    'https://github.com/owner',
    'https://github.com/owner/repo/extra',
    'git@github.com:owner',
    'https://github.com/-bad/repo.git',
    'https://github.com/owner/..',
    'C:\\repos\\local',
    '/srv/git/repo.git',
  ])('rejects %s', (url) => {
    expect(parseGitHubRemote(url)).toBeNull();
  });
});
