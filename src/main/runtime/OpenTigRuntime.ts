import type { RepositoryAiInstructions } from '../ai/RepositoryAiInstructions';
import { githubRepositoryKey, type GitHubAccountDetection } from '../../shared/github-accounts';
import type { OpenTigPlatform, OpenTigRuntimeMode } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import { mergeRepositoryChangeScopes } from '../../shared/repository-change';
import type { OpenTigRuntimeEvent, RepositoryWatchState } from '../../shared/runtime-events';
import type { CommitMessageService } from '../ai/CommitMessageService';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import type { PullRequestDraftService } from '../ai/PullRequestDraftService';
import type { FileOperationHistory } from '../files/FileOperationHistory';
import type { FileService } from '../files/FileService';
import type { RepositoryWatchPool } from '../files/RepositoryWatchPool';
import type { ClientRepositories } from './ClientRepositories';
import type { GitProcess } from '../git/GitProcess';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import type { RepositoryService } from '../git/RepositoryService';
import type { SearchService } from '../git/SearchService';
import type { GitHubService } from '../github/GitHubService';
import type { RepositorySnapshotStore } from '../persistence/RepositorySnapshotStore';
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
  /** One watch per repository a client has open (see `RepositoryWatchPool`). */
  watcher: RepositoryWatchPool;
  /** The repository each connection has open (see `ClientRepositories`). */
  clients: ClientRepositories;
  ai: CommitMessageService;
  aiInstructions: RepositoryAiInstructions;
  cliRunner: CliProcessRunner;
  aiLog: AiLogStore;
  problems: ProblemsLogStore;
  github: GitHubService;
  /** The last state read of each repository, painted when a client starts up. */
  snapshots?: RepositorySnapshotStore;
  prDrafts: PullRequestDraftService;
  events: OpenTigRuntimeEventPublisher;
}

export interface OpenTigRuntimeEventPublisher {
  aiInstructionsChanged(commonDir: string): void;
  repositoryChanged(repositoryId: string, scope: RepositoryChangeScope): void;
}

/** Sends an event to these connections, or to every connection without them. */
export type OpenTigRuntimeEventSink = (event: OpenTigRuntimeEvent, connectionIds?: ReadonlySet<string>) => void;

/** Changes of one repository are reported at most once a second, the rest gathered into one that follows. */
const CHANGE_INTERVAL_MS = 1_000;

/** Owns one server service graph and its repository event lifecycle. */
export class OpenTigRuntime {
  /** Per repository: when its last change was reported, and the changes gathered since. */
  private readonly changes = new Map<string, { notifiedAt: number; pending: RepositoryChangeScope | null; timer: NodeJS.Timeout | null }>();
  private closePromise: Promise<void> | null = null;

  constructor(
    readonly services: OpenTigRuntimeServices,
    private readonly onEvent: OpenTigRuntimeEventSink,
  ) {}

  get settings(): SettingsStore { return this.services.settings; }
  get repositories(): RepositoryService { return this.services.repositories; }
  get watcher(): RepositoryWatchPool { return this.services.watcher; }

  /** A change of the repository, for the clients that have it open. */
  publishRepositoryChange(repositoryId: string, scope: RepositoryChangeScope): void {
    if (this.closePromise) return;
    this.services.repositories.invalidateIfKnown(repositoryId);
    const now = Date.now();
    let state = this.changes.get(repositoryId);
    if (state && now - state.notifiedAt < CHANGE_INTERVAL_MS) {
      state.pending = state.pending ? mergeRepositoryChangeScopes(state.pending, scope) : scope;
      if (!state.timer) {
        const waiting = state;
        waiting.timer = setTimeout(() => {
          waiting.timer = null;
          const pending = waiting.pending;
          waiting.pending = null;
          if (pending) this.publishRepositoryChange(repositoryId, pending);
        }, CHANGE_INTERVAL_MS - (now - state.notifiedAt));
      }
      return;
    }
    if (!state) {
      this.forgetQuietRepositories(now);
      state = { notifiedAt: now, pending: null, timer: null };
      this.changes.set(repositoryId, state);
    }
    state.notifiedAt = now;
    this.services.clients.changed(repositoryId, scope);
  }

  /** Keeps the record of reported changes to the repositories still changing. */
  private forgetQuietRepositories(now: number): void {
    if (this.changes.size < 64) return;
    for (const [repositoryId, state] of this.changes) {
      if (!state.timer && now - state.notifiedAt >= CHANGE_INTERVAL_MS) this.changes.delete(repositoryId);
    }
  }

  /** Sends an event to these connections only (see `ClientRepositories`). */
  publishTo(event: OpenTigRuntimeEvent, connectionIds: ReadonlySet<string>): void {
    if (!this.closePromise && connectionIds.size > 0) this.onEvent(event, connectionIds);
  }

  publishGitHubAccountsChange(commonDir?: string, defaultOnly = false, detected?: GitHubAccountDetection): void {
    if (this.closePromise) return;
    const repositories = this.services.repositories.recents();
    const repositoryIds = defaultOnly ? repositories.filter(repo => {
      return this.settings.githubAccount(repo.commonDir).mode === 'default';
    }).map(repo => repo.id) : commonDir ? repositories.filter(repo => githubRepositoryKey(repo.commonDir) === githubRepositoryKey(commonDir)).map(repo => repo.id) : undefined;
    this.onEvent({ type: 'github.accounts-changed', ...(repositoryIds ? { repositoryIds } : {}), ...(defaultOnly || commonDir ? { inventoryChanged: true } : {}), ...(detected ? { detected } : {}) });
  }

  publishAiInstructionsChange(commonDir: string): void {
    if (this.closePromise) return;
    const repositoryIds = this.services.repositories.recents().filter(repository => githubRepositoryKey(repository.commonDir) === githubRepositoryKey(commonDir)).map(repository => repository.id);
    this.onEvent({ type: 'ai.instructions-changed', repositoryIds });
  }

  /**
   * The watch began, moved away, ran into trouble or recovered. Clients read the
   * repository again, since changes may have gone unreported, and learn whether
   * they can rely on its reports. That is a read of everything, also when a watch
   * begins: a branch made or checked out while there was none went unreported too.
   * Each client that has the repository open is told, by an id of the watch of its own.
   */
  publishRepositoryWatch(repositoryId: string, state: RepositoryWatchState, watchId: string | null): void {
    if (this.closePromise) return;
    this.services.repositories.invalidateIfKnown(repositoryId);
    this.services.clients.watchChanged(repositoryId, state, watchId);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOwnedResources();
    return this.closePromise;
  }

  private async closeOwnedResources(): Promise<void> {
    for (const state of this.changes.values()) if (state.timer) clearTimeout(state.timer);
    this.changes.clear();
    this.watcher.stop();
    this.services.prDrafts.close();
    this.services.fileHistory.clear();
    await Promise.all([
      this.services.ai.close(),
      this.services.cliRunner.close(),
      this.services.git.close(),
      this.services.aiLog.flush(),
      this.services.github.cache.close(),
      this.services.snapshots?.close(),
      this.services.problems.flush(),
      this.settings.flush(),
    ]);
  }
}
