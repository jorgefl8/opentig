import type { PullResult } from '@shared/contracts';
import { serializedErrorFromReason } from '@shared/errors';
import { isUnconfirmedResult } from '@/lib/websocket-transport';
import type { RepositorySyncCounts } from './project-sync';

/** Repositories pulled at once by Pull all: as many as the list fetches at once. */
export const PULL_ALL_CONCURRENCY = 4;

/** Why Pull all left a repository as it was. */
export type PullAllSkip =
  | { reason: 'local-changes' }
  | { reason: 'diverged' }
  | { reason: 'conflicts' }
  | { reason: 'operation'; operation: string }
  | { reason: 'no-upstream' };

/** Where one repository of a Pull all run stands. */
export type PullAllRowState =
  | { phase: 'queued' }
  | { phase: 'running' }
  | { phase: 'pulled'; commits: number; keptLocalChanges: boolean }
  | { phase: 'up-to-date' }
  | ({ phase: 'skipped' } & PullAllSkip)
  | { phase: 'failed'; message: string }
  /** Stop came before its turn. */
  | { phase: 'not-pulled' };

export interface PullAllRun {
  /** The repositories in the run, in the order they were asked for. */
  repositoryIds: readonly string[];
  /** Each repository as its notices name it, such as `Platform · api-gateway`. */
  labels: Readonly<Record<string, string>>;
  rows: ReadonlyMap<string, PullAllRowState>;
  stopped: boolean;
  finished: boolean;
}

/**
 * Whether a row of the repository list goes into Pull all: commits to bring in and none of its
 * own, on a branch that tracks one, with nothing that already keeps its own Pull from running.
 * Local changes don't keep it out: the pull fast-forwards past them, or touches nothing.
 */
export function joinsPullAll(counts: RepositorySyncCounts | undefined, state: {
  /** A pull or push of the row is already running. */
  running: boolean;
  /** The row's folder is missing. */
  unavailable: boolean;
  /** The row is the open repository and the app is busy with it. */
  openAndBusy: boolean;
  /** What the run on screen did with the row, if anything. */
  previous?: PullAllRowState | undefined;
}): boolean {
  if (!counts || state.running || state.unavailable || state.openAndBusy) return false;
  // A repository a run just skipped would only be skipped again; its own Pull is the way on.
  if (state.previous?.phase === 'skipped') return false;
  return counts.behind > 0 && counts.ahead === 0 && Boolean(counts.upstream)
    && !counts.detached && !counts.unborn && !counts.readOnly && !counts.operation;
}

/** A run of every repository in `entries`, all waiting. */
export function startPullAll(entries: ReadonlyArray<{ id: string; label: string }>): PullAllRun {
  return {
    repositoryIds: entries.map((entry) => entry.id),
    labels: Object.fromEntries(entries.map((entry) => [entry.id, entry.label])),
    rows: new Map(entries.map((entry) => [entry.id, { phase: 'queued' } as const])),
    stopped: false,
    finished: false,
  };
}

export function withPullAllRow(run: PullAllRun, repositoryId: string, state: PullAllRowState): PullAllRun {
  return { ...run, rows: new Map(run.rows).set(repositoryId, state) };
}

/** Stop: repositories still waiting are not pulled; those already pulling finish, since a half-done merge is worse. */
export function stopPullAll(run: PullAllRun): PullAllRun {
  const rows = new Map(run.rows);
  for (const [id, state] of rows) if (state.phase === 'queued') rows.set(id, { phase: 'not-pulled' });
  return { ...run, rows, stopped: true };
}

/** No repository of the run is waiting or pulling any more. */
export function pullAllSettled(run: PullAllRun): boolean {
  return [...run.rows.values()].every((state) => state.phase !== 'queued' && state.phase !== 'running');
}

export function pullAllProgress(run: PullAllRun): { done: number; total: number } {
  const total = run.repositoryIds.length;
  return { done: [...run.rows.values()].filter((state) => state.phase !== 'queued' && state.phase !== 'running').length, total };
}

/** What a fast-forward-only pull's answer means for its row. */
export function pullAllOutcome(result: PullResult): PullAllRowState {
  switch (result.status) {
    case 'success': return { phase: 'pulled', commits: result.commits, keptLocalChanges: result.keptLocalChanges === true };
    case 'up-to-date': return { phase: 'up-to-date' };
    case 'blocked-local-changes': return { phase: 'skipped', reason: 'local-changes' };
    case 'diverged': return { phase: 'skipped', reason: 'diverged' };
    case 'blocked-conflicts': return { phase: 'skipped', reason: 'conflicts' };
    case 'blocked-operation': return { phase: 'skipped', reason: 'operation', operation: result.operation };
    case 'no-upstream': return { phase: 'skipped', reason: 'no-upstream' };
    // A fast-forward-only pull never rebases or stashes, so these don't come back from it.
    default: return { phase: 'failed', message: 'Could not pull' };
  }
}

