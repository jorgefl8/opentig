import { describe, expect, it } from 'vitest';
import type { RecentRepository, RepositoryProject } from '../../../shared/contracts';
import { buildRepositoryPickerModel, getRepositoryPickerDisplayOrder, groupRecentRepositories, shortenRepositoryPath, touchRecentRepositories } from './repository-select-model';

function recent(id: string, commonDir = `C:\\repos\\${id}\\.git`, path = `C:\\repos\\${id}`): RecentRepository {
  return { id, name: id, repositoryName: id, path, commonDir, lastOpenedAt: '2026-01-01T00:00:00.000Z' };
}

describe('repository select model', () => {
  it('collapses worktrees and prefers the repository root', () => {
    const linked = recent('linked', 'C:\\repos\\main\\.git', 'C:\\worktrees\\linked');
    const root = recent('root', 'C:\\repos\\main\\.git', 'C:\\repos\\main');
    expect(groupRecentRepositories([linked, root])).toEqual([
      expect.objectContaining({ key: 'c:/repos/main/.git', recent: root }),
    ]);
  });

  it('builds ordered non-empty projects and an unassigned section', () => {
    const repositories = [recent('one'), recent('two'), recent('three')];
    const projects: RepositoryProject[] = [
      { id: 'empty', name: 'Empty', repositoryKeys: [] },
      { id: 'client', name: 'Client', repositoryKeys: ['C:\\repos\\two\\.git', 'c:/repos/one/.git'] },
    ];
    const model = buildRepositoryPickerModel(repositories, projects);
    expect(model.projectSections.map((section) => section.name)).toEqual(['Client']);
    expect(model.projectSections[0]?.repositories.map((item) => item.recent.id)).toEqual(['one', 'two']);
    expect(model.unassigned.map((item) => item.recent.id)).toEqual(['three']);
  });

  it('keeps the deepest segments when shortening a repository path', () => {
    expect(shortenRepositoryPath('C:\\Users\\dev\\Desktop\\justgit')).toBe('…/dev/Desktop/justgit');
    expect(shortenRepositoryPath('/home/dev/justgit/')).toBe('…/home/dev/justgit');
    expect(shortenRepositoryPath('C:\\repos\\one')).toBe('C:/repos/one');
  });

  it('exposes the same numbered order shown in the picker', () => {
    const repositories = [recent('one'), recent('two'), recent('three'), recent('four')];
    const projects: RepositoryProject[] = [
      { id: 'client', name: 'Client', repositoryKeys: [repositories[1]!.commonDir, repositories[3]!.commonDir] },
    ];
    const model = buildRepositoryPickerModel(repositories, projects);
    expect(getRepositoryPickerDisplayOrder(model).map((item) => item.recent.id)).toEqual(['two', 'four', 'one', 'three']);
  });

  it('retains assigned repositories beyond the unassigned recent limit', () => {
    const repositories = Array.from({ length: 12 }, (_, index) => recent(`repo-${index}`));
    const projects: RepositoryProject[] = [{ id: 'saved', name: 'Saved', repositoryKeys: [repositories[11]!.commonDir] }];
    const selected = recent('new');
    const next = touchRecentRepositories(repositories, selected, projects, '2026-08-03T00:00:00.000Z');
    expect(next[0]?.id).toBe('new');
    expect(next.some((item) => item.id === 'repo-11')).toBe(true);
    expect(next.some((item) => item.id === 'repo-10')).toBe(false);
  });
});
