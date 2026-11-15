import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch } from "diff";
import { DemoRepository, initialFiles, mainOid, patch, sampleHistory } from "../demo/model.ts";
const filter = "src/filter-tasks.js";
const tests = "test/filter-tasks.test.js";
/** Working changes the sample workflow leaves for later, including the untracked changelog. */
const others = ["CHANGELOG.md", "README.md", "index.html", "src/types.ts"];

test("commits exactly the staged versions and leaves unrelated and later edits outside", () => {
  const repo = new DemoRepository();
  const chosen = repo
    .read(filter)
    .replace("query.toLowerCase()", "query.trim().toLowerCase()");
  repo.write(filter, chosen);
  repo.stage([filter, tests]);
  repo.write(filter, chosen + "// Later edit\n");
  assert.equal(repo.status().stagedCount, 2);
  assert.equal(repo.status().unstagedCount, 1 + others.length);
  assert.match(repo.diff(filter, "unstaged").patch, /Later edit/);
  assert.doesNotMatch(repo.diff(filter, "staged").patch, /Later edit/);
  const { oid } = repo.commit("Trim the task filter query");
  assert.deepEqual(
    repo
      .commitFiles(oid)
      .map((f) => f.path)
      .sort(),
    [filter, tests],
  );
  assert.equal(repo.head[filter], chosen);
  assert.match(repo.read(filter), /Later edit/);
  assert.equal(repo.status().stagedCount, 0);
  assert.deepEqual(
    repo
      .status()
      .changes.map((f) => f.path)
      .sort(),
    [...others, filter].sort(),
  );
  assert.equal(repo.commits[1].info.isHead, false);
  assert.equal(repo.commits[0].info.parentOids[0], repo.commits[1].info.oid);
});

test("discard restores the staged version, while unstage preserves working edits", () => {
  const repo = new DemoRepository();
  const chosen = repo.read(filter);
  repo.stage([filter]);
  repo.write(filter, "new edit");
  repo.discard([filter]);
  assert.equal(repo.read(filter), chosen);
  assert.equal(repo.diff(filter, "unstaged").patch, "");
  repo.unstage([filter]);
  assert.equal(repo.read(filter), chosen);
  assert.equal(repo.status().stagedCount, 0);
  repo.discard([filter]);
  assert.equal(repo.read(filter), repo.head[filter]);
});

test("new sessions restore the sample independently of edits and commits elsewhere", () => {
  const first = new DemoRepository();
  const original = first.read(filter);
  first.write(filter, "changed");
  first.stage([filter]);
  first.commit("Sample");
  const second = new DemoRepository();
  assert.equal(second.read(filter), original);
  assert.equal(second.commits.length, sampleHistory.length);
  assert.equal(second.status().unstagedCount, 2 + others.length);
  assert.equal(second.status().stagedCount, 0);
});

test("conflicting saves and invalid operations cannot mutate the sample", () => {
  const repo = new DemoRepository();
  const original = repo.read(filter);
  assert.deepEqual(repo.write(filter, "replacement", "stale"), {
    status: "conflict",
  });
  assert.equal(repo.read(filter), original);
  assert.throws(() => repo.write(filter, "x".repeat(65537)), /64 KB/);
  assert.throws(() => repo.stage([filter, "../private"]), /sample repository/);
  assert.equal(repo.status().stagedCount, 0);
  assert.throws(() => repo.commit(""), /message/);
  assert.throws(() => repo.commit("No files"), /Stage/);
  assert.throws(() => repo.read("__proto__"), /sample repository/);
  assert.throws(() => repo.commitDiff("unknown"), /sample history/);
});

test("patches represent empty files, missing newlines and identical content", () => {
  assert.equal(patch("a", "same", "same"), "");
  assert.match(patch("a", "", "new\n"), /@@ -0,0 \+1,1 @@\n\+new\n$/);
  assert.match(patch("a", "old\n", ""), /@@ -1,1 \+0,0 @@\n-old\n$/);
  assert.equal(
    patch("a", "old", "new").split("\\ No newline at end of file").length,
    3,
  );
});

