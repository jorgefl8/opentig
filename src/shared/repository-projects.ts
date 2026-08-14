export const MAX_REPOSITORY_PROJECTS = 50;
export const MAX_PROJECT_NAME_LENGTH = 60;
export const MAX_REPOSITORIES_PER_PROJECT = 200;
export const MAX_REPOSITORY_KEY_LENGTH = 2_048;
export const UNASSIGNED_RECENT_LIMIT = 10;

export function normalizeRepositoryKey(commonDir: string): string {
  return commonDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