/** A pull that failed outright, said in a few words: the remote's refusal or unreachability when that is what it was. */
export function pullAllFailure(reason: unknown): PullAllRowState {
  // The server stopped waiting; the pull may still finish, and the row's counts say so once read again.
  if (isUnconfirmedResult(reason)) return { phase: 'failed', message: 'No answer in time' };
  const detail = serializedErrorFromReason(reason);
  if (detail && 'access' in detail && detail.access) return { phase: 'failed', message: 'The remote refused access' };
  const message = detail?.message ?? (reason instanceof Error ? reason.message : '');
  if (/could not resolve host|could not read from remote|unable to access|connection (refused|timed out|reset)|network is unreachable|timed out|failed to connect/i.test(message)) {
    return { phase: 'failed', message: 'Couldn\'t reach the remote' };
  }
  return { phase: 'failed', message: 'Could not pull' };
}

const commits = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`;
const repositories = (count: number) => `${count} ${count === 1 ? 'repository' : 'repositories'}`;

/** The row's second line while the run's states show, in place of its branch; null keeps the branch. */
export function pullAllRowNote(state: PullAllRowState | undefined): { text: string; tone: 'success' | 'warning' | 'error' } | null {
  if (!state) return null;
  switch (state.phase) {
    case 'pulled': return { text: `${commits(state.commits)} pulled${state.keptLocalChanges ? ', local changes kept' : ''}`, tone: 'success' };
    case 'up-to-date': return { text: 'Already up to date', tone: 'success' };
    case 'skipped': return { text: skipNote(state), tone: 'warning' };
    case 'failed': return { text: state.message, tone: 'error' };
    default: return null;
  }
}

function skipNote(skip: PullAllSkip): string {
  switch (skip.reason) {
    case 'local-changes': return 'Local changes in the way';
    case 'diverged': return 'Has commits of its own';
    case 'conflicts': return 'Conflicts to resolve';
    case 'operation': return `${skip.operation.charAt(0).toUpperCase()}${skip.operation.slice(1)} in progress`;
    case 'no-upstream': return 'No upstream';
  }
}

function skipSentence(skip: PullAllSkip): string {
  switch (skip.reason) {
    case 'local-changes': return 'local changes are in the way, so nothing changed.';
    case 'diverged': return 'it has commits of its own now; use its own Pull.';
    case 'conflicts': return 'it has conflicts to resolve first.';
    case 'operation': return `finish or cancel the ${skip.operation} first.`;
    case 'no-upstream': return 'its branch no longer tracks a remote one.';
  }
}

export interface PullAllSummary {
  type: 'success' | 'warning' | 'error';
  title: string;
  /** One sentence per repository that was not pulled, and how many Stop left out. */
  lines: string[];
  duration: number;
}

/** The single notice a finished run ends with. */
export function pullAllSummary(run: PullAllRun): PullAllSummary {
  const total = run.repositoryIds.length;
  const states = run.repositoryIds.map((id) => [id, run.rows.get(id)] as const);
  const pulled = states.filter(([, state]) => state?.phase === 'pulled' || state?.phase === 'up-to-date').length;
  const notPulled = states.filter(([, state]) => state?.phase === 'not-pulled').length;
  const reasons = states.flatMap(([id, state]) => {
    const name = run.labels[id] ?? id;
    if (state?.phase === 'skipped') return [`${name}: ${skipSentence(state)}`];
    if (state?.phase === 'failed') return [`${name}: ${state.message.charAt(0).toLowerCase()}${state.message.slice(1)}.`];
    return [];
  });
  if (run.stopped) {
    return { type: 'warning', title: `Stopped: pulled ${pulled} of ${repositories(total)}`, lines: [...(notPulled > 0 ? [`${notPulled} not pulled.`] : []), ...reasons], duration: 10_000 };
  }
  if (pulled === total) return { type: 'success', title: `Pulled ${repositories(total)}`, lines: [], duration: 6_000 };
  if (pulled === 0) return { type: 'error', title: `Could not pull ${repositories(total)}`, lines: reasons, duration: 10_000 };
  return { type: 'warning', title: `Pulled ${pulled} of ${repositories(total)}`, lines: reasons, duration: 10_000 };
}

/** What the Pull all button says, with the search narrowing it to the rows on screen. */
export function pullAllButtonCopy(count: number, searching: boolean, leftOut: readonly string[]): { label: string; ariaLabel: string; tooltip: string } {
  const names = leftOut.length <= 1 ? leftOut.join('') : `${leftOut.slice(0, -1).join(', ')} and ${leftOut.at(-1)}`;
  return {
    label: searching ? `Pull ${count} shown` : `Pull all ${count}`,
    ariaLabel: searching ? `Pull ${count} shown ${count === 1 ? 'repository' : 'repositories'}` : `Pull ${repositories(count)}`,
    tooltip: `Fast-forwards ${repositories(count)}, keeping local changes Git doesn't need to touch.${leftOut.length > 0 ? ` ${names} ${leftOut.length === 1 ? 'needs its' : 'need their'} own Pull.` : ''}`,
  };
}
