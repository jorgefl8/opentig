import { describe, expect, it } from 'vitest';
import { parseRepositoryLink, repositoryLinkLabel, repositoryLinkUrl } from './repository-links';

const sha = 'a'.repeat(40);

describe('parseRepositoryLink', () => {
  it.each([
    ['https://github.com/sample/demo/pull/65', { kind: 'pull', number: 65 }],
    ['https://github.com/Sample/Demo/pull/65/files#diff-1', { kind: 'pull', number: 65 }],
    ['https://github.com/sample/demo/pull/65#issuecomment-1', { kind: 'pull', number: 65 }],
    [`https://github.com/sample/demo/commit/${sha.toUpperCase()}`, { kind: 'commit', oid: sha }],
    ['https://github.com/sample/demo/releases/tag/v1.2.3', { kind: 'release', tag: 'v1.2.3' }],
    ['https://github.com/sample/demo/releases/tag/app%2Fv1', { kind: 'release', tag: 'app/v1' }],
  ])('opens %s in OpenTig', (href, target) => {
    expect(parseRepositoryLink(href, 'sample/demo')).toEqual(target);
  });

  it.each([
    ['another repository', 'https://github.com/other/demo/pull/65'],
    ['another host', 'https://example.com/sample/demo/pull/65'],
    ['plain HTTP', 'http://github.com/sample/demo/pull/65'],
    ['a short hash, which the commit viewer cannot take', 'https://github.com/sample/demo/commit/881261e'],
    ['a compare view', 'https://github.com/sample/demo/compare/v1...v2'],
    ['an issue', 'https://github.com/sample/demo/issues/3'],
    ['the release list', 'https://github.com/sample/demo/releases'],
    ['a pull request number that is not one', 'https://github.com/sample/demo/pull/0'],
    ['broken escapes', 'https://github.com/sample/demo/releases/tag/%E0%A4%A'],
    ['not a URL', 'pull/65'],
  ])('leaves %s to the browser', (_name, href) => {
    expect(parseRepositoryLink(href, 'sample/demo')).toBeNull();
  });

  it('builds the GitHub link back, and names what it is', () => {
    expect(repositoryLinkUrl('sample/demo', { kind: 'pull', number: 87 })).toBe('https://github.com/sample/demo/pull/87');
    expect(repositoryLinkUrl('sample/demo', { kind: 'release', tag: 'app/v1 beta' })).toBe('https://github.com/sample/demo/releases/tag/app/v1%20beta');
    expect(repositoryLinkLabel({ kind: 'commit', oid: sha })).toBe('Commit aaaaaaa');
  });
});