// A visitor can continue working after the sample workflow, without restarting.
test('supports repeated editing and commits beyond the former session limit', () => {
  const repo = new DemoRepository();
  const firstOid = repo.commits[0].info.oid;
  const oids = new Set([firstOid]);
  for (let i = 0; i < 40; i++) {
    repo.write(filter, `export const revision = ${i};\n`);
    repo.stage([filter]);
    const { oid } = repo.commit(`Revision ${i}`);
    assert.equal(oids.has(oid), false);
    oids.add(oid);
    assert.equal(repo.head[filter], `export const revision = ${i};\n`);
  }
  assert.equal(repo.commits.length, sampleHistory.length + 40);
  assert.equal(repo.getCommit(firstOid).info.subject, 'Describe the task filter in the README');
  assert.equal(repo.status().stagedCount, 0);
  assert.deepEqual(repo.status().changes.map(f => f.path).sort(), [...others, tests].sort());
});

test("an untracked file can be staged as added, unstaged, committed, or discarded", () => {
  const repo = new DemoRepository();
  const changelog = () => repo.status().changes.find((f) => f.path === "CHANGELOG.md");
  assert.deepEqual([changelog().kind, changelog().indexStatus, changelog().staged], ["untracked", "?", false]);
  assert.match(repo.diff("CHANGELOG.md", "unstaged").patch, /new file mode 100644\n--- \/dev\/null/);
  repo.stage(["CHANGELOG.md"]);
  assert.deepEqual([changelog().kind, changelog().indexStatus, changelog().staged], ["added", "A", true]);
  repo.unstage(["CHANGELOG.md"]);
  assert.equal(changelog().kind, "untracked");
  repo.stage(["CHANGELOG.md"]);
  const { oid } = repo.commit("Start a changelog");
  assert.deepEqual(repo.commitFiles(oid).map((f) => [f.path, f.kind]), [["CHANGELOG.md", "added"]]);
  assert.equal(changelog(), undefined);

  const fresh = new DemoRepository();
  fresh.discard(["CHANGELOG.md"]);
  assert.equal(fresh.files().some((f) => f.path === "CHANGELOG.md"), false);
});

test("the sample history is one line that ends on the sample files, with main below the branch", () => {
  const repo = new DemoRepository();
  assert.deepEqual(repo.commits[0].after, initialFiles);
  assert.deepEqual(repo.commits.at(-1).before, {});
  repo.commits.forEach((commit, index) => {
    const parent = repo.commits[index + 1];
    assert.ok(repo.commitFiles(commit.info.oid).length > 0, commit.info.subject);
    assert.deepEqual(commit.info.parentOids, parent ? [parent.info.oid] : []);
    if (parent) assert.deepEqual(commit.before, parent.after, commit.info.subject);
    if (parent) assert.ok(Date.parse(commit.info.date) > Date.parse(parent.info.date), commit.info.subject);
  });
  // The branch's own commits sit on top of main's, and the remote has them all.
  assert.deepEqual(repo.commits.map((c) => c.info.baseState), ["outside", "outside", "included", "included", "included"]);
  assert.equal(repo.commits[2].info.oid, mainOid);
  assert.ok(repo.commits.every((c) => c.info.upstreamState === "published"));
  assert.deepEqual([repo.status().upstream, repo.status().ahead, repo.status().behind], ["origin/feature/task-filters", 0, 0]);
});

