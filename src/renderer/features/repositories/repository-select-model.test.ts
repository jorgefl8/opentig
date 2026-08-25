import { describe, expect, it } from 'vitest';
import type { RecentRepository, RepositoryProject } from '../../../shared/contracts';
import { buildRepositoryPickerModel, formatRepositoryCheckout, getRepositoryPickerDisplayOrder, groupRecentRepositories, isLinkedWorktree, repositoryWorktreeLabel, shortenRepositoryPath, touchRecentRepositories } from './repository-select-model';

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
    expect(shortenRepositoryPath('C:\\Users\\dev\\Desktop\\opentig')).toBe('…/dev/Desktop/opentig');
    expect(shortenRepositoryPath('/home/dev/opentig/')).toBe('…/home/dev/opentig');
    expect(shortenRepositoryPath('C:\\repos\\one')).toBe('C:/repos/one');
  });

  it('labels worktrees by folder name', () => {
    const root = recent('root', 'C:\\repos\\opentig\\.git', 'C:\\repos\\opentig');
    const linked = recent('linked', 'C:\\repos\\opentig\\.git', 'C:\\worktrees\\hotfix');
    expect(repositoryWorktreeLabel({ key: 'c:/repos/opentig/.git', name: 'opentig', rootPath: 'C:\\repos\\opentig', recent: root })).toBe('opentig');
    expect(repositoryWorktreeLabel({ key: 'c:/repos/opentig/.git', name: 'opentig', rootPath: 'C:\\repos\\opentig', recent: linked })).toBe('hotfix');
  });

  it('treats the repository root as the primary worktree and other folders as linked', () => {
    const root = recent('root', 'C:\\repos\\opentig\\.git', 'C:\\repos\\opentig');
    const linked = recent('linked', 'C:\\repos\\opentig\\.git', 'C:\\worktrees\\hotfix');
    expect(isLinkedWorktree({ key: 'c:/repos/opentig/.git', name: 'opentig', rootPath: 'C:\\repos\\opentig', recent: root })).toBe(false);
    expect(isLinkedWorktree({ key: 'c:/repos/opentig/.git', name: 'opentig', rootPath: 'C:\\repos\\opentig', recent: linked })).toBe(true);
  });

  it('shows only the branch for the primary worktree, and branch plus folder for a linked worktree', () => {
    const root = recent('root', 'C:\\repos\\opentig\\.git', 'C:\\repos\\opentig');
    const linked = recent('linked', 'C:\\repos\\opentig\\.git', 'C:\\worktrees\\hotfix');
    const primary = { key: 'c:/repos/opentig/.git', name: 'opentig', rootPath: 'C:\\repos\\opentig', recent: root };
    const linkedOption = { key: 'c:/repos/opentig/.git', name: 'opentig', rootPath: 'C:\\repos\\opentig', recent: linked };
    expect(formatRepositoryCheckout(primary)).toBe('');
    expect(formatRepositoryCheckout(primary, { branch: 'feat/headless', detached: false })).toBe('feat/headless');
    expect(formatRepositoryCheckout(linkedOption)).toBe('hotfix');
    expect(formatRepositoryCheckout(linkedOption, { branch: 'feat/headless', detached: false })).toBe('feat/headless · hotfix');
    expect(formatRepositoryCheckout(linkedOption, { branch: null, detached: true })).toBe('Detached HEAD · hotfix');
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
