# GitHub accounts and pull requests

[← Documentation](README.md) · [Feature guide](features.md)

Install and authenticate the GitHub CLI (`gh`) **on the machine running OpenTig** to use pull requests. The integration supports `github.com`; GitHub Enterprise hosts are not currently supported.

Three settings control different parts of your work:

| Setting | Used for |
| --- | --- |
| **Repository account** | GitHub PR lists, details, diffs, stacks, branch links, and PR creation, plus fetch, pull, push, and remote-branch operations over GitHub HTTPS |
| **Default account** | The repository account of every repository that doesn't have its own |
| **Commit authorship** | The name and email recorded in future commits; changing a GitHub account does not change these |

Start by [choosing an account](#choose-an-account), then [review](#review-pull-requests) or [create a PR](#create-a-pull-request). For an existing setup, see [Git credentials and push](#git-credentials-and-push) or [commit authorship](#commit-authorship).

## Choose an account

**Each repository uses its own account if it has one, otherwise the default account.** Only when no default account exists does Git keep its own credentials. The default is saved on the server: the first time OpenTig finds a connected account, it becomes the default, preferring the one active in GitHub CLI at that moment. Later changes to the active `gh` account never change which account a repository uses.

**When the default account has no access**, OpenTig finds the account that does. A repository following the default that gets "not found" or "access denied" from GitHub checks your other connected accounts with each account's own credentials. If one can access it, preferring one that can push, OpenTig saves it as the repository's account and shows **Using @username for repository** with a **Change** action. Reads such as fetch and pull repeat once with that account; a rejected push isn't retried, so push again to publish with it.

This happens only for repositories following the default and for access failures of GitHub HTTPS remotes or the GitHub API. Repositories with their own account, or set to Git’s own credentials, never switch automatically. If no connected account can access the repository, nothing changes. Settings shows the chosen account as **chosen automatically**; choosing **Default** again returns the repository to the default account.

**When adding a repository**, select its folder and choose **Add repository**. It follows the default account, and switches automatically as above if the default can't access it. Change its account later in **Settings → GitHub → This repository**.

**For an existing repository**, use **Settings → GitHub → This repository**:

| Choice | Behavior |
| --- | --- |
| **Default · @username** | Follows the default account, including when you change the default later |
| **@username** | Keeps this account for the repository, whatever the default is |
| **Git’s own credentials** (Advanced) | Git uses the credential helper or SSH key on the desktop computer or backend server; pull requests use the account active in GitHub CLI |

The choice applies across the repository's worktrees and connected clients. Independent clones can choose different accounts.

<details>
<summary>How repository account choices are saved and shared</summary>

Selections are saved by Git common directory and survive restarts. Relocating a registered repository carries its choice; forgetting it removes the choice. Changing an account clears that repository's GitHub results in connected clients without refreshing Git data.

Account edits use the server revision to reject changes prepared against an outdated selection. Updates are broadcast to connected clients and reloaded after reconnection. If the chosen account, or the default it follows, disappears, OpenTig reports it instead of falling back to another account.

Repositories that earlier used automatic selection, or followed the former shared default, now follow the default account. The former suggested account for new repositories becomes the default when none was set. Earlier per-repository Git authentication choices no longer exist: one account serves pull requests and Git HTTPS.

</details>

### Add an account

Open **Settings → GitHub → Accounts → Add account** for the [official GitHub CLI login instructions](https://cli.github.com/manual/gh_auth_login). Run the command in a terminal on the backend host:

```bash
gh auth login --hostname github.com --web --skip-ssh-key
```

Keep the existing Git protocol and decline Git credential setup. Then return to **Check accounts** in OpenTig.

**Login makes the newly added account globally active in `gh`**, while retaining saved accounts. Repositories in OpenTig keep their account; only other terminals and repositories that keep Git’s own credentials can be affected. The dialog can copy an optional command to restore the previously checked global account. OpenTig copies instructions; it does not execute login, logout, refresh, or global account switching.

Your CLI must support multi-account `auth token --user` and `auth status --json hosts`. If the JSON check is unsupported, OpenTig asks you to update `gh`.

## Review pull requests

1. Open **PRs** for the current repository.
2. Select a PR to inspect its metadata and Markdown description.
3. In **Code**, review the cumulative diff or use **By commit** to inspect changes from one commit. The selector supports keyboard navigation, readable subjects, and scrollable options.

**Current status**

While a PR is open in the viewer, its header shows where it stands according to GitHub: **Ready to merge**, **Review required**, **Required checks failing**, **2 commits behind main**, **Conflicts with main**, **In merge queue**, or **A branch rule blocks merging** when GitHub blocks it for a reason OpenTig can't see. Armed auto-merge appears as a badge with its method. Reading this status never changes anything on GitHub.

Click the checks summary to list individual checks, with what needs attention first, then what's in progress and what has completed. Required checks are marked, and a row opens that check on GitHub. A check that ran more than once shows its newest run. Past GitHub's first 100 checks, the list says so and links to the rest. If GitHub withholds details from your account, the list says some checks may be missing.

The latest verdict of each reviewer also appears in the header, marked if it was given before the latest commit.

<details>
<summary>How the status refreshes</summary>

The status refreshes only while the PR is open in the viewer and the window is visible:

| Situation | Refresh |
| --- | --- |
| GitHub is still computing mergeability | Every 10 seconds for a minute, then every minute |
| Checks are running, auto-merge is armed, or the PR is in a merge queue | Every 45 seconds |
| Any other open PR | Every minute |
| Merged or closed PR | No periodic refresh |

Returning to the window, reconnecting, changing the repository account, or manually refreshing checks immediately. If a refresh fails, the last status stays visible with a notice and **Retry**. Periodic refresh stops at GitHub's rate limit and resumes when you return to the window. A new head commit also refreshes the PR's details, commits, and code.

</details>

**Code is computed by Git in your clone**, so pull requests larger than GitHub's 300-file diff limit open normally. The first time you open a PR's code, OpenTig downloads its commits from the remote that holds the pull requests (`refs/pull/<number>/head`, plus the base commit if it is missing) without creating or moving any branch, tag, or remote-tracking ref, and then compares them the same way GitHub's **Files changed** does. Later views and **By commit** read locally. GitHub CLI returns at most 100 commits per PR, so for longer PRs the **Timeline** and **By commit** lists are completed from the downloaded history; GitHub avatars appear only for the commits GitHub returned. If the commits can't be downloaded, OpenTig asks GitHub for the diff instead, which only works within GitHub's limits. A diff larger than 32 MB shows its first complete files with a notice.

The PR list shows the effective GitHub account. Pull requests come from the GitHub repository of `origin`, unless you chose another remote with `gh repo set-default`: in a fork whose `origin` is your fork, run `gh repo set-default` in the clone and choose the upstream repository to see and open its PRs.

**Read the conversation**

**Timeline** shows the PR's comments and reviews above its commits, with Markdown rendered and links that open in a new tab. Choose **Hide bots** to leave out comments from bots. Comments hidden on GitHub stay collapsed until you open them. Past the most recent 100 comments and 100 reviews, the list says so and links to the rest. They load when you open **Timeline**. Inline code comments stay on GitHub.

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

## Merge and manage a pull request

The viewer's header offers the next step for the PR, and **⋯** lists everything else you can do with it. OpenTig checks your access first, so a reader sees no merge controls.

| Situation | Main control |
| --- | --- |
| Ready to merge | **Merge** |
| Behind a required base | **Update branch** |
| Blocked, and auto-merge is allowed | **Merge when ready**, beside the reason |
| Blocked, and auto-merge isn't allowed | The reason |
| Repository with a merge queue | **Add to merge queue**, or **Merge when ready** while requirements are pending |
| Draft | **Ready for review** |
| Layer of a native stack | **Merge on GitHub** |
| Conflicts | The conflict, with **Open on GitHub**. OpenTig doesn't resolve PR conflicts |

**Merging asks first.** The panel names the method, the base, and the account, and offers **Delete branch after merging**. It starts on your default method on GitHub, if the repository allows it. The option to delete the branch doesn't appear when GitHub already deletes branches on merge, or with auto-merge and queues, which finish later. Escape cancels, and the question goes away if the PR changes while it's open.

Closing, deleting a branch, enabling auto-merge, adding to a queue, and rebasing a branch also ask first. Rebasing warns that it rewrites commits. Marking as ready or draft, reopening, disabling auto-merge, and updating a branch by merge run straight away, because they're easy to undo or keep commits as they are.

**Merge** only ever merges, and **Merge when ready** only arms auto-merge. Armed auto-merge shows a badge with its method and **Disable auto-merge**, even if the PR later conflicts. A PR in a queue shows **Manage on GitHub**, because it's taken out of the queue there.

<details>
<summary>What OpenTig checks before acting</summary>

Just before an action, the server reads the PR again and stops if the account you reviewed has changed, if the head commit isn't the one you saw, or if the action is no longer allowed. It sends the same head commit to GitHub, so a push at the last moment also stops a merge. Your browser's copy of the PR isn't trusted for any of this, and nothing is retried automatically.

**Delete branch** works on the head repository, so it also covers your fork. It stops if the branch has moved since the PR, or if it's the default or base branch, and it finishes quietly if the branch is already gone. Stacked layers are left alone.

If GitHub takes too long, OpenTig says the action may have completed and checks the PR again, rather than reporting a failure. After a merge or a deleted branch it also fetches in the background, so your clone reflects the change even with periodic remote checks turned off.

</details>

**Edit a PR.** Choose **Edit title and description** in **⋯**. It uses the same Markdown editor as creating a PR. Saving stops if the PR changed on GitHub after you started, so another person's or a bot's edit isn't overwritten.

**Revert a merged PR.** **Revert** opens a new PR that undoes the merge, and shows it in the viewer. Nothing changes until you merge that PR. If GitHub doesn't answer in time, OpenTig holds **Revert** back until you've checked, because trying again could open a second PR.

**Approve workflows from a fork.** When a fork's checks wait for approval, **Approve workflows** lets them run. They run the fork's code, so review it first. OpenTig only approves runs that can belong to this PR: it refuses if another open PR uses the same commit and fork, and it checks each run again just before approving it.

**Stacks are still merged on GitHub.** So are stacks whose membership couldn't be confirmed: the viewer shows **Couldn't confirm the stack** with **Retry**.

## Create a pull request

**Publish the current branch and bring it up to date first.**

1. Open the PR creation dialog and review the effective GitHub account.
2. Choose the base branch and whether to create a draft PR using the adjacent toggle.
3. Write a title and description, then check the Markdown preview. You can also generate an editable draft from the branch diff.
4. Review and confirm to publish.

No PR is published before confirmation. Creation stops if the selected account or verified identity has changed since your review. The PR's head is the branch's upstream; when that is another repository, such as your fork while PRs target upstream, it is passed to GitHub as `owner:branch`.

Optional AI generation, with its provider and model, is in the dialog footer. Long coverage reports scroll inside the dialog. See [AI assistance](ai-assistance.md#pull-request-drafts) for coverage reports, output conventions, and stale comparisons.

## Settings scopes

Open **Settings → GitHub** to manage repository choices and connected accounts:

| Tab | Scope |
| --- | --- |
| **This repository** | Account choice, access checks, push destination, and commit authorship; shared across worktrees and connected clients |
| **Accounts** | Default account, connected accounts with **Make default**, repository usage counts, and CLI availability |

The default account is saved on the server and shared by clients. Changing it updates every repository that follows it, without changing repositories with their own account, commit authors, or the active `gh` account. Usage counts include registered repositories; worktrees count as one repository.

**Check access after external account changes**

Opening Settings shows saved metadata. After logging in, logging out, or changing accounts outside OpenTig, choose **Check access** to refresh the inventory and verify repository access.

Missing, stale, and failed checks are distinct from verified access. Failed checks keep the previous inventory as unverified and show next steps. **GitHub checks do not verify Git’s own credentials.** Refreshing the account inventory alone does not check repository access.

<details>
<summary>Where to find destinations, authorship, and diagnostics</summary>

The repository account is the primary control, with a short explanation of where it comes from. The push destination shows the repository and branch before the remote alias and protocol. The GitHub/PR repository appears separately when it differs from the push destination.

The commit author's name, email, and **Edit authorship** action are visible in repository settings. **Advanced · Git** contains the compact destination summary, how fetch and push authenticate, and **Copy diagnostics** in one collapsed section. **Accounts** shows CLI version and availability in a compact row without a disclosure. Access has a brief verification state and **Check access**.

**Copy diagnostics** copies check results, URLs, timestamps, and the last Git operation for troubleshooting, without displaying a diagnostic report in Settings.

</details>

<details>
<summary>Saved metadata and check caching</summary>

Settings initially shows the last checked CLI version, accounts for `github.com`, authentication/storage states, and repository identity. Operations still validate credentials as needed. Successful identity and SSH checks are reused for up to one minute; manual refresh bypasses those caches.

</details>

## Git credentials and push

**How Git authenticates**

Fetch, pull, push, and remote-branch operations to a plain `https://github.com/owner/repository` destination use the repository's account through its saved GitHub CLI credentials. **Clone from URL** uses the default account for such URLs, or another connected account that can read the repository, which then becomes the new repository's account. The active `gh` account and Git's global credential helpers don't affect them. Git uses its own credentials instead for:

- SSH remotes, which keep using your SSH key;
- other hosts and unusual URLs, such as URLs with embedded credentials or query strings;
- repositories set to **Git’s own credentials**, or without any account when no default exists.

No global helpers, SSH keys, remotes, or active `gh` account are changed.

**Push or publish a branch**

Push uses the repository's account and destination configured on the server. Check the account, destination, and target branch in **This repository**. Git’s own credentials are marked unverified rather than attributed to the repository account.

An ordinary push runs directly. You do not need to visit Settings, grant browser-storage approval, or confirm separately on each client. Fresh clients and clients that have already pushed use the same server configuration.

For a new branch with a resolved destination, use **Publish branch** to push and set an upstream. If Git cannot choose between remotes, **Where do you want to push?** lists full repository destinations, aliases, and branches. Publishing saves the tracking branch in Git on the server.

Every push reads and validates fresh server configuration. If that prepared context changes during execution, the operation stops. Multiple push URLs and unsupported configurations remain blocked with an explanation. **No operation silently switches accounts, rewrites remotes, or forces a push.**

**Understand access checks and rejections**

Checks distinguish identity, PR API access, Git read access to the push destination, and API-declared write permission. Write permission names the checked GitHub account; it does not verify Git’s own credentials or guarantee branch-policy approval.

Sanitized Git errors retain the actual rejection and never trigger an automatic force push. GitHub errors distinguish missing accounts, rejected credentials, repository/token/organization permissions, and unavailable CLI installations.

**When GitHub refuses access**

If a background or manual fetch is refused, the toolbar shows **Can’t fetch** until a later fetch succeeds. Its card names the account or credentials that were refused, keeps the Git output available, and offers the action most likely to fix it:

- **Use @account** when another connected account can access the repository; OpenTig pins that account and fetches again;
- **Authorize on GitHub** when the organization requires single sign-on for the account;
- **Repository access** to choose an account or connect a new one.

A refused pull or push shows the same explanation as a notification. For a push, the account action becomes **Use @account and push again**; when OpenTig has already switched the repository to an account with access, it offers **Push with @account**. New remote commits stay hidden while access fails.

### Managed credential boundaries

Managed Git HTTPS requires `curl`, which is included with Git for Windows. These operations do not recurse into submodules: open each submodule as its own repository or choose Git’s own credentials.

Account routing does not protect against hostile processes running as the same OS user. See [security and privacy](security-and-privacy.md) for the broader boundaries.

<details>
<summary>How managed operations handle tokens</summary>

Each operation uses a temporary helper and private loopback broker restricted to the GitHub host and repository path, with redirects disabled. Tokens do not enter Git arguments, configuration, files, or hook environments. Temporary resources are removed on completion, failure, and cancellation.

</details>

## Commit authorship

1. Open **Settings → GitHub → This repository → Edit authorship**.
2. Review the current Git identity, then enter a name and commit email.
3. Compare the before/after values and save.

If Git rejects a commit because no name or email is configured, the error notification offers **Set identity**, which opens the same editor for that repository. The commit message and staged changes are kept, so you can commit again after saving.

The editor saves repository-local `user.name` and `user.email` atomically. Future commits from OpenTig and other Git tools use those settings, shared across worktrees. **GitHub account changes never change authorship automatically.**

Existing history, global settings, remotes, credentials, SSH, and signing settings are preserved. Stale reviews and existing Git config locks prevent saving.

Environment overrides, custom `author.*`/`committer.*`, worktree-specific identities, command configuration, and linked config files are shown but must be managed outside this editor. Reusable authorship profiles and automatic account linking are not supported by the editor.

## Git’s own credentials

Repositories set to **Git’s own credentials**, and repositories without any account when no default exists, follow these rules for pull requests:

<details>
<summary>SSH identity and HTTPS environment credentials</summary>

**SSH remotes** perform a noninteractive handshake with an already trusted `github.com` host to identify the actual user, then obtain that user's saved `gh` token. Repository owners, organization names, and SSH aliases do not establish identity.

Missing accounts, deploy keys, failed handshakes, and custom SSH commands require choosing an account or correcting authentication. OpenTig does not fall back to another user.

**HTTPS remotes** use active `gh` credentials and honor backend `GH_TOKEN`/`GITHUB_TOKEN`. Repository and default accounts use their own stored credentials instead of these environment overrides. Checks do not create keys or change known hosts.

</details>
