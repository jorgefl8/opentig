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

/**
 * The id a repository has now, following each relocation the page heard of; `id` itself otherwise.
 * An id that names a saved repository (`saved`) is its own, even if a repository it once named moved.
 */
export function relocatedId(relocations: ReadonlyMap<string, string>, id: string, saved: (repositoryId: string) => boolean): string {
  let current = id;
  const seen = new Set<string>();
  while (relocations.has(current) && !saved(current) && !seen.has(current)) {
    seen.add(current);
    current = relocations.get(current)!;
  }
  return current;
}

/** Drops the relocations whose old id names a saved repository again. */
export function forgetReusedIds(relocations: Map<string, string>, saved: (repositoryId: string) => boolean): void {
  for (const previousId of [...relocations.keys()]) if (saved(previousId)) relocations.delete(previousId);
}

/** Times the page opens again what it shows to agree with the server before it gives up. */
export const MAX_REOPENS = 3;

/**
 * Counts the page's attempts to open again what it shows while the server has it elsewhere, so a
 * repository that can't be opened is not asked for without end: `try` while attempts remain, then
 * `give-up` once, then `stop`. A new pair of repositories, or agreeing, starts over.
 */
export class ReopenAttempts {
  private key = '';
  private count = 0;

  next(shownId: string, serverId: string): 'try' | 'give-up' | 'stop' {
    const key = `${shownId}\0${serverId}`;
    if (key !== this.key) {
      this.key = key;
      this.count = 0;
    }
    this.count += 1;
    if (this.count <= MAX_REOPENS) return 'try';
    return this.count === MAX_REOPENS + 1 ? 'give-up' : 'stop';
  }

  reset(): void {
    this.key = '';
    this.count = 0;
  }
}
