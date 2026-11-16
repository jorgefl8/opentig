import { createElement } from 'react';
import { IconArrowUp } from '@tabler/icons-react';
import type { PullResult, PushResult } from '../../../shared/contracts';
import type { SileoOptions } from 'sileo';
import { SyncToastBody, type SyncToastAction } from './SyncToastBody';

export type ProjectSyncAction = 'pull' | 'push';

export interface RepositorySyncCounts {
  ahead: number;
  behind: number;
  branch?: string | null;
  detached?: boolean;
  upstream?: string | null;
  unborn?: boolean;
  readOnly?: boolean;
  operation?: string | null;
}

/** What a repository's own status says of its sync state, with the counts as of its last fetch. */
export function syncCountsOf(status: Required<RepositorySyncCounts>): Required<RepositorySyncCounts> {
  return {
    ahead: status.ahead, behind: status.behind, branch: status.branch, detached: status.detached,
    upstream: status.upstream, unborn: status.unborn, readOnly: status.readOnly, operation: status.operation,
  };
}

/**
 * The counts after a repository's fetch failed. The open repository keeps what its
 * status says, which needs no fetch, so its Pull and Push stay on offer; of any
 * other repository nothing is known, and it offers neither.
 */
export function countsAfterFailedFetch(
  counts: ReadonlyMap<string, RepositorySyncCounts>,
  repositoryId: string,
  open: { repositoryId: string; status: Required<RepositorySyncCounts> | null },
): Map<string, RepositorySyncCounts> {
  const next = new Map(counts);
  if (open.repositoryId === repositoryId && open.status) next.set(repositoryId, syncCountsOf(open.status));
  else next.delete(repositoryId);
  return next;
}

let nextSyncToastId = 0;

/** Isolate each operation from other notices and pending Sileo exit timers. */
export function repositorySyncLoadingToast(repositoryId: string, action: ProjectSyncAction, title: string): SileoOptions & { id: string } {
  return { id: `repository-sync:${repositoryId}:${action}:${++nextSyncToastId}`, title };
}

export function needsBranchPublication(status: RepositorySyncCounts | null | undefined): boolean {
  return Boolean(status?.branch && status.upstream === null && !status.detached && !status.unborn);
}

/** Only pending operations are visible; an in-flight operation stays visible. */
export function visibleRepositorySyncActions(counts: RepositorySyncCounts | undefined, running?: ProjectSyncAction): ProjectSyncAction[] {
  if (running) return [running];
  if (!counts) return [];
  return [
    ...(counts.behind > 0 ? ['pull' as const] : []),
    ...(counts.ahead > 0 || needsBranchPublication(counts) ? ['push' as const] : []),
  ];
}

export type SyncPill = { action: 'pull' | 'push'; count: number } | { action: 'publish' };

/**
 * The single sync action a phone's top bar offers, when it can run. Pulling comes first
 * because a push would be refused until it's done; the other one stays in the repository sheet.
 */
export function mobileSyncPill(status: RepositorySyncCounts | null | undefined): SyncPill | null {
  if (!status || status.readOnly || status.detached || status.unborn) return null;
  if (status.upstream && status.behind > 0) return { action: 'pull', count: status.behind };
  if (needsBranchPublication(status)) return { action: 'publish' };
  return status.ahead > 0 ? { action: 'push', count: status.ahead } : null;
}

export interface ProjectSyncToastCopy {
  title: string;
  description?: string;
  duration?: number | null;
}

export function projectPullSuccessCopy(repository: string, result: Extract<PullResult, { status: 'success' | 'up-to-date' }>): ProjectSyncToastCopy {
  if (result.status === 'up-to-date') return { title: `${repository} is already up to date` };
  return {
    title: `${repository}: ${result.commits} ${result.commits === 1 ? 'commit pulled' : 'commits pulled'}`,
    ...pullSuccessDetails(result),
  };
}

export function pullSuccessCopy(result: Extract<PullResult, { status: 'success' | 'up-to-date' }>): ProjectSyncToastCopy {
  if (result.status === 'up-to-date') return { title: 'Branch is already up to date' };
  return {
    title: `${result.commits} ${result.commits === 1 ? 'commit pulled' : 'commits pulled'}`,
    ...pullSuccessDetails(result),
  };
}

function pullSuccessDetails(result: Extract<PullResult, { status: 'success' }>): { description?: string } {
  const parts: string[] = [];
  if (result.rebased && result.localCommits > 0) {
    parts.push(result.localCommits === 1
      ? 'Your local commit was kept on top and is ready to push.'
      : `Your ${result.localCommits} local commits were kept on top and are ready to push.`);
  }
  if (result.restoredLocalChanges) parts.push('Local and staged changes were restored.');
  return parts.length > 0 ? { description: parts.join(' ') } : {};
}

