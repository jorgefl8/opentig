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
    }
  | {
      type: 'repository.active-changed';
      repository: RepositoryInfo;
    };
