import type { RecentRepository, RepositoryInfo, RepositoryProject } from '../../../shared/contracts';
import { normalizeRepositoryKey } from '../../../shared/repository-projects';

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
function normalizedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function shortenRepositoryPath(rootPath: string, maxSegments = 3): string {
  const normalized = normalizedPath(rootPath);
  const segments = normalized.split('/');
  return segments.length > maxSegments ? `…/${segments.slice(-maxSegments).join('/')}` : normalized;
}

/** True when this picker row's pull/push target is a linked worktree, not the repository root. */
export function isLinkedWorktree(option: RepositoryOption): boolean {
  return normalizedPath(option.recent.path).toLocaleLowerCase() !== normalizedPath(option.rootPath).toLocaleLowerCase();
}

/** Folder name of the worktree this picker row will pull or push. */
export function repositoryWorktreeLabel(option: RepositoryOption): string {
  const folder = normalizedPath(option.recent.path).split('/').pop();
  return folder && folder.length > 0 ? folder : option.name;
}

export function formatRepositoryCheckout(
  option: RepositoryOption,
  checkout?: { branch: string | null; detached: boolean },
): string {
  const branchLabel = checkout
    ? (checkout.detached || !checkout.branch ? 'Detached HEAD' : checkout.branch)
    : null;
  if (!isLinkedWorktree(option)) return branchLabel ?? '';
  const worktreeLabel = repositoryWorktreeLabel(option);
  return branchLabel ? `${branchLabel} · ${worktreeLabel}` : worktreeLabel;
}

export function buildRepositoryPickerModel(recent: RecentRepository[], projects: RepositoryProject[]): RepositoryPickerModel {
  const repositories = groupRecentRepositories(recent);
  const byKey = new Map(repositories.map((repository) => [repository.key, repository]));
  const assigned = new Set<string>();
  const projectSections = projects.flatMap((project) => {
    const projectRepositories = project.repositoryKeys.flatMap((rawKey) => {
      const key = normalizeRepositoryKey(rawKey);
      const repository = byKey.get(key);
      if (!repository || assigned.has(key)) return [];
      assigned.add(key);
      return [repository];
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
  openedAt = new Date().toISOString(),
): RecentRepository[] {
  const touched = { ...repository, lastOpenedAt: openedAt };
  return recent.some((item) => item.id === repository.id)
    ? recent.map((item) => item.id === repository.id ? touched : item)
    : [...recent, touched];
}
