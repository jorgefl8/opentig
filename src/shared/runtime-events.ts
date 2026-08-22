import type { RepositoryInfo } from './contracts';
import type { RepositoryChangeScope } from './repository-change';

export type OpenTigRuntimeEvent =
  | {
      type: 'repository.changed';
      repositoryId: string;
      scope: RepositoryChangeScope;
    }
  | {
      type: 'repository.active-changed';
      repository: RepositoryInfo;
    };
