import type { CommitAuthorship } from '@shared/commit-authorship';

/** Git falls back to an identity guessed from the host name, which remotes reject. */
export function needsIdentity(authorship: CommitAuthorship): boolean {
  return !authorship.author || !authorship.committer || authorship.source === 'unset' || authorship.source === 'inferred';
}

/** Joins a folder name using the separator the server path already uses. */
export function joinFolder(parent: string, name: string): string {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.replace(/[\\/]+$/, '') + separator + name;
}