export function projectPullBlockedCopy(repository: string, result: Exclude<PullResult, { status: 'success' | 'up-to-date' }>): ProjectSyncToastCopy {
  if (result.status === 'blocked-conflicts') return { title: `Could not pull ${repository}`, description: `${result.files.length} pending ${result.files.length === 1 ? 'conflict' : 'conflicts'} must be resolved.`, duration: 10_000 };
  if (result.status === 'blocked-operation') return { title: `Could not pull ${repository}`, description: `Finish or cancel ${result.operation} first.`, duration: 10_000 };
  if (result.status === 'no-upstream') return { title: `Could not pull ${repository}`, description: 'Current branch has no upstream configured.', duration: 10_000 };
  if (result.status === 'diverged') return { title: `Could not pull ${repository}`, description: `Branch is ${result.ahead} ahead and ${result.behind} behind.`, duration: 10_000 };
  if (result.status === 'rebase-conflict') return { title: `Could not pull ${repository}`, description: result.files.length > 0 ? `Your local commits overlap the remote changes in ${result.files.length === 1 ? result.files[0] : `${result.files.length} files`}. The branch was left unchanged.` : 'Your local commits overlap the remote changes. The branch was left unchanged.', duration: 10_000 };
  if (result.status === 'stash-conflict') return { title: result.updated ? `${repository} updated with local conflicts` : `Could not restore ${repository}`, description: 'Safety stash was preserved. Resolve conflicts before continuing.', duration: 12_000 };
  return {
    title: `Could not restore ${repository}`,
    description: result.recoveredChanges ? 'Some local changes were recovered; safety stash was preserved.' : 'Worktree remains clean; safety stash was preserved.',
    duration: 12_000,
  };
}

/** A branch that tracked an upstream with another name, published under its own name. */
export function newBranchPublishedCopy(result: Extract<PushResult, { status: 'published' }>): ProjectSyncToastCopy {
  return { title: 'Branch published', description: `${result.branch} now tracks ${result.remote}/${result.branch}.` };
}

export function projectPushSuccessCopy(repository: string, result: Extract<PushResult, { status: 'success' | 'up-to-date' | 'published' }>): ProjectSyncToastCopy {
  if (result.status === 'published' && result.previousUpstream) return { ...newBranchPublishedCopy(result), title: `${repository}: branch published` };
  if (result.status === 'published') return { title: `${repository}: branch published`, description: `${result.remote}/${result.branch}` };
  return result.status === 'success'
    ? { title: `${repository}: ${result.commits} ${result.commits === 1 ? 'commit pushed' : 'commits pushed'}` }
    : { title: `${repository}: no commits pending push` };
}

type BlockedPush = Exclude<PushResult, { status: 'success' | 'up-to-date' | 'published' }>;

/** What a notice about a push that did not happen says and offers. */
export interface PushBlockedCopy extends ProjectSyncToastCopy {
  /** The sentence that says what happened, shown stronger than the description. */
  lead?: string;
  /** Git's own words and the branch's position; only shown on request. */
  details?: string;
  /**
   * What the notice offers: `sync` pulls and then pushes, or only pulls; `pull`
   * when there is nothing to push yet; `access` reviews the account of the repository.
   */
  action?: 'sync' | 'pull' | 'access' | 'conflicts';
  /** Something to do next rather than a failure. */
  offer?: boolean;
}

