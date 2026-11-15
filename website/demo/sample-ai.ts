import type { AiHarnessStatus, CommitPlanItem, GeneratedCommitMessage, GeneratedPullRequestDraft } from "../../src/shared/contracts";
import { sampleDate } from "./model.ts";

// The demo contacts no AI provider. These fixed sample responses show how OpenTig presents
// generated commit messages, commit plans, and pull request drafts, and say so in the model name.
export const sampleHarness: AiHarnessStatus = {
  id: "codex",
  label: "Codex",
  availability: "ready",
  installed: true,
  authStatus: "authenticated",
  models: [{ id: "sample", label: "Sample responses", description: "Fixed demo responses. No AI provider is contacted." }],
  checkedAt: sampleDate,
};

const isDocs = (path: string) => path.endsWith(".md");

type Draft = { subject: string; body: string; reason: string };

/** A message that fits the files, written for the sample's task filter work. */
function describe(paths: string[]): Draft {
  if (paths.every(isDocs)) {
    return {
      subject: paths.includes("CHANGELOG.md") ? "docs: record the task filter in the changelog" : "docs: update the release notes",
      body: "Document the change for readers of the repository.",
      reason: "Documentation only, reviewable on its own.",
    };
  }
  if (paths.some((path) => path.includes("filter-tasks") || path === "src/types.ts")) {
    return {
      subject: "feat(filters): hide completed tasks by default",
      body: "Search skips completed work unless includeCompleted is set.",
      reason: paths.includes("index.html") ? "The filter, its option type, its tests, and the board toggle." : "The filter, its option type, and its tests.",
    };
  }
  if (paths.includes("index.html")) {
    return {
      subject: "feat(board): update the release manifest",
      body: "Adjust the board that index.html renders.",
      reason: "Changes to the release manifest page.",
    };
  }
  return {
    subject: `chore: update ${paths.length === 1 ? paths[0] : `${paths.length} files`}`,
    body: "",
    reason: "Related edits that belong in one commit.",
  };
}

const message = ({ subject, body }: Draft) => (body ? `${subject}\n\n${body}` : subject);

/** The parts a mixed set of staged files falls into, in the order they are committed. */
const parts: { name: string; has(path: string): boolean }[] = [
  { name: "code", has: (path) => !isDocs(path) && path !== "index.html" },
  { name: "the board page", has: (path) => path === "index.html" },
  { name: "documentation", has: isDocs },
];
const list = (names: string[]) => (names.length < 3 ? names.join(" with ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`);

/** One message for the staged files, plus a plan when code, the board page, and documentation are mixed. */
export function sampleCommitMessage(staged: string[]): GeneratedCommitMessage {
  if (!staged.length) throw new Error("Stage the changes to describe first.");
  const draft = describe(staged);
  const groups = parts.map((part) => ({ name: part.name, paths: staged.filter(part.has) })).filter((part) => part.paths.length);
  const group = (paths: string[], index: number): CommitPlanItem => {
    const part = describe(paths);
    return { ...part, message: message(part), paths, fingerprint: `sample-${index + 1}-${paths.join(",")}` };
  };
  return {
    ...draft,
    message: message(draft),
    harness: sampleHarness.id,
    model: "sample",
    contextWasTruncated: false,
    proposal: groups.length > 1
      ? { rationale: `The staged changes mix ${list(groups.map((part) => part.name))}. Each part can be reviewed on its own.`, commits: groups.map((part, index) => group(part.paths, index)) }
      : null,
    splitBlockedReason: null,
  };
}

/** A title and description for the current branch's pull request. */
export function samplePullRequestDraft(): GeneratedPullRequestDraft {
  return {
    title: "Hide completed tasks from search results",
    body: [
      "## What changes",
      "",
      "Search hides completed tasks by default. Pass `includeCompleted: true` to include them, and the board gains a **Hide completed** filter.",
      "",
      "## Verification",
      "",
      "- `npm test` covers case-insensitive search and completed task visibility.",
    ].join("\n"),
    harness: sampleHarness.id,
    model: "sample",
    contextWasTruncated: false,
  };
}
