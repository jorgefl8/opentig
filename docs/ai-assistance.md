# Optional AI assistance

[← Documentation](README.md) · [AI privacy](security-and-privacy.md#ai-privacy) · [AI writing policy](ai-writing-policy.md)

AI is optional. You can review, edit, stage, and commit without an AI account. When requested, a locally installed CLI can help with three tasks:

| Task | What you review |
| --- | --- |
| **Commit message** | An editable subject and body for staged changes |
| **Split proposal** | Focused commit groups, each with a message, reason, and complete files |
| **Pull-request draft** | An editable title and description based on the branch diff |

**You create each commit and confirm each PR.** OpenTig does not run an autonomous coding agent or publish generated work automatically.

The selected CLI runs **on the backend host**, including when you use a browser. It may send the supplied context to its provider. See [AI privacy](security-and-privacy.md#ai-privacy) for execution controls, credential handling, and cleanup.

## Supported CLIs

Install and authenticate at least one supported CLI on the OpenTig host. The [optional integrations setup](getting-started.md#optional-integrations) lists the login commands.

| Provider | Requirements |
| --- | --- |
| **Codex** | Installed and authenticated CLI with accessible file-based credential storage for generation |
| **Claude Code** | Installed and authenticated CLI; administrator-managed Claude policy still applies |
| **OpenCode** | Version 2.x, using `opencode` or `opencode2`. Version 1 and legacy beta builds are incompatible |
| **Grok Build** | Official `grok` CLI, version 1.0.46 or later in the 1.x series, with headless JSON and tool-control flags. Authenticate with `grok login` or `XAI_API_KEY` in the host process |

Custom CLI configuration and custom models are excluded from the isolated generation profiles. OpenCode models retain provider/model identifiers and optional `#variant` suffixes. Grok's built-in models are discovered dynamically; choosing one in OpenTig does not change the CLI default.

## Detection and models

**Choose a provider and model**

1. Open **Settings → AI assistance**.
2. Check the provider's availability and authentication status, then select a provider and model. The cards show provider logos and **Last checked** timestamps.
3. If you installed or authenticated a CLI after the last check, choose **Check again**.

The commit composer shows the chosen provider and model. Each provider reports its own missing, unusable, incompatible, or authentication state.

**If OpenTig cannot find the CLI**

Use **Check again** to refresh detection without reinstalling an existing service. In **Advanced CLI detection**, inspect the selected executable and its source, save an absolute path for that provider, or reset to **Automatic**.

Paths refer to the backend host. Windows does not automatically use CLIs inside WSL; run the backend inside WSL to use that environment.

<details>
<summary>Saved checks, installation locations, and environment refresh</summary>

Availability/authentication checks and model catalogs are saved locally and reused after reopening Settings or restarting OpenTig. Checks run automatically if no saved result exists or an executable path changes. Switching provider or model does not repeat discovery; previous results stay visible during refresh.

Discovery checks native user locations such as `~/.opencode/bin`, `~/.grok/bin`, and `~/.local/bin`, common package-manager launchers, and refreshed user `PATH` entries. OpenCode checks both `opencode` and `opencode2`, preferring compatible v2. An older or broken installation does not hide a later compatible one. Discovery and execution use the same environment.

Environment refresh reads Bash, Zsh, or Fish startup files on Linux/macOS, and the saved user/machine environment on Windows. If it fails or times out (15 seconds on Windows, five on Linux/macOS), detection continues with the inherited environment and known locations.

</details>

<details>
<summary>When OpenCode has no model catalog</summary>

OpenCode discovery tries a private server first. If the catalog is empty or unavailable, it falls back to the normal CLI service with the same executable and environment. If neither returns models, Settings reports the missing catalog without treating it as a failed login.

</details>

Generation always validates the CLI's current availability and authentication. Large commit and PR analyses can run for up to ten minutes. You can cancel in the interface; disconnecting the requesting client or reaching the execution time limit also cancels the run.

## Commit messages and split proposals

**Generate a commit message**

1. Stage the changes you want to commit.
2. Request a message using the selected provider and model.
3. Review and edit the subject and body, then create the commit yourself.

The CLI receives a bounded staged diff, summary, paths, branch name, and up to ten recent commit subjects. **Unstaged content is excluded; untracked files are included only after staging.**

**Split independent changes into commits**

1. Request a split proposal when staged changes cover separate responsibilities.
2. Review each group's message, reason, and complete-file list. Open any listed diff to inspect it.
3. Prepare one group, review its files, and create its commit. Repeat for the remaining groups.

Preparing a group changes **only the Git index**. It does not create a commit. Groups retain their original numbering and show how many are complete.

**Partially staged files, staged renames, or an unreliable file inventory block proposals.** OpenTig explains the refusal. It validates that every staged path appears exactly once and that the staged snapshot has not changed. Every group is rechecked before preparation, so changed files cannot silently use a stale plan.

<details>
<summary>How large staged patches are included</summary>

Large patches share the available context budget fairly. Complete paths and summaries are preserved even when an individual diff is trimmed.

</details>

## Pull-request drafts

1. Choose the base for the current branch and request a draft.
2. Review the coverage report to understand which changes the provider received.
3. Edit the title and description, then review and confirm publication. See [PR creation](github.md#create-a-pull-request) for account and publication requirements.

Generation compares the current branch with the selected base. The persistent coverage report describes each file:

| Coverage | Detail supplied |
| --- | --- |
| **Complete** | Complete file detail in the comparison |
| **Partial** | Some diff detail; the report counts omitted changed lines and hunks |
| **Inventory-only** | File inventory without diff detail |

Binary entries supply metadata only. The report also counts included commit subjects against the total, with at most 30 subjects and an additional size limit. Enabled repository instructions share the prompt budget and coverage report.

**Review limited coverage carefully before publishing.** Oversized inventories fail explicitly instead of silently dropping files. The prompt has a character limit and can still exceed a particular model's token window.

Changing the repository, branch, head, or base cancels an in-flight draft and marks an existing comparison outdated. Your editable text is kept.

<details>
<summary>How the branch comparison fits the prompt</summary>

OpenTig freezes head, base, and merge-base commits and keeps the complete file inventory. It reduces surrounding diff context from three lines to one before distributing the remaining space across files and hunks.

</details>

### Writing conventions

Generated commit subjects, split subjects, and PR titles use **Conventional Commits**. All generated prose is **English**, regardless of repository history or enabled conventions. Manually written messages and titles remain unrestricted.

PR drafts describe the whole final branch diff, starting with its main behavior change and covering other material changes. The generator receives repository changes, **not your development conversation or test results**. It omits verification sections by default. If enabled conventions require one, it states that verification results were not supplied. Review and edit the draft before publishing.

<details>
<summary>Generated wording and level of detail</summary>

Bodies scale to the diff: short paragraphs for small fixes, explanatory prose and focused bullets for parallel details in larger changes. They explain supported problems, behavior, defaults, and boundaries rather than listing files or summarizing only recent commits.

Harmless trailing periods are removed from generated commit subjects instead of rejecting an otherwise valid result. The [shared writing policy](ai-writing-policy.md) also applies to development agents using the evidence available in their task.

</details>

### Repository instructions

To supply repository writing conventions, enable **Settings → AI assistance → This repository → Use repository instructions**. It is **off by default** and shared across worktrees and connected clients.

When enabled, OpenTig includes the current worktree's root `AGENTS.md`, `CLAUDE.md`, and `GROK.md`: regular UTF-8 files only, no symlinks, up to **32 KiB combined**.

Conventions can refine terminology and structure. They cannot override English, Conventional Commits, schema/output limits, accuracy, privacy, or complete staged-file coverage.

Imports, parent/global/nested instructions, referenced URLs, hooks, tools, MCP settings, and custom CLI configuration are not loaded. If instruction text or the preference changes during generation, the stale result is rejected so you can generate again.

Instruction contents are not stored in settings or diagnostic history. See [AI privacy](security-and-privacy.md#ai-privacy).

## Usage history and problems

| Where to look | What it records |
| --- | --- |
| **Settings → AI assistance → View history** | Provider, model, outcome, duration, reported tokens/cost, split refusal reason, and failure details |
| **Settings → Diagnostics → View problems** | Failed Git, file, and network operations, with the operation, error code, and redacted message |

In AI history, sort by a column header and inspect totals for runs, failures, tokens, and reported cost. On mobile, tap to open history details. You can clear either history.

AI history stores metadata, **not prompts or file contents**.
