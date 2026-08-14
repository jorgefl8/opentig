import type { RecentRepository, RepositoryInfo, RepositoryProject } from '../../../shared/contracts';
import { normalizeRepositoryKey, UNASSIGNED_RECENT_LIMIT } from '../../../shared/repository-projects';

export interface RepositoryOption {
  key: string;
  name: string;
  rootPath: string;
  recent: RecentRepository;
}

export interface RepositorySection {
  id: string;
  name: string;
  repositories: RepositoryOption[];
}

export interface RepositoryPickerModel {
  repositories: RepositoryOption[];
  projectSections: RepositorySection[];
  unassigned: RepositoryOption[];
}

export function groupRecentRepositories(recent: RecentRepository[]): RepositoryOption[] {
  const groups = new Map<string, RepositoryOption>();
  for (const item of recent) {
    const key = normalizeRepositoryKey(item.commonDir);
    const rootPath = item.commonDir.replace(/[\\/]\.git[\\/]?$/i, '');
    const candidate = { key, name: item.repositoryName, rootPath, recent: item };
    const current = groups.get(key);
    if (!current || normalizeRepositoryKey(item.path) === normalizeRepositoryKey(rootPath)) groups.set(key, candidate);
  }
  return [...groups.values()];
}

// Absolute repository paths are far wider than the picker, and truncating them
// at the end hides the only informative part. Keep the deepest segments and mark
// the elision; the full path stays available in the row tooltip.
export function shortenRepositoryPath(rootPath: string, maxSegments = 3): string {
  const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/');
  return segments.length > maxSegments ? `…/${segments.slice(-maxSegments).join('/')}` : normalized;
}

export function buildRepositoryPickerModel(recent: RecentRepository[], projects: RepositoryProject[]): RepositoryPickerModel {
  const repositories = groupRecentRepositories(recent);
  const assigned = new Set<string>();
  const projectSections = projects.flatMap((project) => {
    const projectKeys = new Set(project.repositoryKeys.map(normalizeRepositoryKey));
    const projectRepositories = repositories.filter((repository) => {
      if (!projectKeys.has(repository.key) || assigned.has(repository.key)) return false;
      assigned.add(repository.key);
      return true;
    });
    return projectRepositories.length > 0 ? [{ id: project.id, name: project.name, repositories: projectRepositories }] : [];
  });
  return { repositories, projectSections, unassigned: repositories.filter((repository) => !assigned.has(repository.key)) };
}

/** Matches the top-to-bottom order rendered by the repository picker. */
export function getRepositoryPickerDisplayOrder(model: RepositoryPickerModel): RepositoryOption[] {
  return [...model.projectSections.flatMap((section) => section.repositories), ...model.unassigned];
}

export function touchRecentRepositories(
  recent: RecentRepository[],
  repository: RepositoryInfo,
  projects: RepositoryProject[],
  openedAt = new Date().toISOString(),
): RecentRepository[] {
  const touched = { ...repository, lastOpenedAt: openedAt };
  const candidates = [touched, ...recent.filter((item) => item.id !== repository.id)];
  const assigned = new Set(projects.flatMap((project) => project.repositoryKeys.map(normalizeRepositoryKey)));
  let unassigned = 0;
  return candidates.filter((item) => {
    if (item.id === repository.id || assigned.has(normalizeRepositoryKey(item.commonDir))) return true;
    unassigned += 1;
    return unassigned <= UNASSIGNED_RECENT_LIMIT;
  });
}
