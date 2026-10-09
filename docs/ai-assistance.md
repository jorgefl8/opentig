# Optional AI assistance

[← Documentation](README.md) · [AI privacy](security-and-privacy.md#ai-privacy) · [AI writing policy](ai-writing-policy.md)

AI is optional. Reviewing, editing, staging, and committing work without an AI account. When requested, a locally installed CLI can draft a commit message, propose focused commit groups, or draft a pull request. OpenTig does not run an autonomous coding agent or create commits and PRs automatically: generated text stays editable until you review and confirm the corresponding action.

The selected CLI runs on the backend host, including when you use OpenTig in a browser, and may send the supplied context to its provider.

## Supported CLIs

| Provider | Requirements and model selection |
| --- | --- |
| **Codex** | Installed and authenticated CLI; generation requires accessible file-based credential storage. |
| **Claude Code** | Installed and authenticated CLI; administrator-managed Claude policy still applies. |
| **OpenCode** | Version 2.x, using `opencode` or `opencode2`. Version 1 and legacy beta builds are incompatible. Models retain provider/model identifiers and optional `#variant` suffixes. |
| **Grok Build** | Official `grok` CLI, version 1.0.46 or later in the 1.x series, with headless JSON and tool-control flags. Authenticate with `grok login` or `XAI_API_KEY` in the host process. |

See [installation requirements](getting-started.md#requirements) for authentication commands. Grok's built-in models are discovered dynamically; OpenTig's selection does not change the CLI default. Custom CLI configuration and custom models are excluded from the isolated generation profiles. [AI privacy](security-and-privacy.md#ai-privacy) describes each provider's execution controls, credential handling, and cleanup.

## Detection and models

**Settings → AI assistance** shows compact provider cards with their logos, per-provider model selection, and saved availability/authentication results with **Last checked** timestamps. Checks and model catalogs are persisted locally and reused after reopening Settings or restarting OpenTig. They run automatically when no saved result exists or an executable path changes. Switching provider or model does not repeat discovery; previous results remain visible while a refresh runs. Each provider independently reports missing, unusable, incompatible, or authentication states.

**Check again** discovers CLIs installed after startup, including native user locations such as `~/.opencode/bin`, `~/.grok/bin`, and `~/.local/bin`, common package-manager launchers, and refreshed user `PATH` entries. OpenCode discovery checks both `opencode` and `opencode2`, preferring a compatible v2 installation. Discovery and execution share the same environment, and an older or broken installation does not hide a later compatible one. Existing services need no reinstall for this check.

**Advanced CLI detection** shows the selected executable and its source. Save an absolute path per provider or reset to **Automatic**. Paths belong to the backend host. Windows does not automatically use CLIs inside WSL; run the backend inside WSL to use that environment.

User-environment refresh is automatic: Bash, Zsh, or Fish startup files on Linux/macOS, and the saved user/machine environment on Windows. If it fails or exceeds its timeout (15 seconds on Windows, five on Linux/macOS), detection continues with the inherited environment and known installation locations.

OpenCode model discovery tries a private server first and falls back to the normal CLI service with the same executable and environment if the catalog is empty or unavailable. If neither returns models, Settings explains the missing catalog without treating it as a failed login.

Generation always validates the selected CLI's current availability and authentication. Large commit and PR analyses can run for up to ten minutes. Cancel a generation from the interface; disconnecting its client or reaching the bounded execution window also cancels it.

## Commit messages and split proposals

Commit generation receives a bounded staged diff, summary, paths, branch name, and up to ten recent commit subjects. Unstaged content is excluded, and untracked files are included only after staging. Review and edit the generated subject/body before committing.

When staged changes cover independent responsibilities, the CLI can suggest multiple focused commits with messages, reasons, and complete-file groups. OpenTig validates that every staged path appears exactly once and the staged snapshot has not changed. Partially staged files, staged renames, or an unreliable file inventory block proposals, with an explanation. Large patches share the available budget fairly, preserving complete paths and summaries even when an individual diff is trimmed.

Preparing a group changes only the Git index. Review its files and create each commit yourself. Groups keep their original numbering and completion count; you can open each listed diff, and every group is rechecked before preparation so changed files cannot silently use a stale plan.

## Pull-request drafts

PR generation compares the current branch with the selected base. It freezes head, base, and merge-base commits, keeps the complete file inventory, and reduces surrounding diff context from three lines to one before distributing the remaining space across files and hunks. The whole prompt has a character limit; it may still exceed a particular model's token window.

The persistent coverage report distinguishes complete, partial, and inventory-only file detail, counts omitted changed lines/hunks, and reports included commit subjects against the total (at most 30 and also bounded by size). Binary entries describe metadata only. Oversized inventories fail explicitly rather than silently omitting files. Enabled repository instructions share this prompt budget and coverage report.

Changing repository, branch, head, or base cancels an in-flight draft and marks an existing comparison outdated without erasing editable text. Review limited coverage carefully before publishing. See [PR creation](github.md#create-a-pull-request) for publication and account requirements.

### Writing conventions

Generated commit subjects, split subjects, and PR titles use **Conventional Commits**; all generated prose is **English**, regardless of repository history or enabled conventions. Manually written messages and titles remain unrestricted. Harmless trailing periods are removed from generated commit subjects instead of rejecting an otherwise valid result.

PR drafts synthesize the whole final branch diff, lead with its main behavior change, and cover other material changes. Bodies scale to the diff: short paragraphs for small fixes, explanatory prose and focused bullets for parallel details in larger changes. They explain supported problems, behavior, defaults, and boundaries rather than list files or summarize only recent commits. The [shared writing policy](ai-writing-policy.md) also applies to development agents with the evidence available in their task.

The generator receives repository changes, not a development conversation or test execution results, so it omits verification sections by default. If enabled conventions require one, the draft says that verification results were not supplied. Review and edit every draft before publishing.

### Repository instructions

**Settings → AI assistance → This repository → Use repository instructions** is off by default and shared by worktrees and connected clients. Enabling it includes root `AGENTS.md`, `CLAUDE.md`, and `GROK.md` as writing conventions, up to 32 KiB combined, using only regular UTF-8 files without symlinks.

These conventions may refine terminology and structure; English, Conventional Commits, schema/output limits, accuracy, privacy, and complete staged-file coverage remain mandatory. Imports, parent/global/nested instructions, referenced URLs, hooks, tools, MCP settings, and custom CLI configuration are not loaded. The current worktree's files are used. If the instructions or preference change during generation, the stale result is rejected so you can generate again. Contents are not stored in settings or diagnostic history; see [AI privacy](security-and-privacy.md#ai-privacy).

## Usage history and problems

**Settings → AI assistance → View history** lists each run's provider, model, outcome, duration, reported tokens/cost, split refusal reason, and failure details. Sort by a column header, inspect totals for runs/failures/tokens/reported cost, and clear history when wanted. This history stores metadata rather than prompts or file contents.

**Settings → Diagnostics → View problems** records failed Git, file, and network operations with the operation, error code, and redacted message. It can also be cleared. The commit composer shows the chosen provider and model; mobile history details open with a tap.
