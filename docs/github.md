# GitHub accounts and pull requests

[← Documentation](README.md) · [Feature guide](features.md)

GitHub features require an installed, authenticated GitHub CLI (`gh`) on the machine running OpenTig. This integration supports `github.com`; GitHub Enterprise hosts are outside its current scope. Git commit authorship, Git credentials, and GitHub API identity are separate settings.

## Review pull requests

Open **PRs** to list pull requests for the current repository, inspect metadata and the Markdown description, and review the full diff. In **Code**, choose cumulative changes or the changes introduced by an individual commit. The **By commit** selector is a keyboard-accessible menu with readable subjects and scrollable options.

The toolbar opens the repository on GitHub. Beside the branch selector, the current branch or worktree's PR indicator shows its number and state, including a purple merge icon for merged PRs. Click it for the full title and status, then choose **Open in OpenTig** or **Open in GitHub**. The mobile repository menu offers the same choices.

Branch matching checks both the head repository and branch name, so a PR from another fork's `main` is not shown for your clone. When several PRs match, the most recently updated open PR takes priority; otherwise the most recently updated PR is shown if merged.

CLI availability is checked at startup and reused across repositories and list filters. Returning to PRs keeps cached results visible during background refreshes. **Refresh** checks CLI availability again.

### Native stacks

A layer indicator such as **2/3** in each PR row and the right-hand viewer opens the native GitHub stack. Its menu lists layer states, titles, branches, and bases, including layers outside the current filter. Details load when opened. A failed refresh keeps previously loaded layers available with a notice and retry.

Stack navigation is read-only: OpenTig does not infer stacks from branch relationships, merge layers, or rebase branches.

## Create a pull request

Publish the current branch and bring it up to date before creating a PR. The creation dialog keeps the draft toggle beside the base branch, provides editing and Markdown preview, and places optional AI generation with its provider and model in the footer. Long coverage reports scroll inside the dialog.

