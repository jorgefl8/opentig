import type { BranchInfo, CommitInfo, FileTreeEntry, RepositoryStatus, WorktreeInfo } from '@shared/git-types';
import type { PullRequestSummary, RecentRepository } from '@shared/contracts';
import type { NavigationLocation, SidebarView } from '@/app/navigation/location';

/** What the palette searches. Files is where Ctrl+P opens it; Ctrl+K opens it on commands. */
export type PaletteMode = 'files' | 'commands' | 'branches' | 'commits' | 'pulls' | 'runs' | 'repositories';

/** One opening of the palette: a new id starts it afresh, in that mode. */
export interface PaletteRequest {
  mode: PaletteMode;
  id: number;
}

/** What the app knows when the palette is open, read from what is already on screen or kept. */
export interface PaletteState {
  repositoryId: string;
  repositoryName: string;
  view: SidebarView;
  mobile: boolean;
  /** Where OpenTig runs: the desktop app can always take Ctrl+1…5, a browser tab often cannot. */
  desktop: boolean;
  files: FileTreeEntry[] | null;
  includeIgnored: boolean;
  activePath: string | null;
  status: RepositoryStatus | null;
  /** The repository opened but nothing has been read from it yet. */
  unconfirmed: boolean;
  /** The app's running operation, which every repository change waits for. */
  busy: string | null;
  /** A pull or push of this repository started from the repository list is running. */
  syncBusy: boolean;
  /** The branch has no upstream of its own, so Push publishes it. */
  publishBranch: boolean;
  branches: readonly BranchInfo[];
  worktrees: readonly WorktreeInfo[];
  /** The loaded history, newest first; null until History has been read. */
  commits: readonly CommitInfo[] | null;
  /** Set when the repository is on GitHub. */
  github: { nameWithOwner: string } | null;
  /** The GitHub CLI is there to ask GitHub. */
  githubReady: boolean;
  pulls: readonly PullRequestSummary[] | null;
  pullsLoading: boolean;
  pullsError: string | null;
  /** Why a pull request cannot be created from here, or null when it can. */
  createPullRequestBlocked: string | null;
  repositories: readonly RecentRepository[];
  unavailableRepositories: ReadonlySet<string>;
  /** Keys as they are bound, for showing beside their commands. */
  keys: { refresh: string; openRepository: string };
}

/**
 * What the palette's rows do: each one is an existing path of the app, with every
 * guard and confirmation it has elsewhere. Nothing typed in the palette reaches
 * any of them except as text to search for.
 */
export interface PaletteActions {
  showSection(view: SidebarView): void;
  openFile(path: string, line: number | null): boolean;
  openCommit(oid: string, subject: string): void;
  openPullRequest(number: number): void;
  openRun(runId: number): void;
  openPlace(location: NavigationLocation): void;
  switchBranch(fullName: string): void;
  openWorktree(path: string): void;
  openRepository(id: string): void;
  pull(): void;
  push(): void;
  refresh(): void;
  discardUnstaged(): void;
  createPullRequest(): void;
  addRepository(): void;
  openSettings(section: 'general' | 'shortcuts'): void;
  openOnGitHub(): void;
  searchInFiles(text: string): void;
  /** Asks for History's first page when the commits tab opens and it has not been read. */
  loadCommits(): void;
  /** The places visited before this one in this repository, newest first. */
  recentPlaces(): NavigationLocation[];
}
