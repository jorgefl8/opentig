/** A cut waiting for its paste: the files, the repository they were cut in, and when. */
export interface PendingCut {
  repositoryId: string;
  paths: string[];
  cutAt: number;
}

/** How long a cut waits for its paste. */
export const CUT_LIFETIME_MS = 60 * 60_000;
/** Cuts kept per session; the oldest give way. */
export const MAX_CUTS_PER_SESSION = 8;
/** Sessions with cuts kept at once; the one used least recently gives way. */
export const MAX_CUT_SESSIONS = 64;

/**
 * Files cut and not pasted yet, per session and by the transfer id the cut was given, which the
 * client sends back with its paste. Kept by session, not connection, so a cut survives its client
 * reconnecting; by transfer id, so one tab's cut never replaces or clears another's.
 */
export class PendingCuts {
  private readonly sessions = new Map<string, Map<string, PendingCut>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  add(sessionId: string, transferId: string, cut: Omit<PendingCut, 'cutAt'>): void {
    this.expire();
    const cuts = this.sessions.get(sessionId) ?? new Map<string, PendingCut>();
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, cuts);
    cuts.set(transferId, { ...cut, paths: [...cut.paths], cutAt: this.now() });
    while (cuts.size > MAX_CUTS_PER_SESSION) cuts.delete(cuts.keys().next().value!);
    while (this.sessions.size > MAX_CUT_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
  }

  /**
   * The cut a paste names, taken so it moves only once, when it was made in `repositoryId` and the
   * paste brings the same files; null otherwise, and the paste is a copy.
   */
  take(sessionId: string, transferId: string | null, repositoryId: string, paths: readonly string[], samePaths: (left: readonly string[], right: readonly string[]) => boolean): PendingCut | null {
    this.expire();
    if (!transferId) return null;
    const cuts = this.sessions.get(sessionId);
    const cut = cuts?.get(transferId);
    if (!cuts || !cut || cut.repositoryId !== repositoryId || !samePaths(paths, cut.paths)) return null;
    cuts.delete(transferId);
    if (cuts.size === 0) this.sessions.delete(sessionId);
    return cut;
  }

  private expire(): void {
    const now = this.now();
    for (const [sessionId, cuts] of this.sessions) {
      for (const [transferId, cut] of cuts) if (now - cut.cutAt >= CUT_LIFETIME_MS) cuts.delete(transferId);
      if (cuts.size === 0) this.sessions.delete(sessionId);
    }
  }
}
