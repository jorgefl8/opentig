import { sampleHtml } from "./sample-html.ts";
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
  "README.md":
    "# Launchpad\n\nA small task list for planning a project launch.\n",
  "package.json":
    '{\n  "name": "launchpad",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
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
export function patch(path: string, before: string, after: string): string {
  if (before === after) return "";
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
    "README.md":
      initialFiles["README.md"]! +
      "\n## Next release\n\n- Add a compact view for small screens.\n",
  };
  revision = 1;
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
    for (const path of paths) this.index[path] = this.head[path]!;
    this.revision++;
  }
  discard(paths: string[]) {
    for (const path of paths) this.requireFile(path);
    for (const path of paths) this.working[path] = this.index[path]!;
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
        return {
          path,
          indexStatus: staged ? "M" : ".",
          worktreeStatus: unstaged ? "M" : ".",
          kind: "modified" as const,
          staged,
          unstaged,
          conflict: false,
          submodule: "N...",
        };
      });
    return {
      branch: "feature/task-filters",
      oid: this.commits[0]!.info.oid,
      upstream: null,
      ahead: 0,
      behind: 0,
      insertions: changes.reduce(
        (n, f) =>
          n + counts(this.head[f.path]!, this.working[f.path]!).additions,
        0,
      ),
      deletions: changes.reduce(
        (n, f) =>
          n + counts(this.head[f.path]!, this.working[f.path]!).deletions,
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
    const text = patch(
      path,
      (kind === "staged" ? this.head : this.index)[path]!,
      (kind === "staged" ? this.index : this.working)[path]!,
    );
    return {
      path,
      patch: text,
      binary: false,
      truncated: false,
      lineCount: text.split("\n").length,
    };
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
      .map((p) => patch(p, before[p] ?? "", after[p] ?? ""))
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
    const folder = this.files().find((entry) => entry.path === path);
    return folder?.type === "directory" ? folder.children ?? [] : [];
  }
  files(): FileTreeEntry[] {
    const entries = Object.entries(this.working).map(([path, content]) => ({
      path,
      name: path.split("/").at(-1)!,
      type: "file" as const,
      size: content.length,
      mtimeMs: this.revision,
    }));
    return [
      ...["src", "test"].map((path) => ({
        path,
        name: path,
        type: "directory" as const,
        children: entries.filter((f) => f.path.startsWith(path + "/")),
      })),
      ...entries.filter((f) => !f.path.includes("/")),
    ];
  }
}
