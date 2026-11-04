import { sampleHtml } from "./sample-html.ts";
import { sampleLogo, samplePackage, sampleProgress, sampleReadme, sampleTasks, sampleTsconfig, sampleTypes, sampleWorkflow } from "./sample-files.ts";
import { createTwoFilesPatch, diffLines } from "diff";
import type {
  CommitFile,
  CommitInfo,
  FileTreeEntry,
  RepositoryStatus,
} from "../../src/shared/git-types";
import type { DiffResult } from "../../src/shared/contracts";

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
export function patch(path: string, before: string, after: string, added = false): string {
  if (before === after) return "";
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
  /** PR #21 is open from this branch, so it already tracks its remote branch. */
  upstream = "origin/feature/task-filters";
  /** The newest commit the simulated remote has; later commits are ahead of it. */
  pushedOid = "";
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
    for (const path of paths) this.requireFile(path);
    for (const path of paths) this.index[path] = this.working[path]!;
    this.revision++;
  }
  unstage(paths: string[]) {
    for (const path of paths) this.requireFile(path);
    for (const path of paths) {
      // Unstaging a new file makes it untracked again.
      if (this.head[path] === undefined) delete this.index[path];
      else this.index[path] = this.head[path]!;
    }
    this.revision++;
  }
  discard(paths: string[]) {
    for (const path of paths) this.requireFile(path);
    for (const path of paths) {
      // Discarding an untracked file deletes it, as Git clean would.
      if (this.index[path] === undefined) delete this.working[path];
      else this.working[path] = this.index[path]!;
    }
    this.revision++;
  }
  status(): RepositoryStatus {
    const changes = Object.keys(this.working)
      .filter(
        (path) =>
          this.head[path] !== this.working[path] ||
          this.head[path] !== this.index[path],
      )
      .map((path) => {
        const staged = this.head[path] !== this.index[path],
          unstaged = this.index[path] !== this.working[path];
        const untracked = this.index[path] === undefined,
          added = !untracked && this.head[path] === undefined;
        return {
          path,
          indexStatus: untracked ? "?" : staged ? (added ? "A" : "M") : ".",
          worktreeStatus: untracked ? "?" : unstaged ? "M" : ".",
          kind: untracked ? ("untracked" as const) : added ? ("added" as const) : ("modified" as const),
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
          n + counts(this.head[f.path] ?? "", this.working[f.path]!).additions,
        0,
      ),
      deletions: changes.reduce(
        (n, f) =>
          n + counts(this.head[f.path] ?? "", this.working[f.path]!).deletions,
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
    this.requireFile(path);
    const before = (kind === "staged" ? this.head : this.index)[path];
    const text = patch(
      path,
      before ?? "",
      (kind === "staged" ? this.index : this.working)[path] ?? "",
      before === undefined,
    );
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
  /** Push every local commit to the simulated remote. */
  push() {
    const commits = this.ahead();
    this.pushedOid = this.commits[0]!.info.oid;
    this.revision++;
    return commits;
  }
  commit(message: string) {
    if (!message.trim()) throw new Error("Write a commit message first.");
    if (!this.status().stagedCount)
      throw new Error("Stage at least one change first.");
    const oid = `${this.commits.length.toString(16).padStart(7, "0")}${"d".repeat(33)}`;
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
    return Object.keys(after)
      .filter((path) => before[path] !== after[path])
      .map((path) => ({
        path,
        oldPath: null,
        kind: before[path] === undefined ? "added" : "modified",
        ...counts(before[path] ?? "", after[path]!),
        binary: false,
      }));
  }
  commitDiff(oid: string, path?: string): DiffResult {
    const { before, after } = this.getCommit(oid);
    const paths = path ? [path] : this.commitFiles(oid).map((f) => f.path);
    if (path && !Object.hasOwn(after, path))
      throw new Error("File is not in this commit.");
    const text = paths
      .map((p) => patch(p, before[p] ?? "", after[p] ?? "", before[p] === undefined))
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
      const folders = [...new Set(paths.map((path) => path.slice(prefix.length)).filter((rest) => rest.includes("/")).map((rest) => rest.split("/")[0]!))].sort();
      const files = paths.filter((path) => !path.slice(prefix.length).includes("/")).sort((a, b) => a.localeCompare(b));
      return [
        ...folders.map((name) => ({ path: prefix + name, name, type: "directory" as const, children: tree(`${prefix}${name}/`) })),
        ...files.map((path) => ({ path, name: path.slice(prefix.length), type: "file" as const, size: this.working[path]!.length, mtimeMs: this.revision })),
      ];
    };
    return tree("");
  }
}
