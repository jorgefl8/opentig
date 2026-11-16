/**
 * What a page does when the repository it shows is not the one the server has it on (see
 * `ConnectionRepository`), once no choice of repository is on its way. The page's repository wins
 * while OpenTig still has it: the server took the page elsewhere only because an open or a start-up
 * request it no longer stands by finished last, so the page opens again what it shows. Otherwise the
 * page goes where the server put it: off a removed worktree, onto a relocated repository's new id.
 */
export type RepositoryAgreement = 'agree' | 'reopen' | 'follow' | 'none';

export function repositoryAgreement(input: {
  /** The repository the page shows, or null. */
  shownId: string | null;
  /** The repository the server has the page on, or null when it has said nothing yet. */
  serverId: string | null;
  /** Whether OpenTig still has a repository and can open it. */
  known: (repositoryId: string) => boolean;
}): RepositoryAgreement {
  const { shownId, serverId, known } = input;
  if (!serverId || shownId === serverId) return 'agree';
  if (shownId && known(shownId)) return 'reopen';
  return known(serverId) ? 'follow' : 'none';
}

/** The id a repository has now, following each relocation the page heard of; `id` itself otherwise. */
export function relocatedId(relocations: ReadonlyMap<string, string>, id: string): string {
  let current = id;
  for (let step = 0; step < 100 && relocations.has(current); step += 1) current = relocations.get(current)!;
  return current;
}
