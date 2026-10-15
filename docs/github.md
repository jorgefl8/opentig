# GitHub accounts and pull requests

[← Documentation](README.md) · [Feature guide](features.md)

Install and authenticate the GitHub CLI (`gh`) **on the machine running OpenTig** to use pull requests. The integration supports `github.com`; GitHub Enterprise hosts are not currently supported.

Three settings control different parts of your work:

| Setting | Used for |
| --- | --- |
| **Repository account** | GitHub PR lists, details, diffs, stacks, branch links, and PR creation |
| **Git credentials** | Fetch, pull, push, and remote-branch operations; may use the repository account or existing external authentication |
| **Commit authorship** | The name and email recorded in future commits; changing a GitHub account does not change these |

Start by [choosing an account](#choose-an-account), then [review](#review-pull-requests) or [create a PR](#create-a-pull-request). For an existing setup, see [Git credentials and push](#git-credentials-and-push) or [commit authorship](#commit-authorship).

## Choose an account

**When adding a repository**

1. Select its folder and choose **Continue**.
2. Review GitHub/PR access, Git access, and the effective destination.
3. Select a connected account or **Use existing credentials**. If needed, [add an account](#add-an-account) first.
4. Choose **Add repository**.

Canceling, closing the dialog, or failing setup leaves the repository list and active repository unchanged.

The suggested account is preselected when connected. Adding the repository saves that specific account, without linking it to a global default. For new compatible GitHub HTTPS destinations, **Use this account for fetch and push too** starts checked. Saved choices, existing unpinned repositories, SSH, and other providers keep their current authentication mode.

**Use existing credentials** preserves existing Git and GitHub CLI credentials. You can also choose it for local work without configuring a GitHub account.

**For an existing repository**, use **Settings → GitHub → This repository**. The selected account applies across its worktrees and connected clients. Independent clones can choose different accounts.

<details>
<summary>How repository account choices are saved and shared</summary>

Selections are saved by Git common directory and survive restarts. Relocating a registered repository carries its choice; forgetting it removes the choice. Changing an account clears that repository's GitHub results in connected clients without refreshing Git data.

Account edits use the server revision to reject changes prepared against an outdated selection. Updates are broadcast to connected clients and reloaded after reconnection. If an explicitly selected account disappears, OpenTig reports it instead of falling back to another account.

</details>

### Add an account

Open **Add account** for the [official GitHub CLI login instructions](https://cli.github.com/manual/gh_auth_login). Run the command in a terminal on the backend host:

```bash
gh auth login --hostname github.com --web --skip-ssh-key
```

Keep the existing Git protocol and decline Git credential setup. Then return to **Check accounts** in OpenTig.

**Login makes the newly added account globally active in `gh`**, while retaining saved accounts. The dialog can copy an optional command to restore the previously checked global account. OpenTig copies instructions; it does not execute login, logout, refresh, or global account switching.

Your CLI must support multi-account `auth token --user` and `auth status --json hosts`. If the JSON check is unsupported, OpenTig asks you to update `gh`.

## Review pull requests

1. Open **PRs** for the current repository.
2. Select a PR to inspect its metadata and Markdown description.
3. In **Code**, review the cumulative diff or use **By commit** to inspect changes from one commit. The selector supports keyboard navigation, readable subjects, and scrollable options.

The PR list shows the effective GitHub account. The integration currently resolves the GitHub repository through `origin`.

**Open the current branch's PR**

Beside the branch selector, the PR indicator shows the current branch or worktree's PR number and state. A purple merge icon identifies a merged PR. Click for its full title and status, then choose **Open in OpenTig** or **Open in GitHub**. The mobile repository menu offers the same choices; the toolbar also opens the repository on GitHub.

<details>
<summary>How OpenTig matches and refreshes the current PR</summary>

Matching checks both the head repository and branch name, so another fork's `main` is not mistaken for your clone. When several PRs match, the most recently updated open PR takes priority. Otherwise, the most recently updated PR is shown if merged.

The current branch indicator checks open PRs once a minute while the window is visible. Closed, merged, or absent results are checked every five minutes to discover reopened PRs or reused branches. Returning to the window, reconnecting, changing the repository account, or manually refreshing checks immediately. Failed checks retry every minute; hidden windows do not poll.

CLI availability is checked at startup and reused across repositories and list filters. Returning to PRs keeps cached results visible during background refreshes. **Refresh** checks CLI availability again.

</details>

<details>
<summary>Links in PR titles, descriptions, and previews</summary>

Web links open in a new browser tab, or the system browser on desktop. Hover or focus a link to see its destination and **Open in new tab**. Email links show **Open in mail app** and use the mail client. This also applies to the creation dialog's Markdown preview.

</details>

### Native stacks

Click a layer indicator such as **2/3** to open a native GitHub stack. Indicators appear beside the current branch PR, in PR rows, in the right-hand viewer, and in the mobile repository menu.

The menu lists layer states, titles, branches, and bases, including layers outside the current filter. Details load when opened. If a refresh fails, previously loaded layers remain available with a notice and retry.

**Stack navigation is read-only.** Indicators appear only when GitHub reports native stack membership, independently of worktrees or other local branches. OpenTig does not infer stacks from branch relationships, merge layers, or rebase branches.

## Create a pull request

**Publish the current branch and bring it up to date first.**

1. Open the PR creation dialog and review the effective GitHub account.
2. Choose the base branch and whether to create a draft PR using the adjacent toggle.
3. Write a title and description, then check the Markdown preview. You can also generate an editable draft from the branch diff.
4. Review and confirm to publish.

No PR is published before confirmation. Creation stops if the selected account or verified identity has changed since your review.

Optional AI generation, with its provider and model, is in the dialog footer. Long coverage reports scroll inside the dialog. See [AI assistance](ai-assistance.md#pull-request-drafts) for coverage reports, output conventions, and stale comparisons.

## Settings scopes

Open **Settings → GitHub** to manage repository choices and connected accounts:

| Tab | Scope |
| --- | --- |
| **This repository** | Account selection, Git HTTPS credentials, access checks, push destination, and commit authorship; shared across worktrees and connected clients |
| **Accounts** | Connected accounts, repository usage counts, the suggested account for new repositories, and CLI availability |

**Suggested account for new repositories** is saved on the server and shared by clients. Changing it does not modify existing repository accounts, Git credentials, commit authors, or the active `gh` account. Usage counts include registered repositories; worktrees count as one repository.

**Check access after external account changes**

Opening Settings shows saved metadata. After logging in, logging out, or changing accounts outside OpenTig, choose **Check access** to refresh the inventory and verify repository access.

Missing, stale, and failed checks are distinct from verified access. Failed checks keep the previous inventory as unverified and show next steps. **GitHub checks do not verify external Git credentials.** Refreshing the account inventory alone does not check repository access.

<details>
<summary>Where to find destinations, authorship, and diagnostics</summary>

The repository account is the primary control, with a short explanation of its use. Separate GitHub/PR and fetch/push summaries appear only when Git uses external authentication. The push destination shows the repository and branch before the remote alias and protocol. The GitHub/PR repository appears separately when it differs from the push destination.

The commit author's name, email, and **Edit authorship** action are visible in repository settings. **Advanced → Git** contains the compact destination summary, Git authentication selector, and **Copy diagnostics** in one collapsed section. **Accounts** shows CLI version and availability in a compact row without a disclosure. Access has a brief verification state and **Check access**.

**Copy diagnostics** copies check results, URLs, timestamps, and the last Git operation for troubleshooting, without displaying a diagnostic report in Settings.

</details>

<details>
<summary>Saved metadata, check caching, and older global defaults</summary>

Settings initially shows the last checked CLI version, accounts for `github.com`, authentication/storage states, and repository identity. Operations still validate credentials as needed. Successful identity and SSH checks are reused for up to one minute; manual refresh bypasses those caches.

Repositories already linked to **Global default** keep that behavior. Only these show **Following default** in **This repository**; choosing a specific account removes the link. **Accounts** has no shared-default editor or repository assignment table. The saved shared default remains independent of the active `gh` account.

</details>

## Git credentials and push

**Choose how Git authenticates**

In **Settings → GitHub → This repository → Advanced → Git**, choose:

| Mode | Behavior |
| --- | --- |
| **Repository account · @username** | Uses that account's saved GitHub CLI credentials for compatible GitHub HTTPS fetch, pull, push, and remote-branch operations |
| **Existing Git credentials** | Uses Git's existing helpers and authentication on the desktop computer or backend server; the identity remains unverified |

An explicit repository selection can differ from the globally active `gh` account. Switching the active CLI account does not change that selection. SSH and other providers stay external; remote URLs are not converted.

Choosing an account for the first time in Settings also selects it for Git when the push destination supports managed GitHub HTTPS. Existing authentication choices are preserved. Choose **Existing Git credentials** to return to external authentication. No global helpers, SSH keys, remotes, or active `gh` account are changed.

**Push or publish a branch**

Push uses the repository's account and destination configured on the server. Check the account, destination, target branch, and Git authentication in **This repository**. There is no permanent indicator in the toolbar or mobile repository menu; external credentials are marked unverified rather than attributed to the selected PR account.

An ordinary push runs directly. You do not need to visit Settings, grant browser-storage approval, or confirm separately on each client. Fresh clients and clients that have already pushed use the same server configuration.

For a new branch with a resolved destination, use **Publish branch** to push and set an upstream. If Git cannot choose between remotes, **Where do you want to push?** lists full repository destinations, aliases, and branches. Publishing saves the tracking branch in Git on the server.

Every push reads and validates fresh server configuration. If that prepared context changes during execution, the operation stops. Multiple push URLs and unsupported configurations remain blocked with an explanation. **No operation silently switches accounts, rewrites remotes, or forces a push.**

**Understand access checks and rejections**

Checks distinguish identity, PR API access, Git read access to the push destination, and API-declared write permission. Write permission names the checked GitHub account; it does not verify external Git credentials or guarantee branch-policy approval.

Sanitized Git errors retain the actual rejection and never trigger an automatic force push. GitHub errors distinguish missing accounts, rejected credentials, repository/token/organization permissions, and unavailable CLI installations.

### Managed credential boundaries

Managed Git HTTPS requires `curl`, which is included with Git for Windows. These operations do not recurse into submodules: open each submodule as its own repository or use external authentication.

Account routing does not protect against hostile processes running as the same OS user. See [security and privacy](security-and-privacy.md) for the broader boundaries.

<details>
<summary>How managed operations handle tokens</summary>

Each operation uses a temporary helper and private loopback broker restricted to the GitHub host and repository path, with redirects disabled. Tokens do not enter Git arguments, configuration, files, or hook environments. Temporary resources are removed on completion, failure, and cancellation.

</details>

## Commit authorship

1. Open **Settings → GitHub → This repository → Edit authorship**.
2. Review the current Git identity, then enter a name and commit email.
3. Compare the before/after values and save.

The editor saves repository-local `user.name` and `user.email` atomically. Future commits from OpenTig and other Git tools use those settings, shared across worktrees. **GitHub account changes never change authorship automatically.**

Existing history, global settings, remotes, credentials, SSH, and signing settings are preserved. Stale reviews and existing Git config locks prevent saving.

Environment overrides, custom `author.*`/`committer.*`, worktree-specific identities, command configuration, and linked config files are shown but must be managed outside this editor. Reusable authorship profiles and automatic account linking are not supported by the editor.

## Existing automatic selections

Older unpinned configurations keep working until you choose an account. These rules apply to automatic selection:

<details>
<summary>Automatic SSH identity and HTTPS environment credentials</summary>

**Automatic SSH** performs a noninteractive handshake with an already trusted `github.com` host to identify the actual user, then obtains that user's saved `gh` token. Repository owners, organization names, and SSH aliases do not establish identity.

Missing accounts, deploy keys, failed handshakes, and custom SSH commands require an explicit selection or corrected authentication. OpenTig does not fall back to another user.

**HTTPS Automatic** uses active `gh` credentials and honors backend `GH_TOKEN`/`GITHUB_TOKEN`. Explicit and verified SSH selections use their own stored credentials instead of these environment overrides. Checks do not create keys or change known hosts.

</details>
