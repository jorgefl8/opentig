import type { OpenTigPlatform, OpenTigRuntimeMode } from '../../shared/contracts';
import { CliProcessRunner } from '../ai/CliProcessRunner';
import { CliResolver } from '../ai/CliResolver';
import { CommitMessageService } from '../ai/CommitMessageService';
import { PullRequestDraftService } from '../ai/PullRequestDraftService';
import { ClaudeProvider } from '../ai/providers/ClaudeProvider';
import { CodexProvider } from '../ai/providers/CodexProvider';
import { OpenCodeProvider } from '../ai/providers/OpenCodeProvider';
import { FileOperationHistory } from '../files/FileOperationHistory';
import { FileService } from '../files/FileService';
import { RepositoryWatcher } from '../files/RepositoryWatcher';
import { GitProcess } from '../git/GitProcess';
import { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import { RepositoryService } from '../git/RepositoryService';
import { SearchService } from '../git/SearchService';
import { GitHubService } from '../github/GitHubService';
import { AiLogStore } from '../persistence/AiLogStore';
import { SettingsStore } from '../persistence/SettingsStore';
import { SystemTrash, type TrashAdapter } from '../platform/SystemTrash';
import { OpenTigRuntime, type OpenTigRuntimeEventSink } from './OpenTigRuntime';

export interface CreateOpenTigRuntimeOptions {
  settingsPath: string;
  aiLogPath: string;
  runtimeMode: OpenTigRuntimeMode;
  platform: OpenTigPlatform;
  trash?: TrashAdapter;
  onEvent: OpenTigRuntimeEventSink;
}

export async function createOpenTigRuntime(
  options: CreateOpenTigRuntimeOptions,
): Promise<OpenTigRuntime> {
  const settings = new SettingsStore(options.settingsPath);
  await settings.load();
  const git = new GitProcess();
  const repositories = new RepositoryService(git, settings);
  const files = new FileService(git, repositories);
  const trash = options.trash ?? new SystemTrash();
  const fileHistory = new FileOperationHistory(files, trash);
  const search = new SearchService(git, repositories, files, fileHistory);
  const operations = new GitRepositoryOperations(git, repositories, files);
  const cliResolver = new CliResolver();
  const cliRunner = new CliProcessRunner();
  const providers = [
    new CodexProvider(cliResolver, cliRunner),
    new ClaudeProvider(cliResolver, cliRunner),
    new OpenCodeProvider(cliResolver, cliRunner),
  ];
  const aiLog = new AiLogStore(options.aiLogPath);
  await aiLog.load();
  const ai = new CommitMessageService(operations, providers, aiLog);
  const prDrafts = new PullRequestDraftService(operations, providers, aiLog);
  const github = new GitHubService(cliResolver, cliRunner, git, repositories);
  let runtime: OpenTigRuntime | null = null;
  const events = {
    repositoryChanged: (repositoryId: string, scope: Parameters<OpenTigRuntime['publishRepositoryChange']>[1]) => {
      runtime?.publishRepositoryChange(repositoryId, scope);
    },
    activeRepositoryChanged: (repository: Parameters<OpenTigRuntime['publishActiveRepositoryChange']>[0]) => {
      runtime?.publishActiveRepositoryChange(repository);
    },
  };
  const watcher = new RepositoryWatcher(
    events.repositoryChanged,
    () => git.hasActiveProcess(),
  );
  runtime = new OpenTigRuntime({
    runtimeMode: options.runtimeMode,
    platform: options.platform,
    settings,
    git,
    repositories,
    files,
    trash,
    fileHistory,
    search,
    operations,
    watcher,
    ai,
    cliRunner,
    aiLog,
    github,
    prDrafts,
    events,
  }, options.onEvent);
  return runtime;
}

export function normalizeRuntimePlatform(platform: NodeJS.Platform): OpenTigPlatform {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'other';
}