test("one commit of the sample history adds, modifies, deletes, and renames a file", () => {
  const repo = new DemoRepository();
  const commit = repo.commits.find((c) => c.info.subject === "Turn search into a task filter");
  const { oid } = commit.info;
  assert.deepEqual(repo.commitFiles(oid).map((f) => [f.kind, f.oldPath, f.path]), [
    ["modified", null, "package.json"],
    ["renamed", "src/search.js", filter],
    ["added", null, tests],
    ["deleted", null, "test/smoke.js"],
  ]);
  // The viewer reads the kind of each change from the patch, so the patch has to say the same.
  const whole = repo.commitDiff(oid).patch;
  assert.match(whole, /^diff --git a\/src\/search\.js b\/src\/filter-tasks\.js\nsimilarity index \d+%\nrename from src\/search\.js\nrename to src\/filter-tasks\.js\n--- a\/src\/search\.js\n\+\+\+ b\/src\/filter-tasks\.js\n@@/m);
  assert.match(whole, /^diff --git a\/test\/filter-tasks\.test\.js b\/test\/filter-tasks\.test\.js\nnew file mode 100644\n--- \/dev\/null$/m);
  assert.match(whole, /^diff --git a\/test\/smoke\.js b\/test\/smoke\.js\ndeleted file mode 100644\n--- a\/test\/smoke\.js\n\+\+\+ \/dev\/null$/m);
  // A renamed file opens from either of its paths, as what the old file became.
  const renamed = repo.commitDiff(oid, filter).patch;
  assert.equal(repo.commitDiff(oid, "src/search.js").patch, renamed);
  assert.equal(applyPatch(commit.before["src/search.js"], renamed.slice(renamed.indexOf("--- "))), commit.after[filter]);
  assert.throws(() => repo.commitDiff(oid, "missing.js"), /not in this commit/);
});

test("the first push runs into a teammate's commit, and pulling puts the local commits on top of it", () => {
  const repo = new DemoRepository();
  // With nothing to send, a push does not reach the remote and finds nothing.
  assert.deepEqual(repo.push(), { status: "pushed", commits: 0 });
  repo.stage([filter]);
  const first = repo.commit("Hide completed tasks");
  repo.stage([tests]);
  const second = repo.commit("Cover completed tasks");
  assert.equal(repo.status().ahead, 2);

  const refused = repo.push();
  assert.deepEqual(refused, { status: "behind", ahead: 2, behind: 1, incoming: ["4e7a1d3 Cover an empty task list"], refused: true });
  assert.deepEqual([repo.status().ahead, repo.status().behind], [2, 1]);
  assert.equal(repo.commits[0].info.upstreamState, "local-only");
  // While the branch is behind, nothing is sent again.
  assert.equal(repo.push().refused, false);

  const changesBefore = repo.status().changes.map((f) => [f.path, f.staged, f.unstaged]);
  assert.deepEqual(repo.pull(), { commits: 1, localCommits: 2, restoredLocalChanges: true });
  assert.equal(repo.pull(), null);
  assert.deepEqual([repo.status().ahead, repo.status().behind], [2, 0]);
  assert.deepEqual(repo.commits.slice(0, 4).map((c) => c.info.subject), ["Cover completed tasks", "Hide completed tasks", "Cover an empty task list", "Describe the task filter in the README"]);
  // The local commits are the same changes under new identifiers, on top of the teammate's commit.
  const [newSecond, newFirst, teammate] = repo.commits;
  assert.notEqual(newFirst.info.oid, first.oid);
  assert.notEqual(newSecond.info.oid, second.oid);
  assert.deepEqual([newFirst.info.parentOids, newSecond.info.parentOids], [[teammate.info.oid], [newFirst.info.oid]]);
  assert.deepEqual(repo.commitFiles(newFirst.info.oid).map((f) => f.path), [filter]);
  assert.deepEqual(repo.commitFiles(newSecond.info.oid).map((f) => f.path), [tests]);
  assert.deepEqual(repo.commitFiles(teammate.info.oid).map((f) => [f.kind, f.path]), [["added", "test/empty-list.test.js"]]);
  assert.equal(newSecond.info.isHead, true);
  assert.equal(repo.status().oid, newSecond.info.oid);
  // The teammate's file arrives, and the visitor's uncommitted changes are untouched.
  assert.ok(repo.files().some((f) => f.path === "test" && f.children.some((child) => child.path === "test/empty-list.test.js")));
  assert.deepEqual(repo.status().changes.map((f) => [f.path, f.staged, f.unstaged]), changesBefore);

  assert.deepEqual(repo.push(), { status: "pushed", commits: 2 });
  assert.deepEqual([repo.status().ahead, repo.commits[0].info.upstreamState], [0, "published"]);
  // It happens once: later pushes go through.
  repo.stage(["README.md"]);
  repo.commit("Tick the checklist");
  assert.deepEqual(repo.push(), { status: "pushed", commits: 1 });
});

