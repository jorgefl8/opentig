import type { RepositoryInfo } from './contracts';
import type { RepositoryChangeScope } from './repository-change';

export type OpenTigRuntimeEvent =
  | { type: 'ai.instructions-changed'; repositoryIds: string[] }
  | { type: 'github.accounts-changed'; repositoryIds?: string[]; inventoryChanged?: boolean }
  | {
      type: 'repository.changed';
      repositoryId: string;
      scope: RepositoryChangeScope;
    }
  | {
      type: 'repository.active-changed';
      repository: RepositoryInfo;
    };
