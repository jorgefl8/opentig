import type {
  OpenTigApi,
  Preferences,
  GhCliStatus,
} from "../../src/shared/contracts";
import { DemoRepository, repository, sampleDate } from "./model";
import { demoPulls } from "./pulls";
import { findSearchMatches } from "../../src/shared/search";

// The shared app recognizes this error type; the demo has no authentication transport.
export class ServerAuthenticationError extends Error {}
export class ServerDisconnectedError extends Error {}
export class ServerRequestTimeoutError extends Error {}
export const model = new DemoRepository();
const disabled = async (): Promise<never> => {
  throw new Error(
    "This action needs an installed OpenTig instance. In this demo, try editing files, staging changes, and making a sample commit.",
  );
};
function group<T extends object>(methods: Partial<T>): T {
  return new Proxy(methods as T, {
    get(target, key) {
      return Reflect.get(target, key) ?? disabled;
    },
  });
}
const listeners = new Set<
  Parameters<OpenTigApi["events"]["onRepositoryChanged"]>[0]
>();
const changed = () => {
  for (const listener of listeners) listener(repository.id, "unknown");
};
const noop = async () => {};
const githubStatus: GhCliStatus = {
  installed: true,
  availability: "ready",
  authStatus: "authenticated",
  checkedAt: sampleDate,
  message: "Sample pull requests",
};
let preferences: Preferences = {
  theme: "dark",
  diffView: "unified",
  changesLayout: "tree",
  wrapLines: true,
  sidebarWidth: 280,
  showDotEnvFiles: false,
  uiZoom: 100,
  uiFont: "plus-jakarta-sans",
  monoFont: "jetbrains-mono",
  commitMessageHarness: "codex",
  commitMessageModels: {},
  aiExecutablePaths: {},
  shortcutOverrides: {},
  doubleControlShortcutEnabled: false,
  remoteFetchIntervalSeconds: 0,
};
const branch = () => ({
  name: "feature/task-filters",
  fullName: "refs/heads/feature/task-filters",
  current: true,
  remote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  worktreePath: repository.path,
  oid: model.commits[0]!.info.oid,
  shortOid: model.commits[0]!.info.shortOid,
  subject: model.commits[0]!.info.subject,
  author: "OpenTig Demo",
  date: sampleDate,
});
const worktree = () => ({
  path: repository.path,
  oid: model.commits[0]!.info.oid,
  branch: "refs/heads/feature/task-filters",
  bare: false,
  detached: false,
  locked: null,
  prunable: null,
  main: true,
});
export const opentig: OpenTigApi = {
  app: {
    bootstrap: async () => ({
      activeRepository: repository,
      recentRepositories: [{ ...repository, lastOpenedAt: sampleDate }],
      repositoryProjects: [],
      filesTreeStates: [
        {
          repositoryId: repository.id,
          expandedPaths: ["src", "test"],
          updatedAt: sampleDate,
        },
      ],
      openFilesStates: [],
      preferences,
      performanceAutomation: false,
    }),
    capabilities: async () => ({
      runtimeMode: "headless",
      platform: "other",
      systemTrash: false,
      nativePicker: false,
      fileClipboard: false,
      revealInFileManager: false,
      githubCli: githubStatus,
      aiProviders: [],
    }),
    setPreferences: async (patch) => {
      if (patch.remoteFetchIntervalSeconds) return disabled();
      preferences = { ...preferences, ...patch, remoteFetchIntervalSeconds: 0 };
      return preferences;
    },
    setFilesTreeExpandedPaths: noop,
    setOpenFilesState: noop,
    setZoomFactor: (factor) => {
      document.documentElement.style.zoom = String(factor);
    },
    setTitleBarTheme: noop,
    gitStatus: async () => ({ state: "ready", platform: "other", version: "2.47.0" }),
    setGlobalGitIdentity: disabled,
    completeOnboarding: async () => 1,
  },
  clipboard: { readFilePaths: async () => [], readImagePng: async () => null },
  projects: group<OpenTigApi["projects"]>({}),
  repository: group<OpenTigApi["repository"]>({
    getStatus: async () => model.status(),
    getFiles: async () => model.files(),
    getDirectoryEntries: async (_id, path) => model.directoryEntries(path),
    readFile: async (_id, path) => ({
      path,
      content: model.read(path),
      binary: false,
      tooLarge: false,
      size: model.read(path).length,
      mtimeMs: model.revision,
    }),
    writeFile: async (_id, path, content, expected) => {
      const result = model.write(path, content, expected);
      if (result.status === "saved") changed();
      return result;
    },
    getFavicon: async () => null,
    fileHistoryState: async () => ({
      canUndo: false,
      undoLabel: null,
      canRedo: false,
      redoLabel: null,
    }),
    openRecent: async () => repository,
    browseDirectories: async () => ({
      path: "/demo",
      parentPath: null,
      repository: null,
      locations: [{ name: "Sample repository", path: "/demo", kind: "home" }],
      directories: [
        {
          name: "launchpad",
          path: repository.path,
          repository: { branch: "feature/task-filters" },
        },
      ],
    }),
    search: async (_id, options) => {
      if (options.regex)
        throw new Error(
          "Regular-expression search is not included in this demo. Try a text search.",
        );
      const files = Object.entries(model.working)
        .map(([path, content]) => ({
          path,
          ignored: false,
          matches: findSearchMatches(content, options, 50).map((m) => ({
            line: m.line,
            column: m.column,
            length: m.end - m.start,
            text: m.text,
          })),
        }))
        .filter((f) => f.matches.length);
      return {
        files,
        totalMatches: files.reduce((n, f) => n + f.matches.length, 0),
        ignoredMatches: 0,
        truncated: false,
      };
    },
  }),
  diff: {
    get: async (request) => model.diff(request.path, request.kind),
    getCommit: async (_id, oid) => model.commitDiff(oid),
    getCommitFile: async (_id, oid, path) => model.commitDiff(oid, path),
  },
  index: group<OpenTigApi["index"]>({
    stage: async (_id, paths) => {
      model.stage(paths);
      changed();
      return { ok: true };
    },
    unstage: async (_id, paths) => {
      model.unstage(paths);
      changed();
      return { ok: true };
    },
    stageAll: async () => {
      model.stage(Object.keys(model.working));
      changed();
      return { ok: true };
    },
    unstageAll: async () => {
      model.unstage(Object.keys(model.working));
      changed();
      return { ok: true };
    },
    discard: async (_id, paths) => {
      model.discard(paths);
      changed();
      return { ok: true };
    },
  }),
  commits: group<OpenTigApi["commits"]>({
    create: async (_id, message) => {
      const result = model.commit(message);
      changed();
      return result;
    },
    list: async () => ({
      commits: model.commits.map((c) => ({ ...c.info })),
      nextCursor: null,
      baseRef: null,
    }),
    files: async (_id, oid) => model.commitFiles(oid),
    authorship: async () => ({
      author: { name: "OpenTig Demo", email: "demo@example.com" },
      committer: { name: "OpenTig Demo", email: "demo@example.com" },
      source: "local",
      editable: false,
      blockers: [],
      revision: "0".repeat(64),
    }),
  }),
  refs: group<OpenTigApi["refs"]>({
    listBranches: async () => [branch()],
    listWorktrees: async () => [worktree()],
    localRefsSnapshot: async () => ({
      branches: [branch()],
      worktrees: [{ ...worktree(), current: true }],
      remotes: [],
    }),
    branchDetails: async () => ({
      ...branch(),
      deletion: "current",
      comparisonKind: "none",
      comparisonBase: null,
      uniqueCommits: 0,
    }),
    worktreeDetails: async () => ({
      ...worktree(),
      current: true,
      available: true,
      stagedCount: model.status().stagedCount,
      unstagedCount: model.status().unstagedCount,
      untrackedCount: 0,
      conflictCount: 0,
      operation: null,
      readOnly: false,
      lastCommit: model.commits[0]!.info,
    }),
    switchBranch: async (_id, name) => {
      if (name !== branch().name) return disabled();
      return { status: "switched", movedChanges: false };
    },
    selectWorktree: async () => repository,
  }),
  ai: group<OpenTigApi["ai"]>({
    statuses: async () => [],
    repositoryInstructions: async () => ({ enabled: false, files: [] }),
    log: async () => [],
    cancelGeneration: noop,
  }),
  github: group<OpenTigApi["github"]>({
    status: async () => githubStatus,
    repositoryInfo: async () => ({ isGitHub: true, nameWithOwner: null }),
    findPullRequestForBranch: async (_id, branch) => demoPulls.forBranch(branch),
    listPullRequests: async (_id, states) => demoPulls.list(states),
    getPullRequest: async (_id, number) => demoPulls.get(number),
    getPullRequestLiveState: async (_id, number) => demoPulls.liveState(number),
    getPullRequestStack: async () => null,
    getPullRequestDiff: async (_id, number) => demoPulls.diff(number),
    getPullRequestCommitDiff: async (_id, oid) => demoPulls.commitDiff(oid),
    getPullRequestCommits: async (_id, number) => ({ commits: demoPulls.get(number).commits, complete: true }),
    repositoryAccount: async () => ({
      selection: { mode: "default" },
      nameWithOwner: "demo/launchpad",
      login: "opentig-demo",
      source: null,
      state: "ready",
      checkedAt: sampleDate,
      revision: 0,
    }),
    accountsStatus: async () => ({
      installationStatus: "available",
      accounts: [],
      activeLogin: null,
      environment: { present: false, login: null, state: "unknown" },
      checkedAt: null,
      message: githubStatus.message!,
    }),
  }),
  diagnostics: { list: async () => [], clear: noop, record: noop },
  events: {
    onRepositoryChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onActiveRepositoryChanged: () => () => {},
    onAiInstructionsChanged: () => () => {},
    onGitHubAccountsChanged: () => () => {},
  },
};
export const serverClient = {
  transport: {
    getState: () => "connected" as const,
    subscribeState: () => () => {},
  },
};
