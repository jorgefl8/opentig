import type { BranchInfo, RepositoryStatus } from '../../../shared/git-types';

/**
 * A commit's id as Git abbreviates it, so it is one Git accepts: Git's own
 * abbreviation of that very commit where one is known, `own` or a branch tip's on
 * it, which Git lengthens where a shorter one would be ambiguous; otherwise as long
 * as the longest Git uses in this repository, as its branch tips show, never under 7.
 */
export function shortCommitId(oid: string, branches: readonly Pick<BranchInfo, 'oid' | 'shortOid'>[], own?: string | null): string {
  if (own && oid.startsWith(own)) return own;
  const tip = branches.find((branch) => branch.oid === oid && branch.shortOid);
  if (tip) return tip.shortOid;
  return oid.slice(0, Math.max(7, ...branches.map((branch) => branch.shortOid.length)));
}

/** Where a detached HEAD is, by its short commit id; "Detached HEAD" when the commit isn't known. */
export function detachedHeadLabel(oid: string | null | undefined, branches: readonly Pick<BranchInfo, 'oid' | 'shortOid'>[]): string {
  return oid ? `Detached at ${shortCommitId(oid, branches)}` : 'Detached HEAD';
}

export interface DetachedHead {
  label: string;
  shortOid: string | null;
  /** The commit's title, known only when a branch's tip is that commit. */
  subject: string | null;
  /** Branches whose tip is HEAD's commit, local ones first. */
  branches: string[];
}

/**
 * What a detached HEAD is on, from the branch list the client already has, so
 * no new read: the branches whose tip is that commit, and through them its title.
 * Tags aren't in that list, so they aren't named.
 */
export function describeDetachedHead(status: Pick<RepositoryStatus, 'detached' | 'oid'> | null | undefined, branches: readonly BranchInfo[]): DetachedHead | null {
  if (!status?.detached) return null;
  const oid = status.oid;
  // A remote's HEAD only names its default branch, which is listed on its own.
  const matches = oid ? branches.filter((branch) => branch.oid === oid && !(branch.remote && branch.fullName.endsWith('/HEAD'))) : [];
  const ordered = [...matches.filter((branch) => !branch.remote), ...matches.filter((branch) => branch.remote)];
  const shortOid = oid ? shortCommitId(oid, branches) : null;
  return {
    label: detachedHeadLabel(oid, branches),
    shortOid,
    subject: ordered.find((branch) => branch.subject)?.subject ?? null,
    branches: ordered.map((branch) => branch.name),
  };
}

/** The checkout as the toolbar names it: the branch, or the commit a detached HEAD is on. */
export function checkoutLabel(status: Pick<RepositoryStatus, 'branch' | 'detached' | 'oid'> | null | undefined, branches: readonly BranchInfo[]): string {
  if (status?.branch && !status.detached) return status.branch;
  return describeDetachedHead(status, branches)?.label ?? status?.branch ?? 'Detached HEAD';
}
