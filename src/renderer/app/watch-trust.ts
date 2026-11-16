import type { RepositoryWatchState } from '@shared/runtime-events';

/**
 * Whether this page can rely on hearing of every change to the repository it shows, which is what
 * lets the viewer serve what it read before (see `confirmWatch`). The server says so by announcing
 * a watch by its id.
 *
 * Where each page has its own repository (`perClient`), a watch counts only when it was announced
 * after the page arrived on its repository: arriving again, by opening it, a reload, a reconnect or
 * the server moving the page, forgets what was announced before, since the page heard nothing of the
 * repository while it was elsewhere. While a choice of another repository is on its way the page may
 * already be elsewhere on the server, so nothing counts until it is settled (`suspended`).
 *
 * An older server watches one repository for every client and announces it whatever each one shows:
 * an announcement for a repository counts whenever that repository is on screen, as it always did.
 */
export interface WatchTrust {
  readonly perClient: boolean;
  /** The repository the page is on, and how many times it has arrived on one. */
  readonly repositoryId: string | null;
  readonly arrival: number;
  readonly suspended: boolean;
  /** The last announcement, and the arrival it was received in. A null id: told it is not watched. */
  readonly announced: { repositoryId: string; watchId: string | null; arrival: number } | null;
}

export const NO_WATCH_TRUST: WatchTrust = { perClient: false, repositoryId: null, arrival: 0, suspended: false, announced: null };

/** The page is now on `repositoryId`: nothing announced before counts for it where each page has its own. */
export function arrive(state: WatchTrust, repositoryId: string | null, perClient = state.perClient): WatchTrust {
  return { perClient, repositoryId, arrival: state.arrival + 1, suspended: false, announced: perClient ? null : state.announced };
}

/** A choice of another repository is on its way (`true`), or ended without the server moving the page (`false`). */
export function suspend(state: WatchTrust, suspended: boolean): WatchTrust {
  return state.suspended === suspended ? state : { ...state, suspended };
}

/** The server said how a repository is watched. */
export function announce(state: WatchTrust, repositoryId: string, watch: RepositoryWatchState, watchId: string | undefined): WatchTrust {
  const watching = watch === 'watching' && watchId ? watchId : null;
  if (state.perClient) {
    // About a repository this page is not on: news from before it left, or of one it has not arrived on yet.
    if (repositoryId !== state.repositoryId) return state;
    return { ...state, announced: { repositoryId, watchId: watching, arrival: state.arrival } };
  }
  if (watching) return { ...state, announced: { repositoryId, watchId: watching, arrival: state.arrival } };
  return state.announced?.repositoryId === repositoryId ? { ...state, announced: { repositoryId, watchId: null, arrival: state.arrival } } : state;
}

/**
 * What the start-up answer said of the repository's watch, taken after the page painted what it saved.
 * An announcement received since the page arrived (`arrival`) is newer, and stays.
 */
export function startedUp(state: WatchTrust, repositoryId: string, arrival: number, watch: { state: RepositoryWatchState; watchId?: string } | undefined): WatchTrust {
  if (state.arrival !== arrival) return state;
  if (state.announced?.repositoryId === repositoryId && state.announced.arrival === arrival) return state;
  return { ...state, announced: { repositoryId, watchId: watch?.state === 'watching' && watch.watchId ? watch.watchId : null, arrival } };
}

/** The connection came back: what was announced on the old one counts for nothing. */
export function reconnected(state: WatchTrust): WatchTrust {
  return { ...arrive(state, state.repositoryId), announced: null };
}

/** The watch id the page can rely on for `repositoryId`, or null. */
export function confirmedWatch(state: WatchTrust, repositoryId: string | null): string | null {
  const announced = state.announced;
  if (!repositoryId || !announced?.watchId || announced.repositoryId !== repositoryId) return null;
  if (!state.perClient) return announced.watchId;
  return announced.arrival === state.arrival && state.repositoryId === repositoryId && !state.suspended ? announced.watchId : null;
}
