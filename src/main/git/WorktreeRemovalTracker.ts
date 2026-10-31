import type { WorktreeRemovalResult } from '../../shared/contracts';
import type { WorktreeRemovalState } from '../../shared/git-types';

const FINISHED_REMOVAL_TTL_MS = 30 * 60_000;

interface TrackedRemoval {
  commonDir: string;
  state: WorktreeRemovalState;
}

/**
 * What the server knows about worktree removals. A client can stop waiting, reload
 * or lose its connection while Git keeps deleting, so the state outlives the request.
 */
export class WorktreeRemovalTracker {
  private readonly removals = new Map<string, TrackedRemoval>();
  private readonly running = new Map<string, Promise<WorktreeRemovalResult>>();

  /** A second request for the same path joins the removal already running. */
  track(key: string, commonDir: string, path: string, remove: () => Promise<WorktreeRemovalResult>): Promise<WorktreeRemovalResult> {
    const running = this.running.get(key);
    if (running) return running;
    const tracked: TrackedRemoval = { commonDir, state: { path, state: 'running', message: null, finishedAt: null } };
    this.removals.set(key, tracked);
    const promise = remove().then(
      (result) => {
        if (result.status === 'partial') this.keep(key, tracked, 'partial', result.message);
        else this.removals.delete(key);
        return result;
      },
      (error: unknown) => {
        this.keep(key, tracked, 'failed', `Could not remove ${path}: ${error instanceof Error ? error.message : 'Unknown error.'}`);
        throw error;
      },
    ).finally(() => this.running.delete(key));
    this.running.set(key, promise);
    return promise;
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  list(commonDir: string): WorktreeRemovalState[] {
    return [...this.removals.values()].filter((removal) => removal.commonDir === commonDir).map((removal) => ({ ...removal.state }));
  }

  private keep(key: string, tracked: TrackedRemoval, state: 'partial' | 'failed', message: string): void {
    tracked.state = { ...tracked.state, state, message, finishedAt: new Date().toISOString() };
    setTimeout(() => {
      if (this.removals.get(key) === tracked) this.removals.delete(key);
    }, FINISHED_REMOVAL_TTL_MS).unref?.();
  }
}