test("a pull with no local commits moves the branch onto the teammate's commit", () => {
  const repo = new DemoRepository();
  repo.stage([filter]);
  const { oid } = repo.commit("Hide completed tasks");
  repo.push();
  assert.equal(repo.undoLatest(oid).status, "success");
  assert.deepEqual([repo.status().ahead, repo.status().behind], [0, 1]);
  assert.deepEqual(repo.pull(), { commits: 1, localCommits: 0, restoredLocalChanges: true });
  assert.deepEqual([repo.commits[0].info.subject, repo.commits[0].info.isHead, repo.status().ahead], ["Cover an empty task list", true, 0]);
  // The undone commit left its change staged, and it still is.
  assert.deepEqual(repo.status().changes.filter((f) => f.staged).map((f) => f.path), [filter]);
});

test("undoing the latest unpushed commit keeps its changes staged", () => {
  const repo = new DemoRepository();
  const published = repo.commits[0].info.oid;
  assert.deepEqual(repo.undoLatest(published), { status: "not-local" });
  repo.stage([filter, tests]);
  const { oid } = repo.commit("Hide completed tasks");
  assert.deepEqual(repo.undoLatest("stale"), { status: "stale-head" });
  const undone = repo.undoLatest(oid);
  assert.deepEqual([undone.status, undone.undoneOid, undone.stagedCount], ["success", oid, 2]);
  assert.equal(repo.commits.length, sampleHistory.length);
  assert.equal(repo.commits[0].info.isHead, true);
  const again = repo.commit("Hide completed tasks again");
  assert.notEqual(again.oid, oid);
  repo.push();
  repo.pull();
  repo.push();
  assert.deepEqual(repo.undoLatest(repo.commits[0].info.oid), { status: "not-local" });
});

test("files can be created, renamed, and deleted, and deletions are staged and committed", () => {
  const repo = new DemoRepository();
  assert.equal(repo.createFile("src", "board.ts").status, "created");
  assert.equal(repo.createFile("src", "board.ts").status, "conflict");
  assert.deepEqual(repo.rename("src/board.ts", "columns.ts"), { status: "renamed", from: "src/board.ts", to: "src/columns.ts" });
  assert.equal(repo.status().changes.find((f) => f.path === "src/columns.ts").kind, "untracked");

  assert.equal(repo.remove(["data"]), 1);
  const deleted = () => repo.status().changes.find((f) => f.path === "data/tasks.json");
  assert.deepEqual([deleted().kind, deleted().worktreeStatus], ["deleted", "D"]);
  assert.match(repo.diff("data/tasks.json", "unstaged").patch, /deleted file mode 100644/);
  repo.stage(["data/tasks.json"]);
  assert.deepEqual([deleted().indexStatus, deleted().staged], ["D", true]);
  const { oid } = repo.commit("Remove the sample task data");
  assert.deepEqual(repo.commitFiles(oid).map((f) => [f.path, f.kind]), [["data/tasks.json", "deleted"]]);

  const restored = new DemoRepository();
  restored.remove(["README.md"]);
  restored.discard(["README.md"]);
  assert.equal(restored.files().some((f) => f.path === "README.md"), true);
});

