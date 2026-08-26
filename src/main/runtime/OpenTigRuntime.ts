import type { OpenTigPlatform, OpenTigRuntimeMode, RepositoryInfo } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { mergeRepositoryChangeScopes } from '../../shared/repository-change';
import type { OpenTigRuntimeEvent } from '../../shared/runtime-events';
import type { CommitMessageService } from '../ai/CommitMessageService';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import type { PullRequestDraftService } from '../ai/PullRequestDraftService';
import type { FileOperationHistory } from '../files/FileOperationHistory';
import type { FileService } from '../files/FileService';
import type { RepositoryWatcher } from '../files/RepositoryWatcher';
import type { GitProcess } from '../git/GitProcess';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import type { RepositoryService } from '../git/RepositoryService';
import type { SearchService } from '../git/SearchService';
import type { GitHubService } from '../github/GitHubService';
import type { AiLogStore } from '../persistence/AiLogStore';
import type { ProblemsLogStore } from '../persistence/ProblemsLogStore';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { TrashAdapter } from '../platform/SystemTrash';

export interface OpenTigRuntimeServices {
  runtimeMode: OpenTigRuntimeMode;
  platform: OpenTigPlatform;
  settings: SettingsStore;
  git: GitProcess;
  repositories: RepositoryService;
  files: FileService;
  trash: TrashAdapter;
  fileHistory: FileOperationHistory;
  search: SearchService;
  operations: GitRepositoryOperations;
  watcher: RepositoryWatcher;
  ai: CommitMessageService;
  cliRunner: CliProcessRunner;
  aiLog: AiLogStore;
  problems: ProblemsLogStore;
  github: GitHubService;
  prDrafts: PullRequestDraftService;
  events: OpenTigRuntimeEventPublisher;
}

export interface OpenTigRuntimeEventPublisher {
  repositoryChanged(repositoryId: string, scope: RepositoryChangeScope): void;
  activeRepositoryChanged(repository: RepositoryInfo): void;
}

export type OpenTigRuntimeEventSink = (event: OpenTigRuntimeEvent) => void;

/** Owns one server service graph and its repository event lifecycle. */
export class OpenTigRuntime {
  private lastNotifiedAt = 0;
  private trailingNotify: NodeJS.Timeout | null = null;
  private trailingChange: { repositoryId: string; scope: RepositoryChangeScope } | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(
    readonly services: OpenTigRuntimeServices,
    private readonly onEvent: OpenTigRuntimeEventSink,
  ) {}

  get settings(): SettingsStore { return this.services.settings; }
  get repositories(): RepositoryService { return this.services.repositories; }
  get watcher(): RepositoryWatcher { return this.services.watcher; }

  publishRepositoryChange(repositoryId: string, scope: RepositoryChangeScope): void {
    if (this.closePromise) return;
    const elapsed = Date.now() - this.lastNotifiedAt;
    if (elapsed < 1_000) {
      this.trailingChange = this.trailingChange?.repositoryId === repositoryId
        ? { repositoryId, scope: mergeRepositoryChangeScopes(this.trailingChange.scope, scope) }
        : { repositoryId, scope };
      if (!this.trailingNotify) {
        this.trailingNotify = setTimeout(() => {
          this.trailingNotify = null;
          const change = this.trailingChange;
          this.trailingChange = null;
          if (change) this.publishRepositoryChange(change.repositoryId, change.scope);
        }, 1_000 - elapsed);
      }
      return;
    }
    this.lastNotifiedAt = Date.now();
    this.onEvent({ type: 'repository.changed', repositoryId, scope });
  }

  publishActiveRepositoryChange(repository: RepositoryInfo): void {
    if (!this.closePromise) this.onEvent({ type: 'repository.active-changed', repository });
  }

  refreshActiveRepositoryIfStale(staleAfterMs = 2_000): void {
    if (Date.now() - this.lastNotifiedAt < staleAfterMs) return;
    const repositoryId = this.settings.activeRepositoryId;
    if (repositoryId) this.publishRepositoryChange(repositoryId, 'unknown');
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOwnedResources();
    return this.closePromise;
  }

  private async closeOwnedResources(): Promise<void> {
    if (this.trailingNotify) clearTimeout(this.trailingNotify);
    this.trailingNotify = null;
    this.trailingChange = null;
    this.watcher.stop();
    this.services.prDrafts.close();
    this.services.fileHistory.clear();
    await Promise.all([
      this.services.ai.close(),
      this.services.cliRunner.close(),
      this.services.git.close(),
      this.services.aiLog.flush(),
      this.services.problems.flush(),
      this.settings.flush(),
    ]);
  }
}
