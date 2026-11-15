import type { RepositoryInfo } from './contracts';
import type { RepositoryChangeScope } from './repository-change';
import type { GitHubAccountDetection } from './github-accounts';

export type OpenTigRuntimeEvent =
  | { type: 'ai.instructions-changed'; repositoryIds: string[] }
  | { type: 'github.accounts-changed'; repositoryIds?: string[]; inventoryChanged?: boolean; detected?: GitHubAccountDetection }
  | {
      type: 'repository.changed';
      repositoryId: string;
      scope: RepositoryChangeScope;
      /**
       * Sent when the server's watch of the repository runs into trouble or recovers from it.
       * `degraded` and `stopped` mean changes may go unreported, so clients read it on a timer.
       * A field of this event rather than an event of its own: older clients take an event type
       * they do not know for a change of GitHub accounts, and ignore a field they do not know.
       */
      watch?: RepositoryWatchState;
      /** With `watch: 'watching'`: the new watch, which read results name when it covers them. */
      watchId?: string;
    }
  | {
      type: 'repository.active-changed';
      repository: RepositoryInfo;
    };

/** `starting` while a watch is being set up: not trouble, but nothing it covers is reported yet. */
export type RepositoryWatchState = 'starting' | 'watching' | 'degraded' | 'stopped';