test("search replacements change one match, one file, or every listed file", () => {
  const repo = new DemoRepository();
  const options = { query: "tasks", matchCase: true, wholeWord: true, regex: false, includeIgnored: false };
  const before = repo.read(filter);
  const one = repo.replace({ options, replacement: "items", scope: { kind: "match", path: filter, revision: "", line: 2, column: 29 } });
  assert.equal(one.status, "replaced");
  assert.equal(one.replacements, 1);
  assert.notEqual(repo.read(filter), before);
  assert.deepEqual(repo.replace({ options: { ...options, query: "missing" }, replacement: "x", scope: { kind: "file", path: filter, revision: "" } }), { status: "no-match" });
});

test("preparing a commit group leaves exactly its files staged", () => {
  const repo = new DemoRepository();
  const all = repo.status().changes.map((f) => f.path);
  repo.stage(all);
  repo.prepareGroup([filter, tests], all);
  assert.deepEqual(repo.status().changes.filter((f) => f.staged).map((f) => f.path).sort(), [filter, tests].sort());
});

test("files and folders can be copied, cut and pasted, moved, and created empty", () => {
  const repo = new DemoRepository();
  repo.copy(["package.json"]);
  assert.deepEqual(repo.paste("", []), { status: "pasted", source: "files", created: ["package copy.json"] });
  assert.deepEqual(repo.paste("", ["package.json"]).created, ["package copy 2.json"]);
  const { transferId } = repo.cut(["tsconfig.json"]);
  assert.deepEqual(repo.paste("src", ["tsconfig.json"], transferId), { status: "pasted", source: "cut", created: ["src/tsconfig.json"] });
  assert.equal(Object.hasOwn(repo.working, "tsconfig.json"), false);

  assert.equal(repo.track("Create folder", () => repo.createEntry("", "docs", "directory")).status, "created");
  assert.ok(repo.files().some((entry) => entry.path === "docs" && entry.type === "directory"));
  assert.deepEqual(repo.track("Move 2 items", () => repo.move(["CHANGELOG.md", "README.md"], "docs")).moved.map((m) => m.to), ["docs/CHANGELOG.md", "docs/README.md"]);
  assert.deepEqual(repo.move(["src"], "src/types").conflicts, ["src"]);
  assert.deepEqual(repo.rename("docs", "notes"), { status: "renamed", from: "docs", to: "notes" });
  assert.deepEqual(repo.directoryEntries("notes").map((entry) => entry.path), ["notes/CHANGELOG.md", "notes/README.md"]);
  assert.equal(repo.remove(["notes"]), 2);
  assert.equal(repo.files().some((entry) => entry.path === "notes"), false);
});

test("file operations can be undone and redone", () => {
  const repo = new DemoRepository();
  assert.deepEqual(repo.fileHistoryState(), { canUndo: false, undoLabel: null, canRedo: false, redoLabel: null });
  repo.track("Delete item", () => repo.remove(["README.md"]));
  repo.track("Rename item", () => repo.rename("package.json", "manifest.json"));
  assert.equal(repo.fileHistoryState().undoLabel, "Rename item");
  const undone = repo.undoFileOperation("undo");
  assert.deepEqual([undone.status, undone.label, undone.restoredPaths, undone.removedPaths], ["applied", "Rename item", ["package.json"], ["manifest.json"]]);
  repo.undoFileOperation("undo");
  assert.ok(Object.hasOwn(repo.working, "README.md"));
  assert.equal(repo.fileHistoryState().redoLabel, "Delete item");
  repo.undoFileOperation("redo");
  assert.equal(Object.hasOwn(repo.working, "README.md"), false);
  repo.track("Create file", () => repo.createFile("", "NOTES.md"));
  assert.equal(repo.fileHistoryState().canRedo, false);
  assert.equal(repo.undoFileOperation("redo").status, "empty");
});
