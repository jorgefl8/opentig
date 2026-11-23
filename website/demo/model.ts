import { sampleHtml } from "./sample-html.ts";
import { sampleLogo, sampleNightlyWorkflow, samplePackage, sampleProgress, sampleReadme, sampleReleaseWorkflow, sampleTasks, sampleTsconfig, sampleTypes, sampleWorkflow } from "./sample-files.ts";
import { createTwoFilesPatch, diffLines } from "diff";
import { findSearchMatches, type SearchReplaceRequest } from "../../src/shared/search.ts";
import type {
  CommitFile,
  FileHistoryEntry,
  CommitInfo,
  FileTreeEntry,
  RepositoryStatus,
} from "../../src/shared/git-types";
import type { DiffResult, FileHistoryResult, FileHistoryState, UndoLatestCommitResult } from "../../src/shared/contracts";

/** Where the sample would live on GitHub. It isn't there: links to it explain that instead (see browser-capabilities.ts). */
export const sampleNameWithOwner = "opentig-demo/launchpad";
const samplePages = `https://github.com/${sampleNameWithOwner}`.toLowerCase();
/** Whether a link leads to one of the sample's pages on GitHub, which exist only in this demo. */
export function isSampleGitHubLink(value: string): boolean {
  const link = value.trim().toLowerCase();
  // The sample's pull requests, runs, and releases have no address of their own.
  return link === "" || link === samplePages || link.startsWith(`${samplePages}/`);
}
export const repository = {
  id: "launchpad",
  name: "launchpad",
  repositoryName: "launchpad",
  path: "/demo/launchpad",
  commonDir: "/demo/launchpad/.git",
};
/** The sample's clock runs back from the moment the page opened, so ages read the same on any day. */
const openedAt = Date.now();
export const hoursAgo = (hours: number) => new Date(openedAt - hours * 3_600_000).toISOString();
export const daysAgo = (days: number) => hoursAgo(days * 24);
/** When the sample's pull requests, releases, and workflow runs were last touched. */
export const sampleDate = hoursAgo(2);
export const branchName = "feature/task-filters";
export const upstreamName = `origin/${branchName}`;
export type Tree = Record<string, string>;
export const initialFiles: Tree = {
  ".github/workflows/ci.yml": sampleWorkflow,
  ".github/workflows/nightly.yml": sampleNightlyWorkflow,
  ".github/workflows/prepare-release.yml": sampleReleaseWorkflow,
  "assets/logo.svg": sampleLogo,
  "data/tasks.json": sampleTasks,
  "index.html": sampleHtml,
  "src/filter-tasks.js": `/** Return tasks whose titles match the search query. */
export function filterTasks(tasks, query = '') {
  const search = query.toLowerCase();

  return tasks.filter((task) =>
    task.title.toLowerCase().includes(search),
  );
}
`,
  "test/filter-tasks.test.js": `import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTasks } from '../src/filter-tasks.js';

const tasks = [
  { title: 'Design the landing page', completed: false },
  { title: 'Write the release notes', completed: true },
];

test('search is case insensitive', () => {
  assert.deepEqual(filterTasks(tasks, 'LANDING'), [tasks[0]]);
});
`,
  "src/progress.ts": sampleProgress,
  "src/types.ts": sampleTypes,
  "README.md": sampleReadme,
  "package.json": samplePackage,
  "tsconfig.json": sampleTsconfig,
};
export const modifiedFilter = `/** Search tasks and hide completed work by default. */
export function filterTasks(tasks, query = '', options = {}) {
  const { includeCompleted = false } = options;
  const search = query.toLowerCase();

  return tasks.filter((task) => {
    const matchesQuery = task.title.toLowerCase().includes(search);
    const isVisible = includeCompleted || !task.completed;

    return matchesQuery && isVisible;
  });
}
`;
const lines = (text: string) =>
  text ? text.replace(/\n$/, "").split("\n") : [];