const commitCount = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`;

/** Why Git refused a push, for the reasons that need no words from the server. */
const PUSH_REJECTION: Record<Extract<BlockedPush, { status: 'rejected' }>['reason'], string> = {
  authentication: 'OpenTig could not sign in to the remote. Check the account or credentials this repository uses.',
  inaccessible: 'The remote repository was not found, or this account cannot see it.',
  permission: 'This account is not allowed to push to this repository.',
  'remote-changed': 'Your commits have to go on top of them before they can be pushed.',
  'destination-exists': 'The remote already has a branch with this name and other commits. OpenTig won\'t overwrite it.',
  hook: 'The remote declined this push. A branch rule or a check on the server is blocking it.',
  network: 'Could not reach the remote. Check your connection and try again.',
  configuration: 'Review how this branch is set up to push in Git, then try again.',
  unknown: 'Git could not complete the push.',
};

/**
 * The notice for a push that did not happen, for the open repository and for a
 * repository of a project alike. Git's own output never goes in the body.
 */
export function pushBlockedCopy(repository: string, result: BlockedPush, options: { project?: boolean; upstream?: string | null } = {}): PushBlockedCopy {
  const title = options.project ? `Could not push ${repository}` : `${repository}: could not push commits`;
  const offerTitle = options.project ? `${repository} needs the latest commits first` : 'Push needs the latest commits first';
  if (result.status === 'remote-required') return options.project ? { title: `Choose a remote for ${repository}`, description: 'Select where to publish the branch.' } : { title: 'Choose a remote to publish the branch' };
  if (result.status === 'blocked-conflicts') return { title, description: `Resolve ${result.files.length === 1 ? 'the pending conflict' : `${result.files.length} pending conflicts`} before pushing.`, action: 'conflicts', duration: 10_000 };
  if (result.status === 'blocked-operation') return { title, description: `Finish or cancel ${result.operation} first.`, duration: 10_000 };
  if (result.status === 'no-upstream') return { title, description: 'Current branch has no upstream configured.', duration: 10_000 };
  if (result.status === 'diverged') {
    const upstream = result.upstream ?? options.upstream ?? 'The remote';
    const them = result.behind === 1 ? 'it' : 'them';
    const incoming = result.incoming ?? [];
    const details = [
      result.details,
      `This branch is ${result.behind} behind and ${result.ahead} ahead of ${upstream === 'The remote' ? 'its upstream' : upstream}.`,
      ...incoming.map((commit) => `incoming: ${commit}`),
      ...(result.behind > incoming.length && incoming.length > 0 ? [`and ${result.behind - incoming.length} more`] : []),
    ].filter(Boolean).join('\n');
    return {
      title: offerTitle,
      lead: `${upstream} has ${commitCount(result.behind)} you don't have.`,
      description: result.ahead === 0 ? `Pull ${them} first. There is nothing to push yet.`
        : result.ahead === 1 ? `Your commit has to go on top of ${them} before it can be pushed.`
        : `Your ${result.ahead} commits have to go on top of ${them} before they can be pushed.`,
      details, action: result.ahead === 0 ? 'pull' : 'sync', offer: true, duration: 15_000,
    };
  }
  const details = result.details ? { details: result.details } : {};
  if (result.reason === 'remote-changed') {
    return { title: offerTitle, lead: `${options.upstream ?? 'The remote'} has commits you don't have.`, description: PUSH_REJECTION[result.reason], ...details, action: 'sync', offer: true, duration: 15_000 };
  }
  const access = result.reason === 'authentication' || result.reason === 'inaccessible' || result.reason === 'permission';
  return { title, description: result.message || PUSH_REJECTION[result.reason], ...details, ...(access ? { action: 'access' as const } : {}), duration: 10_000 };
}

/** One notice for a pull followed by a push. */
export function pullAndPushSuccessCopy(
  repository: string | null,
  pulled: Extract<PullResult, { status: 'success' | 'up-to-date' }>,
  pushed: Extract<PushResult, { status: 'success' | 'up-to-date' | 'published' }> | null,
): ProjectSyncToastCopy {
  const pushedAlone = !pushed ? 'Publication canceled'
    : pushed.status === 'success' ? `${commitCount(pushed.commits)} pushed`
    : pushed.status === 'published' ? 'Branch published'
    : 'No commits pending push';
  const summary = pulled.status === 'up-to-date' ? pushedAlone
    : `Pulled ${commitCount(pulled.commits)}${!pushed ? '; publication canceled'
      : pushed.status === 'success' ? ` and pushed ${pushed.commits}`
      : pushed.status === 'published' ? ' and published the branch'
      : '; nothing left to push'}`;
  return {
    title: repository ? `${repository}: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}` : summary,
    ...(pulled.status === 'success' && pulled.restoredLocalChanges ? { description: 'Local and staged changes were restored.' } : {}),
  };
}

/** A pull that stopped before the push it was meant to prepare. */
export function nothingPushedCopy<Copy extends object>(copy: Copy): Copy & { description: string } {
  const description = (copy as { description?: unknown }).description;
  return { ...copy, description: typeof description === 'string' ? `${description} Nothing was pushed.` : 'Nothing was pushed.' };
}

/**
 * The Sileo notice for a push that did not happen. A plain message with at most
 * one action keeps Sileo's own layout; anything more goes in the notice body.
 */
export function syncToast(copy: PushBlockedCopy, actions: SyncToastAction[] = []): SileoOptions {
  const { title, lead, description, details, offer, duration } = copy;
  const plain = !lead && !details && actions.length < 2;
  return {
    title,
    ...(duration === undefined ? {} : { duration }),
    ...(plain
      ? { ...(description ? { description } : {}), ...(actions[0] ? { button: actions[0] } : {}) }
      // The actions stay on screen for as long as the notice does.
      : { description: createElement(SyncToastBody, { lead, description, details, actions, offer }), ...(duration ? { autopilot: { collapse: duration } } : {}) }),
    ...(offer ? { icon: createElement(IconArrowUp, { size: 16, stroke: 2, 'aria-hidden': true }), styles: { title: 'sync-toast-offer', badge: 'sync-toast-offer' } } : {}),
  };
}
