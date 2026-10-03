import { describe, expect, it } from 'vitest';
import { folderBreadcrumbs, folderName, parentFolderPath, sameFolder } from './directory-navigation';

describe('backend folder navigation from any browser OS', () => {
  it.each([
    ['/workspace/team/repo', ['/','/workspace','/workspace/team','/workspace/team/repo']],
    ['C:\\Projects\\repo', ['C:\\','C:\\Projects','C:\\Projects\\repo']],
    ['D:/Projects/repo', ['D:/','D:/Projects','D:/Projects/repo']],
    ['\\\\server\\share\\team\\repo', ['\\\\server\\share','\\\\server\\share\\team','\\\\server\\share\\team\\repo']],
  ])('builds navigable breadcrumbs for %s', (path, expected) => {
    expect(folderBreadcrumbs(path).map(crumb => crumb.path)).toEqual(expected);
    expect(folderName(path)).toBe('repo');
    expect(parentFolderPath(path)).toBe(expected.at(-2));
  });
  it.each(['/', 'C:\\', 'D:/', '\\\\server\\share'])('stops at root %s', path => {
    expect(parentFolderPath(path)).toBeNull();
  });
  it('matches Windows paths without conflating case-sensitive Unix folders', () => {
    expect(sameFolder('C:\\Projects\\Repo\\','c:/projects/repo')).toBe(true);
    expect(sameFolder('\\\\SERVER\\Share','//server/share/')).toBe(true);
    expect(sameFolder('/workspace/Repo','/workspace/repo')).toBe(false);
  });
});