You can write the title and description yourself or generate an editable draft from the branch diff. [AI assistance](ai-assistance.md#pull-request-drafts) explains coverage reports, output conventions, and stale comparisons. The PR list and creation dialog show the effective GitHub account. No PR is published until you confirm it. Creation stops if the selected account or verified identity has changed since review.

## Choose an account

After selecting a repository folder, choose **Continue** to review GitHub/PR and Git access plus the effective destination. Select a saved account, **Global default**, or **Use existing credentials**, then choose **Add repository**. Canceling, closing the dialog, or failing setup leaves the repository list and active repository unchanged.

For new compatible GitHub HTTPS destinations, **Use this account for fetch and push too** starts checked. Saved choices, existing unpinned repositories, SSH, and other providers retain their current authentication mode. **Use existing credentials** explicitly preserves existing Git and GitHub CLI credentials, including for local work without configuring a GitHub account.

An account selection applies to PR lists, branch links, details, diffs, stacks, and creation. It is saved by Git common directory and shared across worktrees and connected clients, including after restart. Relocating a registered repository carries the choice; forgetting it removes it. Independent clones can choose different accounts. A selection change clears the affected GitHub results in connected clients without refreshing Git data.

### Settings scopes

**Settings → GitHub** has two tabs:

| Tab | Scope |
| --- | --- |
| **This repository** | Account selection, Git HTTPS credentials, access checks, push destination, and commit authorship; shared across worktrees and connected clients. |
| **OpenTig** | Instance-wide default account, adding accounts, saved-account inventory, and CLI details. |

**Default account for OpenTig** is independent of the globally active `gh` account. Repositories set to **Global default** follow it; pinned repositories keep their own account. Changing the default invalidates checks and prepared operations for followers. If the selected account disappears, OpenTig reports that instead of falling back to another account.

Opening Settings shows saved metadata: the last checked CLI version, accounts for `github.com`, authentication/storage states, the active global account, and repository identity. **Check access** refreshes inventory and verifies repository access after external login, logout, or account changes. Failed checks retain the previous inventory as unverified. Refreshing the account inventory alone does not run repository access checks. Operations still validate credentials as needed; successful identity and SSH checks are reused for up to one minute, while manual refresh bypasses those caches.

The compact grouped rows match General settings. Separate summaries identify the account for GitHub/PRs and fetch/push. Technical details stay collapsed and can be copied; failed Git operations remain visible without expanding them. GitHub CLI details expand on demand.

### Add an account

**Add account** gives the [official GitHub CLI login instructions](https://cli.github.com/manual/gh_auth_login) to run in a terminal on the backend host:

```bash
gh auth login --hostname github.com --web --skip-ssh-key
```

Keep the existing Git protocol and decline Git credential setup. Login retains saved accounts but makes the newly added account globally active in `gh`; the dialog can copy a voluntary command to restore the previously checked global account. Return to **Check accounts** after login. OpenTig copies instructions and does not execute login, logout, refresh, or global account switching.

The CLI must support multi-account `auth token --user` and `auth status --json hosts`. An unsupported JSON check asks you to update `gh`.

### Existing automatic selections

Legacy unpinned configurations keep working until you choose an account. Automatic SSH performs a noninteractive handshake with an already trusted `github.com` host to identify the actual user, then obtains that user's saved `gh` token. Repository owners, organization names, and SSH aliases do not establish identity. Missing accounts, deploy keys, failed handshakes, and custom SSH commands require an explicit selection or corrected authentication; there is no fallback to another user.

HTTPS Automatic uses active `gh` credentials and honors backend `GH_TOKEN`/`GITHUB_TOKEN`. Explicit and verified SSH selections use their own stored credentials instead of these environment overrides. Checks do not create keys or change known hosts.

## Git credentials and publication review

Under **Git HTTPS**, **Use @account** uses the selected account for compatible GitHub HTTPS fetch, pull, push, and remote-branch operations. **Git credentials** uses Git's existing helpers and authentication on the computer (desktop) or server (web); that identity remains unverified rather than inferred from saved GitHub accounts. SSH and other providers remain external, and remote URLs are not converted.

Choosing an account for the first time in Settings also selects it for Git when the push destination supports managed GitHub HTTPS. Existing authentication choices are preserved; you can choose **Git credentials** to use external authentication again. No global helpers, SSH keys, remotes, or active `gh` account are changed.

Publication resolves push remotes and rewritten push URLs separately from the PR destination. Multiple URLs or unsupported push configurations require review. New branches show **Publish branch** and set an upstream; tracked branches show **Confirm push** when review is needed.

Reviews are remembered on each client across reloads and restarts. Changing the effective Git account, authentication mode, remote, URL, or target branch requires another review. Restricted browser storage falls back to session-only memory. Every push validates fresh server context; changed account, branch, tip, or destination invalidates prepared publication before execution.

Access checks distinguish identity, PR API access, Git read access to the push destination, and API-declared write permission. The write permission names the GitHub account checked; it does not verify external Git credentials or guarantee branch-policy approval. Sanitized Git errors retain the actual rejection and never trigger an automatic force push. GitHub errors distinguish missing accounts, rejected credentials, repository/token/organization permissions, and unavailable CLI installations.

### Managed credential boundaries

Managed Git HTTPS operations use a temporary operation-local helper and private loopback broker restricted to the GitHub host and repository path, with redirects disabled. The helper requires `curl`, included with Git for Windows. Tokens do not enter Git arguments, configuration, files, or hook environments; temporary resources are removed on completion, failure, and cancellation.

Managed operations do not recurse into submodules: open each submodule as its own repository or use external authentication. Account routing does not protect against hostile processes running as the same OS user. See [security and privacy](security-and-privacy.md) for the broader boundaries.

## Commit authorship

**Edit authorship** reads the current Git identity and accepts a name and commit email. Review the before/after values before saving repository-local `user.name` and `user.email` atomically. Future commits from OpenTig and other Git tools use these settings, shared across worktrees. GitHub account changes never change authorship automatically.

Existing history, global settings, remotes, credentials, SSH, and signing settings are preserved. Environment overrides, custom `author.*`/`committer.*`, worktree-specific identities, command configuration, and linked config files are shown and must be managed outside this editor. Stale reviews and existing Git config locks prevent saving. Reusable authorship profiles and automatic account linking are outside the current editor's scope.
