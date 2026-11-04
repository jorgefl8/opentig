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
      reason: "The filter, its option type, its tests, and the board toggle.",
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

/** One message for the staged files, plus a plan when code and documentation are mixed. */
export function sampleCommitMessage(staged: string[]): GeneratedCommitMessage {
  if (!staged.length) throw new Error("Stage the changes to describe first.");
  const draft = describe(staged);
  const code = staged.filter((path) => !isDocs(path));
  const docs = staged.filter(isDocs);
  const group = (paths: string[], index: number): CommitPlanItem => {
    const part = describe(paths);
    return { ...part, message: message(part), paths, fingerprint: `sample-${index}-${paths.join(",")}` };
  };
  return {
    ...draft,
    message: message(draft),
    harness: sampleHarness.id,
    model: "sample",
    contextWasTruncated: false,
    proposal: code.length && docs.length
      ? { rationale: "The staged changes mix code with documentation that can be reviewed on its own.", commits: [group(code, 1), group(docs, 2)] }
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
