# GitHub: pull requests, Actions, and releases

[← Documentation](README.md) · [Feature guide](features.md)

Install and authenticate the GitHub CLI (`gh`) 2.81.0 or later **on the machine running OpenTig** to use the **GitHub** section: pull requests, Actions, and releases. The integration supports `github.com`; GitHub Enterprise hosts are not currently supported.

Three settings control different parts of your work:

| Setting | Used for |
| --- | --- |
| **Repository account** | The **GitHub** section, from PR review and merging to releases and workflow runs, the current branch's PR, and fetch, pull, push, and remote-branch operations over GitHub HTTPS |
| **Default account** | The repository account of every repository that doesn't have its own |
| **Commit authorship** | The name and email recorded in future commits; changing a GitHub account does not change these |

Start by [choosing an account](#choose-an-account), then [review](#review-pull-requests) or [create a PR](#create-a-pull-request), [manage releases](#manage-releases), or [follow workflow runs](#follow-workflow-runs). For an existing setup, see [Git credentials and push](#git-credentials-and-push) or [commit authorship](#commit-authorship).

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
| **Git’s own credentials** (Advanced) | Git uses the credential helper or SSH key on the desktop computer or backend server; the **GitHub** section uses the account active in GitHub CLI |

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

Keep the existing Git protocol and decline Git credential setup. Then return to OpenTig and choose **I have finished · check accounts**.

**Login makes the newly added account globally active in `gh`**, while retaining saved accounts. Repositories in OpenTig keep their account; only other terminals and repositories that keep Git’s own credentials can be affected. The dialog can copy an optional command to restore the previously checked global account. OpenTig copies instructions; it does not execute login, logout, refresh, or global account switching.

Your CLI must support multi-account `auth token --user` and `auth status --json hosts`. If the JSON check is unsupported, OpenTig asks you to update `gh`.

## Review pull requests

1. Open **GitHub** for the current repository. **Pull requests** lists them, each with its author's avatar and a status dot, its number, where it stands, the lines it adds and removes, and how long ago it was updated.
2. Select a PR to inspect its metadata and Markdown description. What the list already knows, such as its title, branches, line counts, and state, appears at once; the description, labels, file count, and status fill in as GitHub answers. A PR opened from a link before the list has loaded shows the shape of its header until then.
3. In **Code**, review the cumulative diff or use **By commit** to inspect changes from one commit. The selector supports keyboard navigation, readable subjects, and scrollable options. Each file's **Open file** button opens it in Files as it is in your worktree, which may be on another branch than the PR's.

**The list**

The list reads one request for all PRs, which carries their reviews and checks but not whether each one can merge. A row therefore says **Review required**, **Changes requested**, **Checks failing**, **Checks pending**, **Approved**, **Checks passing**, or its state, such as **Draft** or **Merged into main**, and only the selected row shows the full status below.

OpenTig reads the list and the releases as soon as a GitHub repository opens, so the section shows them straight away; opening it refreshes a list read more than 30 seconds earlier, and keeps showing the old one meanwhile. The backend also reuses a list it read in the last 30 seconds, or a minute for releases, so reloading the app doesn't wait for GitHub; **Refresh** always asks GitHub, and so does the first read after a change made through OpenTig. Stack indicators fill in a moment after the rows. **Actions** is read when you open it.

The filter button beside the tabs chooses which states appear. Its menu also has **Refresh pull requests**, **Open on GitHub** with the repository's name, and the effective account, which opens GitHub settings. **+** creates a PR from the current branch; while it's unavailable, its tooltip says why.

**Current status**

While a PR is open in the viewer, a line under its title shows where it stands according to GitHub: **Ready to merge**, **Review required**, **Required checks failing**, **2 commits behind main**, **Conflicts with main**, **In merge queue**, or **A branch rule blocks merging** when GitHub blocks it for a reason OpenTig can't see; otherwise its state, such as **Draft**, **Merged into main**, or **Closed**. Armed auto-merge appears there as text with its method. Reading this status never changes anything on GitHub.

**Checks** lists the individual checks, and the summary on that line, such as **2 checks passed**, takes you there. What needs attention comes first, then what's in progress and what has completed. Required checks are marked. A GitHub Actions check of this repository opens its run in OpenTig, at that job; other checks open on GitHub. A check that ran more than once shows its newest run. Past GitHub's first 100 checks, the list says so and links to the rest. If GitHub withholds details from your account, the list says some checks may be missing.

The latest verdict of each reviewer also appears on that line, marked if it was given before the latest commit. The author, last update, and labels are in the muted line above it.

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

The status is read from GitHub every time. A PR's details are reused for up to a minute, or ten for a merged or closed PR, and its conversation for a minute, so going back to a PR doesn't wait for GitHub; they are read again sooner when the status shows the PR changed on GitHub, and right away after you change anything through OpenTig. In the viewer, a tab you have already opened keeps what it showed, so switching back to **Comments** or **Code** doesn't load them again.

</details>

**Code is computed by Git in your clone**, so pull requests larger than GitHub's 300-file diff limit open normally. The first time you open a PR's code, OpenTig downloads its commits from the remote that holds the pull requests (`refs/pull/<number>/head`, plus the base commit if it is missing) without creating or moving any branch, tag, or remote-tracking ref, and then compares them the same way GitHub's **Files changed** does. Later views and **By commit** read locally. GitHub CLI returns at most 100 commits per PR, so for longer PRs the **Timeline** and **By commit** lists are completed from the downloaded history; GitHub avatars appear only for the commits GitHub returned. If the commits can't be downloaded, OpenTig asks GitHub for the diff instead, which only works within GitHub's limits. A diff too large for one server response (4 MiB) shows the complete files that fit, with a notice that some are missing.

The list's menu shows the effective GitHub account. When a repository can't be reached with it, the error names the account, and OpenTig stops checking the branch's PR in the background until you refresh or change the account. Failures that may pass by themselves, such as a dropped connection after waking the machine, are retried once and then checked again every minute; a rate limit is checked every 5 minutes. Pull requests come from the GitHub repository of `origin`, unless you chose another remote with `gh repo set-default`: in a fork whose `origin` is your fork, run `gh repo set-default` in the clone and choose the upstream repository to see and open its PRs.

**Read the conversation**

**Comments** shows the PR's comments and reviews, with Markdown rendered and links that open in a new tab. Choose **Hide bots** to leave out comments from bots. Comments hidden on GitHub stay collapsed until you open them. Past the most recent 100 comments and 100 reviews, the list says so and links to the rest. They load when you open **Comments**. Inline code comments stay on GitHub. **Timeline** lists the PR's commits.

**Comment and review**

**Write a comment** at the end of the conversation is one line until you focus it. It then opens with the same Markdown preview as creating a PR, **Comment**, and **Review**. Leaving an empty box folds it, and Escape folds it without losing what you wrote. **Review** adds **Approve**, **Request changes**, and **Comment as a review**. Only **Approve** can go without text. **Review** doesn't appear on your own PR, where GitHub wouldn't allow a verdict. A review can't be deleted once it's submitted, so use **Comment** for text you may want to remove. A review stops if the PR has received new commits since you read it, so a verdict is never applied to code you haven't seen.

If GitHub doesn't answer in time, your text stays in the box and sending is held back until you've checked the conversation, because sending again could post it twice.

**Edit or delete what you wrote**

Your own comments and reviews have a **...** menu, shown only when GitHub allows what it offers. **Edit** opens the text where it is, or in a sheet on a phone, and doesn't change a review's verdict. **Delete** only appears on comments, because GitHub doesn't allow deleting a review once it's submitted. It asks first and can't be undone. Neither touches other people's comments, even when you're a maintainer: use GitHub for those.

Both stop if the text changed on GitHub after you last saw it, and saving again after that warning replaces that version.

**Open the current branch's PR**

Beside the branch in the top bar, the PR indicator shows the current branch or worktree's PR number. A purple merge icon identifies a merged PR, and **Draft** a draft one. Click for its full title, status and lines added and removed, then choose **Open in OpenTig** or **Open in GitHub**. Links to the repository's PRs, commits, releases and workflow runs, in descriptions, comments, notes and history, offer the same choice. The mobile repository menu offers the same choices; the repository menu also opens the repository on GitHub.

<details>
<summary>How OpenTig matches and refreshes the current PR</summary>

Matching checks both the head repository and branch name, so another fork's `main` is not mistaken for your clone. When several PRs match, the most recently updated open PR takes priority. Otherwise, the most recently updated PR is shown if merged.

The current branch indicator checks open PRs once a minute while the window is visible. Closed, merged, or absent results are checked every five minutes to discover reopened PRs or reused branches. Returning to the window, reconnecting, changing the repository account, or manually refreshing checks immediately. Failed checks retry every minute; hidden windows do not poll.

CLI availability is checked at startup and reused across repositories and list filters. Returning to **GitHub** keeps cached results visible during background refreshes. **Refresh pull requests** in the list's menu checks CLI availability again.

</details>

<details>
<summary>Links in PR titles, descriptions, and previews</summary>

Web links open in a new browser tab, or the system browser on desktop. Hover or focus a link to see its destination and **Open in new tab** (**Open in browser** on desktop). Email links show **Open in mail app** and use the mail client. This also applies to the creation dialog's Markdown preview.

</details>

### Native stacks

Click a layer indicator such as **2/3** to open a native GitHub stack. Indicators appear beside the current branch PR, in PR rows, in the right-hand viewer, and in the mobile repository menu. On a phone a PR row names its layer in text instead, and the viewer has the indicator. The viewer confirms membership with the PR's status, so for a PR the list didn't show, its indicator appears with the status rather than with the title.

The menu lists layer states, titles, branches, and bases, including layers outside the current filter. Details load when opened. If a refresh fails, previously loaded layers remain available with a notice and retry.

**Stack navigation is read-only.** Indicators appear only when GitHub reports native stack membership, independently of worktrees or other local branches. OpenTig does not infer stacks from branch relationships, merge layers, or rebase branches.

## Merge and manage a pull request

The viewer's header offers the next step for the PR, and **⋯** lists everything else you can do with it. OpenTig checks your access first, so a reader sees no merge controls. On a phone the next step floats above the bottom bar on **Summary**, **⋯** is in the top bar, and what asks first does so in a sheet with the same checks. See [phone navigation](interface.md#phone-navigation).

| Situation | Main control |
| --- | --- |
| Ready to merge | **Merge** |
| Behind a required base | **Update branch** |
| Blocked, and auto-merge is allowed | **Merge when ready**, beside the reason |
| Blocked, and auto-merge isn't allowed | The reason |
| Repository with a merge queue | **Add to merge queue**, or **Merge when ready** while requirements are pending |
| Draft | **Ready for review** |
| Layer of a native stack | **Merge on GitHub** |
| Conflicts | Only the conflict in the status line, with **Open on GitHub** in **⋯**. OpenTig doesn't resolve PR conflicts |

**Merging asks first.** **Merge** and the arrow beside it open a popover that names the base and the account, lists the methods the repository allows, and offers to delete the branch after merging. It starts on your default method on GitHub, if the repository allows it. The option to delete the branch doesn't appear when GitHub already deletes branches on merge, or with auto-merge and queues, which finish later. Escape cancels and returns to the button, and the question goes away if the PR changes while it's open.

Closing, deleting a branch, enabling auto-merge, adding to a queue, and rebasing a branch also ask first, in a popover beside the button or **⋯** that led there. Rebasing warns that it rewrites commits. Marking as ready or draft, reopening, disabling auto-merge, and updating a branch by merge run straight away, because they're easy to undo or keep commits as they are.

Once you answer for the main button, its question closes and the button tells how it's going, such as **Merging…** and then **✓ Squashed and merged** once GitHub confirms it, before it gives way to the PR's new state. If GitHub refuses, the button comes back and the reason appears in a notice. With no answer it says **Checking…** while the PR is read again, and it never shows a tick for a result GitHub didn't confirm. A question asked from **⋯** stays open until its answer arrives.

**Merge** only ever merges, and **Merge when ready** only arms auto-merge. Armed auto-merge shows its method in the status line and **Disable auto-merge**, even if the PR later conflicts. A PR in a queue shows **Manage on GitHub**, because it's taken out of the queue there.

<details>
<summary>What OpenTig checks before acting</summary>

Just before an action, the server reads the PR again and stops if the account you reviewed has changed, if the head commit isn't the one you saw, or if the action is no longer allowed. It sends the same head commit to GitHub, so a push at the last moment also stops a merge. Your browser's copy of the PR isn't trusted for any of this, and nothing is retried automatically.

**Delete branch** works on the head repository, so it also covers your fork. It stops if the branch has moved since the PR, or if it's the default or base branch, and it finishes quietly if the branch is already gone. Stacked layers are left alone.

If GitHub takes too long, OpenTig says the action may have completed and checks the PR again, rather than reporting a failure. After a merge or a deleted branch it also fetches in the background, so your clone reflects the change even with periodic remote checks turned off.

</details>

**Edit a PR.** Choose **Edit title and description** in **⋯**. The viewer becomes the editor, with the same Markdown field as creating a PR, **Save changes**, and **Cancel**. Escape only leaves it if you haven't changed anything, and selecting another PR discards what you haven't saved. Saving stops if the PR changed on GitHub after you started, so another person's or a bot's edit isn't overwritten.

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

## Manage releases

In **GitHub**, switch to **Releases** to list the repository's 50 most recent releases, including drafts if your account can see them; older ones are on GitHub. Each row has the title and, at the right, the date, after the state unless it's simply published. Select one to read its notes and assets in the viewer; the line under its title gives its state and tag. **+** beside the tabs creates a draft, and the **⋯** menu next to it has **Refresh releases**, **Open on GitHub**, and the account. Running workflows is in [Actions](#follow-workflow-runs).

**OpenTig never creates or moves a tag itself.** A draft can name a tag that doesn't exist yet: GitHub creates it from the draft's branch or commit when the release is published, as on GitHub's own page. Assets are managed outside OpenTig.

| Action | What to expect |
| --- | --- |
| **+** | Opens **New draft release**, which creates a draft with a tag, a title and notes, optionally adding GitHub's generated notes or marking it as a pre-release. While you type the tag, it says whether it exists on GitHub or already has a release. A new tag asks which branch or commit GitHub creates it from, the default branch unless you change it. Creating stops if the tag appeared or went away in between |
| **Edit title and notes** | In the viewer's menu. Changes the title and notes of a draft or a published release in place, with **Save changes** and **Cancel**. Notes are edited raw, so any comment markers that automation keeps in them stay as they are. Saving stops if the notes changed on GitHub first, because workflows also write to them |
| **Publish** | Asks first beside the button, showing the tag, commit, whether it's a pre-release, and the assets. Publishing can start workflows that run on publication. When the tag doesn't exist yet, the line under the title says **Publishing creates the tag**, and the question says where GitHub creates it: the draft's commit, or the latest commit of its branch. Publishing stops if the tag appeared or went away after you were asked |
| **Delete draft** | In the viewer's menu. Asks first, lists what's lost, and keeps the tag. Published releases are only deleted on GitHub |

Assets aren't checked for completeness: **review them before publishing**.

These actions use the repository's account and stop if that account changed since you reviewed it. **Publish**, **Edit title and notes**, and **Delete draft** appear only with write access; without it, creating a draft is refused with an explanation.

## Follow workflow runs

In **GitHub**, switch to **Actions** to list the repository's GitHub Actions runs, newest first, 50 at a time; **Load more** at the end of the list adds the next 50, up to GitHub's limit of 1,000. Each row shows the avatar of whoever started the run, with its result as a badge where a pull request shows its status, then the run's title and age. Under them are the workflow, an icon for what started the run with its reference, who started it unless it was scheduled, and how long it took, or its state while it waits to start. A run's commit, pull request, or release opens the same menu as other GitHub references, with **Open in OpenTig** and **Open in GitHub**; the rest of the row opens the run, and on desktop the button at its end opens it on GitHub. A manual or scheduled run shows its branch as plain text, and a fork's pull request, which GitHub doesn't name, shows its branch.

The filter menu beside the tabs shows the runs of one active workflow and has **Refresh workflow runs**, **Open on GitHub**, and the account. While the tab is open, the list is read again every 30 seconds, or every 10 seconds while a listed run hasn't finished, so runs started on GitHub or from a terminal appear by themselves, fading in at the top.

**Read a run**

Select a run to see it in the viewer as a graph of its jobs. The line under its title sums it up, such as **In progress · 3 of 12 jobs done** or **Failed · 2 jobs failed**, followed by the workflow and run number, branch, commit, what started it, when, and its duration. **Open on GitHub** is beside the title, or in **⋯** on a phone. A run that was re-run shows its latest attempt. While the run is going, it's read again every 5 seconds and durations count up.

Each job of the workflow file is a box, connected to the jobs it needs, and a matrix lists its jobs inside its box, folding past six. A job that hasn't started yet shows **Waiting**, and once the run ends, **Not run**. The dependencies come from the run's workflow file at the run's commit; if OpenTig can't read it, the jobs are grouped by name, unconnected, and a note says so. Runs with more than 100 jobs show the first 100, with a note. The graph opens fitted to the pane:

| On the graph | Action |
| --- | --- |
| Drag, or the wheel | Move it |
| `Ctrl`/`⌘` + wheel, or pinch | Zoom, from 25% to 200% |
| `+`, `-`, `0`, arrow keys | Zoom in, zoom out, fit, and move, with the graph focused |
| Buttons at the bottom right | **Zoom out**, the zoom level, which returns to actual size, **Zoom in**, and **Fit to view** |
| Click a job | Show its state, duration, runner, and steps, with **Logs on GitHub** |

**Run a workflow**

**Run a workflow**, the ▶ button beside the filter, opens a dialog with two panes, starting on the filtered workflow:

- **Run manually** on the left: workflows whose file on the default branch can be run manually (`workflow_dispatch`), each with dots for its latest results, and a search box. Workflows that only run automatically, including GitHub's own such as Dependabot's, are folded under **N automatic**, with what starts them. A workflow whose file OpenTig can't read is offered anyway.
- **The chosen workflow** on the right: the **Branch** to run on, picked and searched like the top bar's branch selector from the first 100 of the repository's branches on GitHub, with the default first. Then come the workflow's inputs as its file on that branch declares them: text, numbers, switches, and lists of choices, with their descriptions and defaults, and `*` on required ones; an environment input is typed as text. An optional input left empty isn't sent. Below them are its three latest runs, which open in the viewer.

**Run workflow** says why it's off, such as a required input that's empty or a branch whose file can't be run manually. It asks first beside the button, listing the branch and each input's value and warning that the workflow can make commits, tags, and publications. Once GitHub accepts the request, the dialog closes and the ▶ button spins until GitHub lists the new run, usually within seconds, which then opens in the viewer, switching the filter to that workflow if another one was chosen. If that takes longer than 45 seconds, the run still appears in the list. GitHub checks the inputs against the file and explains any problem. If GitHub doesn't answer in time, **Run workflow** stays off until you choose **Refresh runs**, because trying again could start it twice.

Running needs write access to the repository and uses the repository's account, like release actions. The `repo` scope that every `gh` login has is enough, so no extra scope is needed.

**What stays on GitHub**

Apart from starting a workflow, Actions only reads runs. Use GitHub for:

- logs, which each job links to;
- re-running and cancelling runs;
- approving deployments that wait for an environment;
- downloading artifacts;
- enabling, disabling, and editing workflows.

A fork's runs waiting for approval are approved from its pull request, with [**Approve workflows**](#merge-and-manage-a-pull-request).

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

**Pushing workflow files needs the `workflow` scope.** Over GitHub HTTPS, GitHub refuses a push that adds or changes a file under `.github/workflows/` with a `gh` token that lacks it. Run `gh auth refresh -h github.com -s workflow` on the backend host. It applies to the account active in `gh`, so if the repository uses another one, switch to it first with `gh auth switch`.

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

Repositories set to **Git’s own credentials**, and repositories without any account when no default exists, follow these rules in the **GitHub** section:

<details>
<summary>SSH identity and HTTPS environment credentials</summary>

**SSH remotes** perform a noninteractive handshake with an already trusted `github.com` host to identify the actual user, then obtain that user's saved `gh` token. Repository owners, organization names, and SSH aliases do not establish identity.

Missing accounts, deploy keys, failed handshakes, and custom SSH commands require choosing an account or correcting authentication. OpenTig does not fall back to another user.

**HTTPS remotes** use active `gh` credentials and honor backend `GH_TOKEN`/`GITHUB_TOKEN`. Repository and default accounts use their own stored credentials instead of these environment overrides. Checks do not create keys or change known hosts.

</details>
