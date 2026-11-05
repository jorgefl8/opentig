import { sampleHtml } from "./sample-html.ts";
import { sampleLogo, samplePackage, sampleProgress, sampleReadme, sampleTasks, sampleTsconfig, sampleTypes, sampleWorkflow } from "./sample-files.ts";
import { createTwoFilesPatch, diffLines } from "diff";
import { findSearchMatches, type SearchReplaceRequest } from "../../src/shared/search.ts";
import type {
  CommitFile,
  CommitInfo,
  FileTreeEntry,
  RepositoryStatus,
} from "../../src/shared/git-types";
import type { DiffResult, FileHistoryResult, FileHistoryState, UndoLatestCommitResult } from "../../src/shared/contracts";

export const repository = {
  id: "launchpad",
  name: "launchpad",
  repositoryName: "launchpad",
  path: "/demo/launchpad",
  commonDir: "/demo/launchpad/.git",
};
export const sampleDate = "2026-01-15T12:00:00.000Z";
export const initialFiles: Record<string, string> = {
  ".github/workflows/ci.yml": sampleWorkflow,
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

type FileTree = { working: Record<string, string>; emptyFolders: Set<string> };

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
  /** Unpublished at first, so visitors can try Publish; it then tracks this remote branch. */
  upstream: string | null = null;
  /** The newest commit the simulated remote has; later commits are ahead of it. */
  pushedOid = "";
  /** Folders created in the Files view before any file is added to them. */
  emptyFolders = new Set<string>();
  /** Paths copied or cut in the Files view, waiting to be pasted. */
  private clipboard: { paths: string[]; transferId: string | null } = { paths: [], transferId: null };
  /** File operations from the Files view, so they can be undone and redone. */
  private fileHistory: Array<{ label: string; before: FileTree; after: FileTree }> = [];
  private fileFuture: Array<{ label: string; before: FileTree; after: FileTree }> = [];
  /** Never reused, so an undone commit's oid does not come back. */
  private nextCommit = 1;
  commits: Array<{
    info: CommitInfo;
    before: Record<string, string>;
    after: Record<string, string>;
  }> = [];
  constructor() {
    this.commits.push({
      info: this.info("a".repeat(40), "Add the Launchpad task filter", []),
      before: {},
      after: { ...initialFiles },
    });
    // The first commit is already on the remote's main branch.
    this.commits[0]!.info.upstreamState = "published";
    this.pushedOid = this.commits[0]!.info.oid;
  }
  private info(oid: string, message: string, parents: string[]): CommitInfo {
    const [subject = "", ...body] = message.split("\n");
    return {
      oid,
      shortOid: oid.slice(0, 7),
      subject,
      body: body.join("\n"),
      author: "OpenTig Demo",
      email: "demo@example.com",
      date: sampleDate,
      decorations: ["feature/task-filters"],
      parentOids: parents,
      parentCount: parents.length,
      upstreamState: "local-only",
      isHead: true,
      baseState: "outside",
    };
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
      branch: "feature/task-filters",
      oid: this.commits[0]!.info.oid,
      upstream: this.upstream,
      ahead: this.ahead(),
      behind: 0,
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
    if (!this.upstream) return 0;
    const index = this.commits.findIndex((c) => c.info.oid === this.pushedOid);
    return index < 0 ? 0 : index;
  }
  /** Publish the branch the first time, then push every local commit to the simulated remote. */
  push(): { published: true } | { published: false; commits: number } {
    const published = !this.upstream;
    const commits = this.ahead();
    this.upstream = "origin/feature/task-filters";
    this.pushedOid = this.commits[0]!.info.oid;
    for (const commit of this.commits) commit.info.upstreamState = "published";
    this.revision++;
    return published ? { published: true } : { published: false, commits };
  }
  /** Undo the newest unpushed commit and keep its changes staged, like git reset --soft. */
  undoLatest(expectedOid: string): UndoLatestCommitResult {
    if (!this.upstream) return { status: "no-upstream" };
    const latest = this.commits[0]!;
    if (latest.info.oid !== expectedOid) return { status: "stale-head" };
    if (this.ahead() <= 0) return { status: "not-local" };
    this.commits.shift();
    const head = this.commits[0]!;
    head.info.isHead = true;
    head.info.decorations = ["feature/task-filters"];
    this.head = { ...latest.before };
    this.revision++;
    return { status: "success", undoneOid: latest.info.oid, newHeadOid: head.info.oid, message: latest.info.subject, stagedCount: this.status().stagedCount };
  }
  commit(message: string) {
    if (!message.trim()) throw new Error("Write a commit message first.");
    if (!this.status().stagedCount)
      throw new Error("Stage at least one change first.");
    const oid = `${(this.nextCommit++).toString(16).padStart(7, "0")}${"d".repeat(33)}`;
    this.commits[0]!.info.isHead = false;
    this.commits[0]!.info.decorations = [];
    this.commits.unshift({
      info: this.info(oid, message.trim(), [this.commits[0]!.info.oid]),
      before: { ...this.head },
      after: { ...this.index },
    });
    this.head = { ...this.index };
    this.revision++;
    return { ok: true as const, oid };
  }
  getCommit(oid: string) {
    const item = this.commits.find((c) => c.info.oid === oid);
    if (!item) throw new Error("Choose a commit from the sample history.");
    return item;
  }
  commitFiles(oid: string): CommitFile[] {
    const { before, after } = this.getCommit(oid);
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .map((path) => ({
        path,
        oldPath: null,
        kind: before[path] === undefined ? "added" : after[path] === undefined ? "deleted" : "modified",
        ...counts(before[path] ?? "", after[path] ?? ""),
        binary: false,
      }));
  }
  commitDiff(oid: string, path?: string): DiffResult {
    const { before, after } = this.getCommit(oid);
    const paths = path ? [path] : this.commitFiles(oid).map((f) => f.path);
    if (path && !Object.hasOwn(after, path) && !Object.hasOwn(before, path))
      throw new Error("File is not in this commit.");
    const text = paths
      .map((p) => patch(p, before[p] ?? "", after[p] ?? "", before[p] === undefined, after[p] === undefined))
      .join("");
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
