# GitHub accounts and pull requests

[← Documentation](README.md) · [Feature guide](features.md)

GitHub features require an installed, authenticated GitHub CLI (`gh`) on the machine running OpenTig. This integration supports `github.com`; GitHub Enterprise hosts are outside its current scope. Git commit authorship, Git credentials, and GitHub API identity are separate settings.

## Review pull requests

Open **PRs** to list pull requests for the current repository, inspect metadata and the Markdown description, and review the full diff. In **Code**, choose cumulative changes or the changes introduced by an individual commit. The **By commit** selector is a keyboard-accessible menu with readable subjects and scrollable options.

Web links in PR titles and descriptions, including the creation dialog's Markdown preview, open in a new browser tab (the system browser on desktop). Hover or focus a link to see its destination and **Open in new tab**. Email links show **Open in mail app** and use the mail client.

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

After selecting a repository folder, choose **Continue** to review GitHub/PR and Git access plus the effective destination. Select a connected account or **Use existing credentials**, then choose **Add repository**. Canceling, closing the dialog, or failing setup leaves the repository list and active repository unchanged.

The suggested account, when connected, is preselected for new repositories. Adding the repository saves that specific account; it does not create a link to a global default.

For new compatible GitHub HTTPS destinations, **Use this account for fetch and push too** starts checked. Saved choices, existing unpinned repositories, SSH, and other providers retain their current authentication mode. **Use existing credentials** explicitly preserves existing Git and GitHub CLI credentials, including for local work without configuring a GitHub account.

An account selection applies to PR lists, branch links, details, diffs, stacks, and creation. It is saved by Git common directory and shared across worktrees and connected clients, including after restart. Relocating a registered repository carries the choice; forgetting it removes it. Independent clones can choose different accounts. A selection change clears the affected GitHub results in connected clients without refreshing Git data.

### Settings scopes

**Settings → GitHub** has two tabs:

| Tab | Scope |
| --- | --- |
| **This repository** | Account selection, Git HTTPS credentials, access checks, push destination, and commit authorship; shared across worktrees and connected clients. |
| **Accounts** | Connected accounts, their repository usage counts, the suggested account for new repositories, and CLI availability. |

**Suggested account for new repositories** is saved on the server and shared by clients. Changing it does not modify any existing repository account, Git credentials, commit author, or active `gh` account. The account list shows how many registered repositories use each account; worktrees count as one repository.

Existing repositories linked to **Global default** retain their saved behavior. Only those repositories show **Following default** in **This repository**, where choosing a specific account removes the default link. **Accounts** does not expose a shared-default editor or a repository assignment table. The saved shared default remains independent of the active `gh` account. If an explicitly selected account disappears, OpenTig reports that instead of falling back to another account.

Opening Settings shows saved metadata: the last checked CLI version, accounts for `github.com`, authentication/storage states and repository identity. **Check access** refreshes inventory and verifies repository access after external login, logout, or account changes. Failed checks retain the previous inventory as unverified. Refreshing the account inventory alone does not run repository access checks. Operations still validate credentials as needed; successful identity and SSH checks are reused for up to one minute, while manual refresh bypasses those caches.

The repository account is the primary control. A short description states how the selected account is used. Separate GitHub/PR and fetch/push summaries appear only when Git uses external authentication. The push destination shows the repository and branch before the remote alias and protocol. The GitHub/PR repository is shown separately when it differs from the push destination. The PR integration currently resolves its repository through `origin`.

The commit author’s name, email, and **Edit authorship** action are visible in the repository settings. **Advanced → Git** groups the compact destination summary, Git authentication selector, and **Copy diagnostics** action in one collapsed section; **Accounts** shows the CLI version and availability in a compact row without a disclosure. Access shows a brief verification state and **Check access**. Missing, stale, and failed checks stay distinct from verified access; external credentials are never declared verified by GitHub checks. Failures remain visible with their next steps. **Copy diagnostics** copies check results, URLs, timestamps, and the last Git operation for troubleshooting without displaying a diagnostic report in Settings. Account changes use the server revision to reject edits prepared against an outdated selection. Changes are broadcast to connected clients and reloaded after reconnection.

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

## Git credentials and push

Under **Advanced → Git**, **Repository account · @username** uses that account’s saved GitHub CLI credentials for compatible GitHub HTTPS fetch, pull, push, and remote-branch operations. It is the account selected for this repository, which can differ from the globally active `gh` account. Switching the active CLI account does not change an explicit repository selection. **Existing Git credentials** uses Git's existing helpers and authentication on the computer (desktop) or server (web); that identity remains unverified rather than inferred from saved GitHub accounts. SSH and other providers remain external, and remote URLs are not converted.

Choosing an account for the first time in Settings also selects it for Git when the push destination supports managed GitHub HTTPS. Existing authentication choices are preserved; you can choose **Existing Git credentials** to use external authentication again. No global helpers, SSH keys, remotes, or active `gh` account are changed.

Push uses the account and destination configured on the server for the repository. Account, destination, target branch, and Git authentication can be consulted in **Settings → GitHub → This repository**, without a permanent indicator in the toolbar or mobile repository menu. External credentials are marked unverified rather than attributed to the selected PR account.

An ordinary push executes directly. There is no client-local confirmation, browser-storage approval, or prerequisite to visit Settings. A fresh client and a client that has already pushed use the same server configuration. New branches with a resolved destination use **Publish branch** directly and set an upstream. When Git cannot choose between configured remotes, **Where do you want to push?** lists their full repository destinations, aliases, and branches; publishing saves the tracking branch in Git on the server.

Every push reads and validates fresh server configuration when invoked. A change to the prepared server context during execution stops the operation. Multiple push URLs and unsupported push configurations remain blocked with their specific explanation. No operation silently switches accounts, rewrites remotes, or forces a push.

Access checks distinguish identity, PR API access, Git read access to the push destination, and API-declared write permission. The write permission names the GitHub account checked; it does not verify external Git credentials or guarantee branch-policy approval. Sanitized Git errors retain the actual rejection and never trigger an automatic force push. GitHub errors distinguish missing accounts, rejected credentials, repository/token/organization permissions, and unavailable CLI installations.

### Managed credential boundaries

Managed Git HTTPS operations use a temporary operation-local helper and private loopback broker restricted to the GitHub host and repository path, with redirects disabled. The helper requires `curl`, included with Git for Windows. Tokens do not enter Git arguments, configuration, files, or hook environments; temporary resources are removed on completion, failure, and cancellation.

Managed operations do not recurse into submodules: open each submodule as its own repository or use external authentication. Account routing does not protect against hostile processes running as the same OS user. See [security and privacy](security-and-privacy.md) for the broader boundaries.

## Commit authorship

**Edit authorship** reads the current Git identity and accepts a name and commit email. Review the before/after values before saving repository-local `user.name` and `user.email` atomically. Future commits from OpenTig and other Git tools use these settings, shared across worktrees. GitHub account changes never change authorship automatically.

Existing history, global settings, remotes, credentials, SSH, and signing settings are preserved. Environment overrides, custom `author.*`/`committer.*`, worktree-specific identities, command configuration, and linked config files are shown and must be managed outside this editor. Stale reviews and existing Git config locks prevent saving. Reusable authorship profiles and automatic account linking are outside the current editor's scope.