/** Unified diffs from sample snapshots, with a bounded fallback for large edits. */
export function patch(path: string, before: string, after: string, added = false, deleted = false): string {
  if (before === after) return "";
  if (deleted) {
    const body = patch(path, before, "");
    return body.replace(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`, `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null`);
  }
  if (added) {
    const body = patch(path, "", after);
    return body.replace(`diff --git a/${path} b/${path}\n--- a/${path}`, `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null`);
  }
  const computed = createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    before,
    after,
    undefined,
    undefined,
    { context: 3, timeout: 100 },
  );
  if (computed)
    return `diff --git a/${path} b/${path}\n${computed.slice(computed.indexOf("--- "))}`;
  const oldLines = lines(before),
    newLines = lines(after);
  const side = (value: string[], prefix: string, content: string) =>
    value
      .map(
        (line, index) =>
          `${prefix}${line}\n${index === value.length - 1 && !content.endsWith("\n") ? "\\ No newline at end of file\n" : ""}`,
      )
      .join("");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n${side(oldLines, "-", before)}${side(newLines, "+", after)}`;
}

export function counts(before: string, after: string) {
  const changes = diffLines(before, after, { timeout: 50 });
  return changes
    ? {
        additions: changes.reduce((n, c) => n + (c.added ? c.count : 0), 0),
        deletions: changes.reduce((n, c) => n + (c.removed ? c.count : 0), 0),
      }
    : { additions: lines(after).length, deletions: lines(before).length };
}

/** The patch Git writes for a renamed file: where it came from, and what changed on the way. */
export function renamePatch(from: string, to: string, before: string, after: string): string {
  const body = patch(to, before, after);
  const changed = counts(before, after);
  const similarity = Math.round((1 - Math.max(changed.additions, changed.deletions) / Math.max(lines(before).length, lines(after).length, 1)) * 100);
  const header = `diff --git a/${from} b/${to}\nsimilarity index ${similarity}%\nrename from ${from}\nrename to ${to}\n`;
  return body ? header + body.slice(body.indexOf("--- ")).replace(`--- a/${to}`, `--- a/${from}`) : header;
}

/** What a commit did to each file, sorted by path. A renamed file is listed once, under its new path. */
export function changedFiles(before: Tree, after: Tree, renames: Record<string, string> = {}): CommitFile[] {
  const renamedFrom = new Set(Object.values(renames));
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => !renamedFrom.has(path) && (before[renames[path] ?? path] !== after[path] || Object.hasOwn(renames, path)))
    .sort()
    .map((path) => {
      const oldPath = renames[path] ?? null;
      const previous = before[oldPath ?? path];
      // Counted from the patch the viewer shows, so the two can never disagree.
      const text = filePatch({ path, oldPath }, before, after);
      const changed = text.slice(Math.max(text.indexOf("\n@@"), 0)).split("\n");
      return {
        path,
        oldPath,
        kind: oldPath ? "renamed" : previous === undefined ? "added" : after[path] === undefined ? "deleted" : "modified",
        additions: changed.filter((line) => line.startsWith("+")).length,
        deletions: changed.filter((line) => line.startsWith("-")).length,
        binary: false,
      };
    });
}

/** The patch of one file of a commit, in the form Git gives its kind of change. */
export function filePatch(file: Pick<CommitFile, "path" | "oldPath">, before: Tree, after: Tree): string {
  if (file.oldPath) return renamePatch(file.oldPath, file.path, before[file.oldPath] ?? "", after[file.path] ?? "");
  return patch(file.path, before[file.path] ?? "", after[file.path] ?? "", before[file.path] === undefined, after[file.path] === undefined);
}

export interface SampleCommit {
  oid: string;
  subject: string;
  body: string;
  author: string;
  email: string;
  date: string;
  before: Tree;
  after: Tree;
  /** New path to the path Git says it was renamed from. */
  renames: Record<string, string>;
  /** On main already, or one of the branch's own commits. */
  onMain: boolean;
}

/** A copy of a tree with some files replaced, or removed when given as undefined. */
function withFiles(tree: Tree, changes: Record<string, string | undefined>): Tree {
  const next = { ...tree };
  for (const [path, content] of Object.entries(changes)) {
    if (content === undefined) delete next[path];
    else next[path] = content;
  }
  return next;
}
/** An earlier version of a sample file. Fails loudly if the text it undoes is no longer there. */
function earlier(text: string, replacements: [later: string, before: string][]): string {
  return replacements.reduce((value, [later, before]) => {
    if (!value.includes(later)) throw new Error(`The sample history expects "${later}" in a sample file.`);
    return value.replace(later, before);
  }, text);
}

/**
 * A commit id that reads like Git's: forty hex digits drawn from the seed, the same on every load.
 * Different seeds give different ids, as different commits would.
 */
export function sampleOid(seed: string): string {
  let hex = "";
  for (let round = 0; hex.length < 40; round++) {
    let hash = 0x811c9dc5 ^ round;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    hex += ((hash ^ (hash >>> 16)) >>> 0).toString(16).padStart(8, "0");
  }
  return hex.slice(0, 40);
}
/** The tip of main, which the remote has too. */
export const mainOid = sampleOid("Document the local test command (#19)");
const demoAuthor = { author: "OpenTig Demo", email: "demo@example.com" };
const searchPath = "src/search.js";
const filterPath = "src/filter-tasks.js";
const filterTests = "test/filter-tasks.test.js";
const smokePath = "test/smoke.js";
const workflowPaths = Object.keys(initialFiles).filter((path) => path.startsWith(".github/"));

// The history is written backwards from the files as they are now, so its newest commit ends exactly on them.
const beforeReadmeUpdate = withFiles(initialFiles, {
  "README.md": earlier(initialFiles["README.md"]!, [
    ["`filterTasks` matches task titles", "`searchTasks` matches task titles"],
    ["import { filterTasks } from './src/filter-tasks.js';", "import { searchTasks } from './src/search.js';"],
    ["const visible = filterTasks(tasks, 'landing');", "const visible = searchTasks(tasks, 'landing');"],
    ["Runs the task filter tests with `node --test`.", "Runs the search smoke check in `test/smoke.js`."],
  ]),
});
const beforeTaskFilter = withFiles(beforeReadmeUpdate, {
  [filterPath]: undefined,
  [searchPath]: earlier(initialFiles[filterPath]!, [["export function filterTasks(", "export function searchTasks("]]),
  [filterTests]: undefined,
  [smokePath]: `import assert from 'node:assert/strict';
import { searchTasks } from '../src/search.js';

const tasks = [{ title: 'Design the landing page' }, { title: 'Write the release notes' }];

assert.deepEqual(searchTasks(tasks, 'LANDING'), [tasks[0]]);
console.log('search ok');
`,
  "package.json": earlier(initialFiles["package.json"]!, [['"test": "node --test"', '"test": "node test/smoke.js"']]),
});
const scriptsSection = /## Scripts\n[\s\S]*?\n\n(?=## )/.exec(beforeTaskFilter["README.md"]!)?.[0] ?? "## Scripts";
const beforeScripts = withFiles(beforeTaskFilter, { "README.md": earlier(beforeTaskFilter["README.md"]!, [[scriptsSection, ""]]) });
const beforeWorkflows = withFiles(beforeScripts, Object.fromEntries(workflowPaths.map((path) => [path, undefined])));

/** Launchpad's history, oldest first: main, then the two commits of the branch's pull request. */
export const sampleHistory: SampleCommit[] = [
  { oid: sampleOid("Start the Launchpad release board"), subject: "Start the Launchpad release board", body: "", ...demoAuthor, date: daysAgo(34), before: {}, after: beforeWorkflows, renames: {}, onMain: true },
  { oid: sampleOid("Add CI, nightly, and release workflows"), subject: "Add CI, nightly, and release workflows", body: "", ...demoAuthor, date: daysAgo(20), before: beforeWorkflows, after: beforeScripts, renames: {}, onMain: true },
  { oid: mainOid, subject: "Document the local test command (#19)", body: "", ...demoAuthor, date: daysAgo(6), before: beforeScripts, after: beforeTaskFilter, renames: {}, onMain: true },
  {
    oid: sampleOid("Turn search into a task filter"), subject: "Turn search into a task filter",
    body: "Rename searchTasks to filterTasks and move it to src/filter-tasks.js.\nReplace the smoke script with node:test tests.",
    ...demoAuthor, date: daysAgo(3), before: beforeTaskFilter, after: beforeReadmeUpdate, renames: { [filterPath]: searchPath }, onMain: false,
  },
  { oid: sampleOid("Describe the task filter in the README"), subject: "Describe the task filter in the README", body: "", ...demoAuthor, date: daysAgo(2), before: beforeReadmeUpdate, after: initialFiles, renames: {}, onMain: false },
];

/** The commit a teammate pushes to the branch while the visitor works, which the first push runs into. */
const teammateTest = "test/empty-list.test.js";
function teammateCommit(tip: Tree): SampleCommit {
  return {
    oid: sampleOid("Cover an empty task list"), subject: "Cover an empty task list", body: "", author: "leo-builds", email: "leo@example.com",
    date: new Date(Date.now() - 4 * 60_000).toISOString(), before: tip, renames: {}, onMain: false,
    after: withFiles(tip, {
      [teammateTest]: `import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTasks } from '../src/filter-tasks.js';

test('an empty list has no matches', () => {
  assert.deepEqual(filterTasks([], 'landing'), []);
});
`,
    }),
  };
}

type FileTree = { working: Record<string, string>; emptyFolders: Set<string> };
type Entry = Pick<SampleCommit, "before" | "after" | "renames"> & { info: CommitInfo };

export class DemoRepository {
  head = { ...initialFiles };
  index = { ...initialFiles };
  working: Record<string, string> = {
    ...initialFiles,
    "src/filter-tasks.js": modifiedFilter,
    "test/filter-tasks.test.js":
      initialFiles["test/filter-tasks.test.js"]! +
      "\ntest('hides completed tasks by default', () => {\n  assert.deepEqual(filterTasks(tasks), [tasks[0]]);\n});\n",
    // The branch finishes the filter task, so its checklist item is ticked, and a note plans the next release.
    "README.md":
      initialFiles["README.md"]!.replace("- [ ] Filter tasks by status", "- [x] Filter tasks by status") +
      "\n## Next release\n\n- Add a compact view for small screens.\n",
    "src/types.ts": initialFiles["src/types.ts"]!.replace(
      "export const STATUS_LABELS",
      "/** Options for filterTasks. Completed tasks stay hidden unless asked for. */\nexport interface FilterOptions {\n  includeCompleted?: boolean;\n}\n\nexport const STATUS_LABELS",
    ),
    "index.html": initialFiles["index.html"]!
      .replace(
        "    @media (max-width: 560px)",
        "    .filters { display: flex; gap: 18px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--rule); font: 11.5px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--soft); }\n    .filters .on { color: var(--ink); }\n    .filters .on::before { content: \"\\2611  \"; color: var(--accent); }\n    .shipped .task { display: none; }\n    .shipped::after { content: \"2 completed tasks hidden\"; display: block; margin-top: 10px; padding-top: 16px; border-top: 1px solid var(--rule); color: var(--soft); font: 11.5px var(--mono); letter-spacing: .08em; text-transform: uppercase; }\n    @media (max-width: 560px)",
      )
      .replace(
        '    <div class="board">',
        '    <div class="filters"><span>Search tasks</span><span class="on">Hide completed</span></div>\n\n    <div class="board">',
      ),
    // A new file that Git does not track yet.
    "CHANGELOG.md":
      "# Changelog\n\n## Unreleased\n\n- Search hides completed tasks by default. Pass `includeCompleted: true` to show them.\n- The board has a **Hide completed** filter.\n",
  };
  revision = 1;
  /** The branch is published, with an open pull request, and tracks this remote branch. */
  readonly upstream = upstreamName;
  /** The newest commit of this branch that the simulated remote has; later commits are ahead of it. */
  pushedOid = "";
  /** Commits the remote has that this branch lacks, oldest first, once a push has found them. */
  incoming: SampleCommit[] = [];
  /** Whether the teammate's commit has reached the remote. It happens once. */
  private teammatePushed = false;
  /** Folders created in the Files view before any file is added to them. */
  emptyFolders = new Set<string>();
  /** Paths copied or cut in the Files view, waiting to be pasted. */
  private clipboard: { paths: string[]; transferId: string | null } = { paths: [], transferId: null };
  /** File operations from the Files view, so they can be undone and redone. */
  private fileHistory: Array<{ label: string; before: FileTree; after: FileTree }> = [];
  private fileFuture: Array<{ label: string; before: FileTree; after: FileTree }> = [];
  /** Never reused, so an undone commit's oid does not come back. */
  private nextCommit = 1;
  /** Newest first. */
  commits: Entry[] = [];
  /** Commits a pull rewrote, by their old identifier. Like Git, the sample can still show them. */
  private rewritten = new Map<string, Entry>();
  constructor() {
    // Everything in the sample history is on the remote already: main, and the branch's pull request.
    for (const commit of sampleHistory) this.commits.unshift(this.entry(commit, "published"));
    this.pushedOid = this.commits[0]!.info.oid;
    this.label();
  }
  private entry(commit: SampleCommit, upstreamState: CommitInfo["upstreamState"]): Entry {
    const parents = this.commits[0] ? [this.commits[0].info.oid] : [];
    return {
      before: commit.before,
      after: commit.after,
      renames: commit.renames,
      info: {
        oid: commit.oid,
        shortOid: commit.oid.slice(0, 7),
        subject: commit.subject,
        body: commit.body,
        author: commit.author,
        email: commit.email,
        date: commit.date,
        decorations: [],
        parentOids: parents,
        parentCount: parents.length,
        upstreamState,
        isHead: false,
        baseState: commit.onMain ? "included" : "outside",
      },
    };
  }
  /** Mark the newest commit as HEAD and name the branches that end on each commit. */
  private label() {
    this.commits.forEach(({ info }, index) => {
      info.isHead = index === 0;
      info.decorations = [
        ...(index === 0 ? [`HEAD -> ${branchName}`] : []),
        ...(info.oid === this.pushedOid ? [upstreamName] : []),
        ...(info.oid === mainOid ? ["main", "origin/main"] : []),
      ];
    });
  }
  private newOid() {
    return sampleOid(`Commit ${this.nextCommit++} made in the demo`);
  }
  private requireFile(path: string) {
    if (!Object.hasOwn(this.working, path))
      throw new Error("Choose a file from the sample repository.");
  }
  /** A path Git knows about in any snapshot, including a deleted file. */
  private requireChange(path: string) {
    if (![this.head, this.index, this.working].some((files) => Object.hasOwn(files, path)))
      throw new Error("Choose a file from the sample repository.");
  }
  /** Copy a version into a snapshot, or remove it when that version does not exist. */
  private static assign(files: Record<string, string>, path: string, content: string | undefined) {
    if (content === undefined) delete files[path];
    else files[path] = content;
  }
  read(path: string) {
    this.requireFile(path);
    return this.working[path]!;
  }
  write(path: string, content: string, expected?: string) {
    this.requireFile(path);
    if (expected !== undefined && expected !== this.working[path])
      return { status: "conflict" as const };
    if (new TextEncoder().encode(content).length > 64 * 1024)
      throw new Error(
        "Keep this file under 64 KB.",
      );
    this.working[path] = content;
    this.revision++;
    return {
      status: "saved" as const,
      path,
      size: content.length,
      mtimeMs: this.revision,
    };
  }
  stage(paths: string[]) {
    for (const path of paths) this.requireChange(path);
    // Staging a deleted file stages its deletion.
    for (const path of paths) DemoRepository.assign(this.index, path, this.working[path]);
    this.revision++;
  }
  unstage(paths: string[]) {
    for (const path of paths) this.requireChange(path);
    // Unstaging a new file makes it untracked again.
    for (const path of paths) DemoRepository.assign(this.index, path, this.head[path]);
    this.revision++;
  }
  discard(paths: string[]) {
    for (const path of paths) this.requireChange(path);
    // Discarding an untracked file deletes it, as Git clean would; a deleted file comes back.
    for (const path of paths) DemoRepository.assign(this.working, path, this.index[path]);
    this.revision++;
  }
  /** Leave exactly these paths staged, as preparing one group of a commit plan does. */
  prepareGroup(paths: string[], previouslyStaged: string[]) {
    this.unstage(previouslyStaged.filter((path) => !paths.includes(path)));
    this.stage(paths);
  }
  private snapshot(): FileTree {
    return { working: { ...this.working }, emptyFolders: new Set(this.emptyFolders) };
  }
  private restore(tree: FileTree) {
    const current = Object.keys(this.working);
    this.working = { ...tree.working };
    this.emptyFolders = new Set(tree.emptyFolders);
    this.revision++;
    return {
      removedPaths: current.filter((path) => !Object.hasOwn(this.working, path)),
      restoredPaths: Object.keys(this.working).filter((path) => !current.includes(path)),
    };
  }
  /** Run a file operation and remember it for undo when it changed anything. */
  track<T>(label: string, operation: () => T): T {
    const before = this.snapshot();
    const result = operation();
    // A folder stops being empty once a file is added inside it.
    for (const folder of [...this.emptyFolders]) if (Object.keys(this.working).some((file) => file.startsWith(`${folder}/`))) this.emptyFolders.delete(folder);
    const after = this.snapshot();
    const changed = JSON.stringify([...Object.entries(before.working), ...before.emptyFolders]) !== JSON.stringify([...Object.entries(after.working), ...after.emptyFolders]);
    if (changed) {
      this.fileHistory.push({ label, before, after });
      this.fileFuture = [];
    }
    return result;
  }
  fileHistoryState(): FileHistoryState {
    return {
      canUndo: this.fileHistory.length > 0,
      undoLabel: this.fileHistory.at(-1)?.label ?? null,
      canRedo: this.fileFuture.length > 0,
      redoLabel: this.fileFuture.at(-1)?.label ?? null,
    };
  }
  undoFileOperation(direction: "undo" | "redo"): FileHistoryResult {
    const [from, to] = direction === "undo" ? [this.fileHistory, this.fileFuture] : [this.fileFuture, this.fileHistory];
    const entry = from.pop();
    if (!entry) return { status: "empty", state: this.fileHistoryState() };
    to.push(entry);
    const changes = this.restore(direction === "undo" ? entry.before : entry.after);
    return { status: "applied", direction, label: entry.label, pathChanges: [], ...changes, state: this.fileHistoryState() };
  }
  private static join(directory: string, name: string) {
    return directory && directory !== "." ? `${directory}/${name}` : name;
  }
  /** Whether a file or folder already exists at this path. */
  private exists(path: string) {
    return Object.keys(this.working).some((file) => file === path || file.startsWith(`${path}/`)) || this.emptyFolders.has(path);
  }
  /** Files at a path: the file itself, or everything inside a folder. */
  private filesAt(path: string) {
    return Object.keys(this.working).filter((file) => file === path || file.startsWith(`${path}/`));
  }
  createEntry(directory: string, name: string, kind: "file" | "directory") {
    if (!name || name.includes("/")) throw new Error("Enter a name without slashes.");
    const path = DemoRepository.join(directory, name);
    if (this.exists(path)) return { status: "conflict" as const, path };
    if (kind === "file") this.working[path] = "";
    else this.emptyFolders.add(path);
    this.revision++;
    return { status: "created" as const, path, kind };
  }
  createFile(directory: string, name: string) {
    return this.createEntry(directory, name, "file");
  }
  /** Move a file or folder to a new path, keeping every file inside it. */
  private relocate(path: string, target: string) {
    for (const file of this.filesAt(path)) {
      this.working[target + file.slice(path.length)] = this.working[file]!;
      delete this.working[file];
    }
    for (const folder of [...this.emptyFolders]) {
      if (folder !== path && !folder.startsWith(`${path}/`)) continue;
      this.emptyFolders.delete(folder);
      this.emptyFolders.add(target + folder.slice(path.length));
    }
  }
  /** Move entries into a folder. Entries whose name is taken there are reported as conflicts. */
  move(paths: string[], targetDirectory: string) {
    const moved: { from: string; to: string }[] = [];
    const conflicts: string[] = [];
    for (const path of paths) {
      const to = DemoRepository.join(targetDirectory, path.split("/").at(-1)!);
      if (to === path) continue;
      if (this.exists(to) || to.startsWith(`${path}/`)) { conflicts.push(path); continue; }
      this.relocate(path, to);
      moved.push({ from: path, to });
    }
    this.revision++;
    return { moved, conflicts };
  }
  /** What a paste would use: the paths last copied or cut in the Files view. */
  clipboardPaths() {
    return [...this.clipboard.paths];
  }
  copy(paths: string[]) {
    this.clipboard = { paths: [...paths], transferId: null };
    return { copied: paths.length, paths };
  }
  cut(paths: string[]) {
    this.clipboard = { paths: [...paths], transferId: `demo-cut-${this.revision}` };
    return { cut: paths.length, paths, transferId: this.clipboard.transferId! };
  }
  /** Paste copied entries as copies, renamed when needed, or move cut entries. */
  paste(targetDirectory: string, sourcePaths: string[], cutTransferId?: string | null) {
    const sources = sourcePaths.length ? sourcePaths : this.clipboard.paths;
    if (!sources.length) return { status: "empty" as const, created: [] as [] };
    if (cutTransferId && cutTransferId === this.clipboard.transferId) {
      const { moved } = this.move(sources, targetDirectory);
      this.clipboard = { paths: [], transferId: null };
      return { status: "pasted" as const, source: "cut" as const, created: moved.map((m) => m.to) };
    }
    const created: string[] = [];
    for (const source of sources) {
      const name = source.split("/").at(-1)!;
      const dot = name.lastIndexOf(".");
      const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
      let target = DemoRepository.join(targetDirectory, name);
      for (let copy = 1; this.exists(target); copy++) target = DemoRepository.join(targetDirectory, `${stem} copy${copy > 1 ? ` ${copy}` : ""}${extension}`);
      for (const file of this.filesAt(source)) this.working[target + file.slice(source.length)] = this.working[file]!;
      created.push(target);
    }
    this.revision++;
    return { status: "pasted" as const, source: "files" as const, created };
  }
  /** Rename a file or a folder, moving every file inside it. */
  rename(path: string, name: string) {
    const target = [...path.split("/").slice(0, -1), name].join("/");
    if (target === path) return { status: "noop" as const, path };
    if (!this.exists(path)) throw new Error("Choose a file from the sample repository.");
    if (this.exists(target)) return { status: "conflict" as const, path: target };
    this.relocate(path, target);
    this.revision++;
    return { status: "renamed" as const, from: path, to: target };
  }
  /** Delete files, or folders with everything inside them, from the working tree. */
  remove(paths: string[]) {
    const files = paths.flatMap((path) => this.filesAt(path));
    for (const file of files) delete this.working[file];
    const folders = [...this.emptyFolders].filter((folder) => paths.some((path) => folder === path || folder.startsWith(`${path}/`)));
    for (const folder of folders) this.emptyFolders.delete(folder);
    this.revision++;
    return files.length + folders.length;
  }
  /** Replace literal search matches in the working tree. */
  replace(request: SearchReplaceRequest) {
    const { options, replacement, scope } = request;
    const targets = scope.kind === "all" ? scope.files.map((file) => file.path) : [scope.path];
    const changed: string[] = [];
    let replacements = 0;
    for (const path of targets) {
      const content = this.working[path];
      if (content === undefined) continue;
      const matches = findSearchMatches(content, options, 10_000).filter((m) => scope.kind !== "match" || (m.line === scope.line && m.column === scope.column));
      if (!matches.length) continue;
      let next = content;
      for (const m of [...matches].sort((a, b) => b.start - a.start)) next = next.slice(0, m.start) + replacement + next.slice(m.end);
      this.working[path] = next;
      changed.push(path);
      replacements += matches.length;
    }
    this.revision++;
    return replacements ? { status: "replaced" as const, replacements, files: changed } : { status: "no-match" as const };
  }
  status(): RepositoryStatus {
    const changes = [...new Set([...Object.keys(this.head), ...Object.keys(this.index), ...Object.keys(this.working)])]
      .sort()
      .filter(
        (path) =>
          this.head[path] !== this.working[path] ||
          this.head[path] !== this.index[path],
      )
      .map((path) => {
        const staged = this.head[path] !== this.index[path],
          unstaged = this.index[path] !== this.working[path];
        const untracked = this.index[path] === undefined && this.head[path] === undefined,
          added = !untracked && this.head[path] === undefined,
          stagedDeletion = this.index[path] === undefined && this.head[path] !== undefined,
          deleted = this.working[path] === undefined && !untracked;
        return {
          path,
          indexStatus: untracked ? "?" : staged ? (added ? "A" : stagedDeletion ? "D" : "M") : ".",
          worktreeStatus: untracked ? "?" : unstaged ? (this.working[path] === undefined ? "D" : "M") : ".",
          kind: untracked ? ("untracked" as const) : added ? ("added" as const) : deleted ? ("deleted" as const) : ("modified" as const),
          staged,
          unstaged,
          conflict: false,
          submodule: "N...",
        };
      });
    return {
      branch: branchName,
      oid: this.commits[0]!.info.oid,
      upstream: this.upstream,
      ahead: this.ahead(),
      behind: this.behind(),
      insertions: changes.reduce(
        (n, f) =>
          n + counts(this.head[f.path] ?? "", this.working[f.path] ?? "").additions,
        0,
      ),
      deletions: changes.reduce(
        (n, f) =>
          n + counts(this.head[f.path] ?? "", this.working[f.path] ?? "").deletions,
        0,
      ),
      detached: false,
      unborn: false,
      operation: null,
      readOnly: false,
      changes,
      stagedCount: changes.filter((f) => f.staged).length,
      unstagedCount: changes.filter((f) => f.unstaged).length,
    };
  }
  diff(path: string, kind: "staged" | "unstaged"): DiffResult {
    this.requireChange(path);
    const before = (kind === "staged" ? this.head : this.index)[path];
    const after = (kind === "staged" ? this.index : this.working)[path];
    const text = patch(path, before ?? "", after ?? "", before === undefined, after === undefined);
    return {
      path,
      patch: text,
      binary: false,
      truncated: false,
      lineCount: text.split("\n").length,
    };
  }
  /** Commits made in this page that the simulated remote does not have yet. */
  ahead() {
    const index = this.commits.findIndex((c) => c.info.oid === this.pushedOid);
    return index < 0 ? 0 : index;
  }
  /**
   * Commits on the branch that came after this one, or null when the branch does not have it.
   * The history is one line, newest first, so they are the ones listed above it.
   */
  commitsAfter(oid: string): number | null {
    const index = this.commits.findIndex((c) => c.info.oid === oid);
    return index < 0 ? null : index;
  }
  /** Commits the remote is known to have that this branch lacks. */
  behind() {
    return this.incoming.length;
  }
  /** The branch as the remote has it, oldest first: its own commits, without those of main. */
  remoteBranch(): SampleCommit[] {
    const published = this.commits.slice(this.ahead()).filter((c) => c.info.baseState !== "included").reverse();
    return [
      ...published.map(({ info, before, after, renames }) => ({ oid: info.oid, subject: info.subject, body: info.body, author: info.author, email: info.email, date: info.date, before, after, renames, onMain: false })),
      ...this.incoming,
    ];
  }
  /**
   * Push every local commit to the simulated remote. A teammate pushes to the branch first, once:
   * that push is refused the way Git refuses it, and so is any other while the branch is behind.
   */
  push(): { status: "pushed"; commits: number } | { status: "behind"; ahead: number; behind: number; incoming: string[]; refused: boolean } {
    const commits = this.ahead();
    const refused = commits > 0 && !this.teammatePushed;
    if (refused) {
      this.teammatePushed = true;
      this.incoming = [teammateCommit(this.commits[commits]!.after)];
      this.revision++;
    }
    if (this.incoming.length) {
      return { status: "behind", ahead: commits, behind: this.incoming.length, incoming: this.incoming.map((c) => `${c.oid.slice(0, 7)} ${c.subject}`).reverse(), refused };
    }
    this.pushedOid = this.commits[0]!.info.oid;
    for (const commit of this.commits) commit.info.upstreamState = "published";
    this.label();
    this.revision++;
    return { status: "pushed", commits };
  }
  /**
   * The local changes a fast-forward would have to overwrite, as Git refuses it: files the remote's
   * commits change that are changed here too, staged or not, or that are new here.
   */
  changesInTheWayOfPull(): string[] {
    const touched = new Set(this.incoming.flatMap((commit) => [...new Set([...Object.keys(commit.before), ...Object.keys(commit.after)])]
      .filter((path) => commit.before[path] !== commit.after[path])));
    return [...touched].filter((path) => this.working[path] !== this.head[path] || this.index[path] !== this.head[path]);
  }
  /**
   * Bring in the remote's commits and put the local ones on top of them, as a rebasing pull does.
   * The local commits get new identifiers; uncommitted and staged changes stay as they were.
   */
  pull(): { commits: number; localCommits: number; restoredLocalChanges: boolean } | null {
    const incoming = this.incoming;
    if (!incoming.length) return null;
    this.incoming = [];
    const local = this.commits.splice(0, this.ahead()).reverse();
    const head = this.head;
    const restoredLocalChanges = this.status().changes.length > 0;
    /** What the remote's commits changed, laid over a tree wherever the tree still had the old version. */
    const bring = (tree: Tree, base: Tree = tree) => {
      const next = { ...tree };
      for (const commit of incoming) {
        for (const path of new Set([...Object.keys(commit.before), ...Object.keys(commit.after)])) {
          if (commit.before[path] !== commit.after[path] && base[path] === commit.before[path]) DemoRepository.assign(next, path, commit.after[path]);
        }
      }
      return next;
    };
    for (const commit of incoming) this.commits.unshift(this.entry(commit, "published"));
    this.pushedOid = this.commits[0]!.info.oid;
    for (const commit of local) {
      this.rewritten.set(commit.info.oid, commit);
      this.commits.unshift({
        before: bring(commit.before),
        after: bring(commit.after),
        renames: commit.renames,
        info: { ...commit.info, oid: "", shortOid: "", parentOids: [this.commits[0]!.info.oid] },
      });
      const oid = this.newOid();
      Object.assign(this.commits[0]!.info, { oid, shortOid: oid.slice(0, 7) });
    }
    this.head = bring(head);
    this.index = bring(this.index, head);
    this.working = bring(this.working, head);
    this.label();
    this.revision++;
    return { commits: incoming.length, localCommits: local.length, restoredLocalChanges };
  }
  /** Undo the newest unpushed commit and keep its changes staged, like git reset --soft. */
  undoLatest(expectedOid: string): UndoLatestCommitResult {
    const latest = this.commits[0]!;
    if (latest.info.oid !== expectedOid) return { status: "stale-head" };
    if (this.ahead() <= 0) return { status: "not-local" };
    this.commits.shift();
    this.label();
    this.head = { ...latest.before };
    this.revision++;
    return { status: "success", undoneOid: latest.info.oid, newHeadOid: this.commits[0]!.info.oid, message: latest.info.subject, stagedCount: this.status().stagedCount };
  }
  commit(message: string) {
    if (!message.trim()) throw new Error("Write a commit message first.");
    if (!this.status().stagedCount)
      throw new Error("Stage at least one change first.");
    const [subject = "", ...body] = message.trim().split("\n");
    const oid = this.newOid();
    this.commits.unshift(this.entry({
      oid, subject, body: body.join("\n").trim(), ...demoAuthor, date: new Date().toISOString(),
      before: { ...this.head }, after: { ...this.index }, renames: {}, onMain: false,
    }, "local-only"));
    this.label();
    this.head = { ...this.index };
    this.revision++;
    return { ok: true as const, oid };
  }
  getCommit(oid: string) {
    const item = this.commits.find((c) => c.info.oid === oid) ?? this.rewritten.get(oid);
    if (!item) throw new Error("Choose a commit from the sample history.");
    return item;
  }
  commitFiles(oid: string): CommitFile[] {
    const { before, after, renames } = this.getCommit(oid);
    return changedFiles(before, after, renames);
  }
  /** The sample commits that changed a file, newest first, following its renames as `git log --follow` does. */
  historyOfFile(path: string): FileHistoryEntry[] {
    const entries: FileHistoryEntry[] = [];
    let current = path;
    for (const commit of this.commits) {
      const file = this.commitFiles(commit.info.oid).find((item) => item.path === current);
      if (!file) continue;
      entries.push({ commit: { ...commit.info }, path: file.path, oldPath: file.oldPath, kind: file.kind, additions: file.additions, deletions: file.deletions, binary: file.binary });
      current = file.oldPath ?? current;
    }
    return entries;
  }
  commitDiff(oid: string, path?: string): DiffResult {
    const { before, after } = this.getCommit(oid);
    const files = this.commitFiles(oid).filter((file) => !path || file.path === path || file.oldPath === path);
    if (path && !files.length && !Object.hasOwn(after, path) && !Object.hasOwn(before, path)) throw new Error("File is not in this commit.");
    const text = files.map((file) => filePatch(file, before, after)).join("");
    return {
      path: path ?? "",
      patch: text,
      binary: false,
      truncated: false,
      lineCount: text.split("\n").length,
    };
  }
  directoryEntries(path: string): FileTreeEntry[] {
    if (!path || path === ".") return this.files();
    let level = this.files();
    let folder: FileTreeEntry | undefined;
    for (const part of path.split("/")) {
      folder = level.find((entry) => entry.name === part && entry.type === "directory");
      if (folder?.type !== "directory") return [];
      level = folder.children;
    }
    return level;
  }
  /** Nested tree of working files: folders first, then files, each sorted by name. */
  files(): FileTreeEntry[] {
    const tree = (prefix: string): FileTreeEntry[] => {
      const paths = Object.keys(this.working).filter((path) => path.startsWith(prefix));
      const nested = [...paths, ...[...this.emptyFolders].filter((folder) => folder.startsWith(prefix)).map((folder) => `${folder}/`)];
      const folders = [...new Set(nested.map((path) => path.slice(prefix.length)).filter((rest) => rest.includes("/")).map((rest) => rest.split("/")[0]!))].sort();
      const files = paths.filter((path) => !path.slice(prefix.length).includes("/")).sort((a, b) => a.localeCompare(b));
      return [
        ...folders.map((name) => ({ path: prefix + name, name, type: "directory" as const, children: tree(`${prefix}${name}/`) })),
        ...files.map((path) => ({ path, name: path.slice(prefix.length), type: "file" as const, size: this.working[path]!.length, mtimeMs: this.revision })),
      ];
    };
    return tree("");
  }
}
