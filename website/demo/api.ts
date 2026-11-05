import type {
  OpenTigApi,
  Preferences,
  GhCliStatus,
} from "../../src/shared/contracts";
import { DemoRepository, repository, sampleDate } from "./model";
import { demoPulls } from "./pulls";
import { demoReleases } from "./releases";
import { findSearchMatches } from "../../src/shared/search";
import { sampleCommitMessage, sampleHarness, samplePullRequestDraft } from "./sample-ai.ts";

// The shared app recognizes this error type; the demo has no authentication transport.
export class ServerAuthenticationError extends Error {}
export class ServerDisconnectedError extends Error { closeCode?: number; }
export const UNCONFIRMED_RESULT_MESSAGE = '';
export const isConnectionLoss = (_reason: unknown) => false;
export const isUnconfirmedResult = (_reason: unknown) => false;
export const model = new DemoRepository();
const unavailable = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} needs an installed OpenTig instance. This demo simulates editing, staging, committing, pushing, and sample pull requests.`);
};
const disabled = unavailable("This action");
/** Methods the demo leaves out explain, for their area, that they need an installed instance. */
function group<T extends object>(methods: Partial<T>, what = "This action"): T {
  const explain = unavailable(what);
  return new Proxy(methods as T, {
    get(target, key) {
      return Reflect.get(target, key) ?? explain;
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
  sidebarCollapsed: false,
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
  upstream: model.upstream,
  ahead: model.ahead(),
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
      // Copy, cut, and paste work on the sample files through an in-memory clipboard.
      fileClipboard: true,
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
  clipboard: { readFilePaths: async () => model.clipboardPaths(), readImagePng: async () => null },
  projects: group<OpenTigApi["projects"]>({}, "Organizing repositories into projects"),
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
    createEntry: async (_id, directory, name, kind) => {
      const result = model.track(kind === "file" ? "Create file" : "Create folder", () => model.createEntry(directory, name, kind));
      if (result.status === "created") changed();
      return result;
    },
    renameEntry: async (_id, path, name) => {
      const result = model.track("Rename item", () => model.rename(path, name));
      if (result.status === "renamed") changed();
      return result;
    },
    deleteEntries: async (_id, paths) => {
      const deleted = model.track(paths.length === 1 ? "Delete item" : `Delete ${paths.length} items`, () => model.remove(paths));
      changed();
      return { deleted, recovery: "undo" };
    },
    copyEntries: async (_id, paths) => model.copy(paths),
    cutEntries: async (_id, paths) => model.cut(paths),
    pasteEntries: async (_id, directory, sources, cutTransferId) => {
      const result = model.track("Paste", () => model.paste(directory, sources, cutTransferId));
      if (result.status === "pasted") changed();
      return result;
    },
    moveEntries: async (_id, paths, directory) => {
      const result = model.track(paths.length === 1 ? "Move item" : `Move ${paths.length} items`, () => model.move(paths, directory));
      changed();
      return result;
    },
    moveEntry: async (_id, path, directory) => {
      const { moved, conflicts } = model.track("Move item", () => model.move([path], directory));
      changed();
      if (moved[0]) return { status: "moved", ...moved[0] };
      return conflicts.length ? { status: "conflict", path } : { status: "noop", path };
    },
    replaceSearch: async (_id, request) => {
      if (request.options.regex) throw new Error("Regular-expression search is not included in this demo. Try a text search.");
      const result = model.replace(request);
      if (result.status === "replaced") changed();
      return result;
    },
    getAbsolutePath: async (_id, path) => `${repository.path}/${path}`,
    writeFile: async (_id, path, content, expected) => {
      const result = model.write(path, content, expected);
      if (result.status === "saved") changed();
      return result;
    },
    // The real app finds assets/logo.svg the same way, so the sample repository shows its own icon.
    getFavicon: async () => {
      const logo = model.read("assets/logo.svg");
      return logo ? { mimeType: "image/svg+xml", dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logo)}` } : null;
    },
    fileHistoryState: async () => model.fileHistoryState(),
    undoFileOperation: async () => {
      const result = model.undoFileOperation("undo");
      changed();
      return result;
    },
    redoFileOperation: async () => {
      const result = model.undoFileOperation("redo");
      changed();
      return result;
    },
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
            text: content.split("\n")[m.line - 1]!.slice(0, 500),
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
  }, "Opening, cloning, and revealing files outside the sample"),
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
      model.stage(model.status().changes.map((change) => change.path));
      changed();
      return { ok: true };
    },
    unstageAll: async () => {
      model.unstage(model.status().changes.map((change) => change.path));
      changed();
      return { ok: true };
    },
    discard: async (_id, paths) => {
      model.discard(paths);
      changed();
      return { ok: true };
    },
    prepareCommitGroup: async (input) => {
      model.prepareGroup(input.paths, input.expectedStagedPaths);
      changed();
      return { ok: true };
    },
  }, "Resolving conflicts"),
  commits: group<OpenTigApi["commits"]>({
    undoLatest: async (_id, expectedOid) => {
      const result = model.undoLatest(expectedOid);
      if (result.status === "success") changed();
      return result;
    },
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
  }, "Changing commit authorship"),
  refs: group<OpenTigApi["refs"]>({
    // Pushing is simulated: the sample remote takes every local commit, with no network access.
    pushContext: async (repositoryId) => ({
      id: `demo-push-${model.commits[0]!.info.oid}`,
      repositoryId,
      branch: "feature/task-filters",
      oid: model.commits[0]!.info.oid,
      targetRef: "refs/heads/feature/task-filters",
      remote: "origin",
      urls: ["https://github.com/opentig-demo/launchpad.git"],
      remotes: ["origin"],
      mode: "managed",
      login: "opentig-demo",
      hasUpstream: Boolean(model.upstream),
    }),
    push: async () => {
      const result = model.push();
      changed();
      if (result.published) return { status: "published", branch: "feature/task-filters", remote: "origin" };
      return result.commits ? { status: "success", commits: result.commits } : { status: "up-to-date" };
    },
    // The simulated remote never has commits the sample lacks.
    fetch: async () => ({ status: "success", ahead: model.ahead(), behind: 0 }),
    fetchBranches: async () => ({ status: "success", ahead: model.ahead(), behind: 0 }),
    pull: async () => (model.upstream ? { status: "up-to-date" } : { status: "no-upstream" }),
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
  }, "Managing branches, remotes, and worktrees"),
  ai: group<OpenTigApi["ai"]>({
    statuses: async () => [sampleHarness],
    repositoryInstructions: async () => ({ enabled: false, files: [] }),
    setRepositoryInstructions: async (_id, enabled) => ({ enabled, files: [] }),
    // A short pause, so the generating state is visible as it is with a real CLI.
    generateCommitMessage: async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return sampleCommitMessage(model.status().changes.filter((change) => change.staged).map((change) => change.path));
    },
    log: async () => [],
    clearLog: noop,
    cancelGeneration: noop,
  }),
  github: group<OpenTigApi["github"]>({
    status: async () => githubStatus,
    repositoryInfo: async () => ({ isGitHub: true, nameWithOwner: null }),
    findPullRequestForBranch: async (_id, branch) => demoPulls.forBranch(branch),
    listPullRequests: async (_id, states) => demoPulls.list(states),
    getPullRequest: async (_id, number) => demoPulls.get(number),
    getPullRequestLiveState: async (_id, number) => demoPulls.liveState(number),
    getPullRequestConversation: async (_id, number) => demoPulls.conversation(number),
    listPullRequestStacks: async (_id, numbers) => demoPulls.stacks(numbers),
    getPullRequestStack: async (_id, number) => demoPulls.stack(number),
    runPullRequestAction: async (input) => demoPulls.act(input),
    generateDraft: async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return samplePullRequestDraft();
    },
    cancelDraft: noop,
    updatePullRequest: async (input) => demoPulls.update(input),
    commentOnPullRequest: async (input) => demoPulls.comment(input),
    reviewPullRequest: async (input) => demoPulls.review(input),
    editPullRequestEntry: async (input) => demoPulls.editEntry(input),
    deletePullRequestEntry: async (input) => demoPulls.deleteEntry(input),
    getPullRequestDiff: async (_id, number) => demoPulls.diff(number),
    getPullRequestCommitDiff: async (_id, oid) => demoPulls.commitDiff(oid),
    getPullRequestCommits: async (_id, number) => ({ commits: demoPulls.get(number).commits, complete: true }),
    listReleases: async () => demoReleases.list(),
    getRelease: async (_id, tagName) => demoReleases.get(tagName),
    checkReleaseTag: async (_id, tagName) => demoReleases.checkTag(tagName),
    listWorkflows: async () => demoReleases.workflows(),
    listWorkflowRuns: async (_id, path) => demoReleases.workflowRuns(path),
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
  }, "Releases, workflow runs, new pull requests, and GitHub accounts"),
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
