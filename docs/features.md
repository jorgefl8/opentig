# Feature guide

[← Documentation](README.md) · [Project overview](../README.md)

OpenTig is early-stage software. This guide describes the current interface and its limits.

## Main workflow

1. Open an existing local Git repository with `Ctrl+O`, or choose one from the recent-repository picker.
2. Review unstaged, staged, and conflicted files in **Changes**.
3. Open a syntax-aware diff, stage only the intended files, and write or generate an editable commit message.
4. Commit locally, optionally commit and push, then inspect the result in **History**.
5. Use **PRs** to review or create a GitHub pull request when the repository is connected to GitHub.

## Features

### Repositories and projects

- An unpaired browser offers **Pair this browser** with the appropriate CLI command. Both the authentication notice and pairing form show the command inline (`npm run pair:web:dev` for Dev, `opentig pair` for production) beside an icon-only copy button, sharing the Markdown copy animation and confirmation tick. Both views fit narrow screens and scroll when necessary. Opening `/pair` checks the existing browser session first and returns authenticated browsers directly to the app; a failed connection offers a retry instead of asking for a new code. Paired sessions survive server restarts with the same data directory; a new pairing is needed if the browser loses its session cookie or access is revoked.
- Run **OpenTig Dev** alongside production with separate preferences, recent repositories, window state, logs, browser sessions, and network-access settings. Desktop source runs and packaged Dev builds share one persistent desktop Dev profile; only one desktop Dev instance runs at a time. The browser-only source runner uses its own Dev data directory. A fresh Dev profile starts with Network access and the global double-Control shortcut off.
- Installed Windows releases check GitHub for stable updates at startup and every 5 minutes, and check when the window regains focus if the last attempt was at least 5 minutes ago. **Settings → Updates** also offers a manual check, download progress, release notes, and **Restart and install**. Updates use the icon and Settings without floating notifications. A persistent download icon with a small notification dot beside Settings (or at the top of the welcome screen) starts the download directly when clicked. A progress ring fills around that same icon during download; once ready, a check badge replaces the dot and clicking the restart icon installs the update. Hovering or focusing the icon opens a card with the version, status, and up to eight release-note entries, plus a link to the remaining changes on GitHub. Downloading never installs on ordinary exit. Restart waits for edited files to allow closing and for the local server/settings to shut down. Dev, local candidates, unpacked/copied applications, and browser clients do not check for or install desktop updates.
- Open existing local repositories and keep added repositories available until you remove them. Opening a repository preserves its position and new repositories append to their group, so numbered shortcuts stay stable. The repository dialog offers location shortcuts, recent checkouts, clickable breadcrumbs, a folder filter, hidden-folder controls and an editable path. Git repositories and linked worktrees show their branch, including unborn branches and detached HEAD. Select a repository before opening it; a failed or pending navigation clears the previous selection. Ctrl+L edits the path, arrow keys select folders, Right browses into a folder, and Enter opens a repository. Desktop also offers its native folder picker. Mobile layouts keep the current folder and confirmation visible; the welcome screen scrolls when added repositories exceed the available height.
- Use the same authenticated WebSocket backend from the desktop app or a paired browser. On desktop the backend runs in a supervised utility process, so a renderer reload or crash does not stop repository watchers or in-flight server state while the desktop process remains open; an unexpected backend exit is restarted with bounded backoff. Repository switches and filesystem/Git events propagate to every connected tab, and reconnecting clients bootstrap fresh state without replaying interrupted mutations. Browser clients choose server folders in the repository dialog; native folder selection and Explorer reveal remain desktop-only, and their header uses the full browser width instead of reserving space for desktop window controls. The first payload is the workspace shell; Settings, History, PR creation, Files, Search, and the PRs list load the first time you open them.
- Linux instances installed with `opentig service install` offer the same update icon and **Settings → Updates** in paired browsers. The server checks every five minutes and only offers a stable GitHub release once its matching CLI is available on npm. Clicking downloads and verifies the package, prepares its dependencies without stopping the current server, and then offers **Restart and install**. A separate systemd worker preserves the address and private home, restarts the service, and restores the previous version if the new server fails its readiness check. Running commands delay installation; browsers with unsaved edits or active operations do not reload automatically. Other browsers reconnect and reload the matching web interface. Dev and temporary `npx`/foreground instances require terminal updates.
- Run that exact server/runtime/client bundle through `npx --yes @opentig/cli@<version>` or plain `bunx @opentig/cli@<version>`. The default/start command opens a five-minute one-use pairing link, while `serve` stays headless and prints its portable code, link, and terminal QR. `opentig pair` safely mints a fresh code for a server already using the same private home directory. The CLI keeps its configured port stable—`6767` by default—and reports a conflict instead of silently moving a tunnel target.
- Keep that backend loopback-only by default, or enable **Settings → Web access → LAN access** to restart the same utility listener on trusted LAN interfaces. Every browser still requires a one-use pairing code. A same-machine Cloudflare Tunnel or HTTPS reverse proxy can point straight to `http://127.0.0.1:<port>` without registering the public URL in OpenTig: open `/pair` on that domain and paste the generated code. OpenTig validates each HTTP/WebSocket origin against the authority used for that request, trusts forwarded authority/client-IP metadata only from loopback, and issues a `Secure` cookie for HTTPS. The same pane gives paired devices editable names, shows browser/OS, proxy/IP and connection activity, and revokes them individually or together; stale desktop sessions are replaced rather than accumulated. Browsers can manage sessions but cannot change the native listener.
- Use **Manage projects → Relocate repository** to select an existing folder manually, even before opening fails. Desktop uses a native folder picker; browsers use the visual server folder picker. Relocation updates the saved path without moving files, preserving the project assignment, open tabs, and expanded folders.
- **Remove from OpenTig** forgets a repository and its worktrees, clears their recent entries and project assignment, and returns to the welcome screen if the active repository was removed. A confirmation explains that folders and Git data stay on disk; you can open them again later. Save or close unsaved editor tabs before removing or relocating a repository.
- Group related repositories into named OpenTig projects without moving anything on disk. **Manage projects** saves project order and repository order within each group, including **No project**, with drag handles, keyboard dragging, and up/down buttons on desktop. Mobile uses larger up/down buttons without dragging, preserving scroll and focus after each move and briefly highlighting the moved row; reduced-motion preferences disable that highlight. Repository numbers match the selector. The repository dropdown grows to use up to 80% of the available viewport height, keeping search and management visible while its list scrolls; other dropdowns stay compact.
- Pull or push an individual repository from its row in the repository picker. Each row shows the repository name plus the branch that pull or push will use, and the worktree folder when that checkout is a linked worktree (the filesystem path is on the hover tooltip). When the repository has a favicon or app icon on disk (`favicon.svg`/`favicon.ico` at the root or under `public/`, `app/`, and similar locations, or a `<link rel="icon">` in `index.html`), that icon appears beside the name in the toolbar picker and in each row. Only pending operations are shown, each with its ahead/behind commit count; multiple repositories can sync concurrently, and their separate Sileo progress and outcome cards remain visible together. Opening the picker fetches each listed repository so those counts and checkouts match the remote, not a stale local cache.
- Fetch remotes in the background so toolbar ahead/behind counts stay current. The default interval is 30 seconds. **Settings → General** offers common intervals, a custom value from 5 to 300 seconds in steps of 5, and Off to disable periodic fetch while keeping checks on pull and push.
- Create, rename, delete, and reassign project groups.
- Switch quickly between repositories, branches, and available worktrees.
- Display current branch, ahead/behind state, and worktree insertion/deletion totals in the main toolbar.
- Coalesce overlapping watcher and manual refreshes, and keep the current diff mounted when a refresh changes only status or refs.
- Carry the OpenTig logo through the main toolbar, browser favicon, packaged Windows application, installer, and taskbar. In the toolbar the ring follows the theme text colour so it stays visible in light and dark, while the T stays brand blue. The favicon and Windows application icon place that mark on a dark rounded badge. The first painted frame is already that splash, inlined in `index.html`, so the window never opens on an empty sidebar. Desktop OpenTig reopens at the same position and size it had when last closed, including maximized. If a saved position is partly off-screen or the monitor layout/scaling changes, OpenTig moves and, when needed, shrinks the window to fit an available display; a fresh window or a disconnected-monitor position is centered on the primary display. The splash fills that restored window instead of forcing a maximized first paint. Desktop and browser then keep the same splash until the workspace is restored.

### Changes, diffs, and commits

- Separate conflicted, staged, and unstaged changes.
- Display changes as a flat list or recursive tree.
- Treat each visually highlighted change or folder row as one continuous click target, with a pointer cursor across the active surface, while preserving its dedicated diff, open, stage, unstage, and discard controls.
- Stage or unstage individual files, folders, selections, or everything at once.
- Discard selected unstaged changes through an in-app confirmation that lists the affected paths; untracked files are sent to system Trash (the Recycle Bin on Windows).
- Review syntax-aware diffs in unified or split mode, with optional line wrapping, colored with the same One Light/One Dark Pro token palette as the Files editor and Markdown code blocks; added, deleted, and modified lines keep their own diff colors. Each file header shows the file name in full, with the folder path underneath. Language grammars load for the file being viewed rather than at startup.
- Open changed Markdown files directly in their staged or unstaged diff, while keeping **Open file** available for the rendered preview. Changed HTML, SVG, and image files retain their direct rich preview and separate diff action.
- Resolve merge conflicts in the built-in conflict editor, syntax-highlighted with the same palette as diffs and the Files editor, and mark resolved files for staging. Accepting the current, incoming, or both sides stays visible while background refreshes reconcile the saved file.
- Create commits from staged files, or create and push in one action when an upstream exists.
- Let the selected AI CLI suggest a reviewed multi-commit plan when staged files represent independent responsibilities, then prepare one complete-file group at a time without creating commits automatically.
- Work through that plan at your own pace: groups keep their original numbering as you commit them, show how many are done, open any listed file's diff for review, and each group is independently rechecked against its files so a plan cannot be applied after those files changed.
- When a split cannot be offered, OpenTig says why instead of staying silent, for example because a file is only partially staged or was renamed.
- Every generation is recorded locally for diagnostics: harness, model, outcome, duration, the tokens and cost the harness reported, why a proposed split was refused, and, when a run fails, the error the harness returned. Only this metadata is stored in the history. When you request AI assistance, the selected CLI receives the bounded context and may send it to its configured provider; see [AI privacy](security-and-privacy.md#ai-privacy).
- Review that history from **Settings → AI assistance → View history**, in a sortable table (click a column header to sort) that scrolls within the dialog, with totals for runs, failures, tokens, and reported cost, and clear it whenever you want.
- Record failed Git, file, and network operations locally for diagnostics: operation, error code, and a redacted message. Prompts and file contents are never stored. Review that history from **Settings → Diagnostics → View problems**, and clear it whenever you want.
- Undo the latest unpublished commit while keeping its changes staged. OpenTig verifies the expected commit and upstream state before rewriting history.

### Safe pull and push

- Pull by fast-forward when the branch has no local commits, or rebase those local commits onto the updated remote when the histories have diverged and there are no conflicts. The unpublished commits stay on top, ready to push. OpenTig does not create an implicit merge commit.
- If a rebase would conflict, abort it and leave the branch unchanged instead of stranding the repository mid-rebase.
- Preserve local changes through a temporary safety stash when pulling, including untracked files.
- Keep and report the recovery stash if changes cannot be restored cleanly.
- Publish branches without an upstream, including branches with no new commits, from the toolbar, history, repository selector, Commit & Push, or the pull-request dialog. Use the configured push remote or the only available remote; choose one when several are available without a preference. Publishing sets upstream tracking and leaves uncommitted files untouched.
- Refuse unsafe pull or push states such as unresolved conflicts or an active Git operation. Pull requires an upstream; publishing requires a checked-out branch with at least one commit and a configured remote. Existing remote history is never force-pushed.
- Surface remote rejection, branch-protection, authentication, configuration, pending conflicts, and other one-shot operation failures as Sileo toasts rather than a persistent top banner. Each pull and push operation has its own progress and result toast. Conflict notices are deduplicated per repository across refreshes and dismissed as soon as the conflicts are resolved, without closing an in-progress pull. The Changes view remains the persistent source of truth. Read-only Git operations still use an in-app banner.
- Render app-authored Sileo toast copy in sentence case throughout the app, preserving product names, acronyms, and user-provided text.
- Keep dialogs above virtualized diff content, including sticky file headers, so Settings and confirmations cannot be partially covered by the viewer.

### Files and editing

- Browse the repository as a virtualised tree with sticky parent folders and persisted expansion state. While a file is open, ancestor folders pin at the top of the list as opaque overlays; hovering them keeps that cover, and clicking one scrolls the folder into view without selecting or collapsing it.
- Keep open files in a compact tab strip in the header: a single click previews a file and the next preview replaces it, while editing, double-clicking, or `Ctrl`-clicking pins the tab so it opens alongside the preview instead of replacing it. Tabs can be reordered through a lifted drag preview with animated live placement, closed with the middle mouse button, show the parent folder when two files share a name, and expose their full path and state in a styled tooltip.
- Open a file from its **Files** context menu as a replaceable preview or choose **Open to the Side** (`Ctrl`-click) to pin it beside the current file. Dragging a file from the tree onto the header tab strip performs the same pinned open with explicit drop feedback.
- Open text files in the built-in syntax-aware editor, using the same One Light/One Dark Pro palette as Markdown code blocks, and save with external-change protection. Repeated blank lines can be appended at the end of ordinary files without flashing an internal render error or losing editor focus, while large files retain virtualised rendering. A floating Save button appears over the editor while a file is dirty - the tab's own dot already marks it unsaved, so the button carries no redundant label - and saving keeps your scroll position instead of jumping to the top. Markdown, HTML, and SVG previews share accessible Preview/Code tabs with mouse and keyboard navigation.
- Move freely between open files without losing work: unsaved changes stay in memory for the running application, closing a modified tab offers Save, Discard, or Cancel, and only the active file keeps an editor loaded.
- Restore each worktree's open tabs, their order, and the file that was active when you return to it. Tab paths are remembered between sessions; unsaved text is never written to disk.
- Keep a tab whose file was renamed or moved pointing at its new path. A tab with unsaved changes whose file disappears stays open and is marked unavailable so its text can still be recovered, while clean tabs simply close.
- Only working-tree files become tabs; diffs, conflicts, commits, and pull requests stay transient. Up to 50 tabs are kept per worktree, and opening past that closes the clean tab you used least recently.
- Press `Ctrl+F` in any editable file to open one integrated find-and-replace panel, with single or global replacement, case, whole-word, regular-expression, and undo support.
- Preview and edit Markdown, HTML, and SVG files through compact Preview/Code controls; switching between them restores roughly the same scroll position in the tab you land on, holding it while diagrams, formulas, and syntax highlighting finish laying out, and releasing it the moment you scroll yourself.
- Render GitHub-flavoured Markdown with syntax-highlighted code, copy buttons, alerts, footnotes, KaTeX, and Mermaid diagrams. Syntax highlighting, KaTeX, and Mermaid load when a Markdown preview actually needs them; opening a source file does not. External links (`http(s)://`, protocol-relative, and `mailto:`) open in your system browser or mail client instead of navigating inside OpenTig; relative links to repository files open that file in a new tab, and `#anchor` links scroll within the preview. Hovering any link shows a tooltip with its destination (truncated when long) and what clicking it will do (open in browser, open in mail app, or open file).
- Preview raster images with fit, 1:1, keyboard/wheel zoom, dimensions, and file-size information.
- Select multiple files and folders, then copy, cut, paste, rename, create, or delete them. Desktop paste imports explicit file paths (or a clipboard image) only when you press `Ctrl+V` or choose Paste; runtimes without native file-clipboard support hide that action. Copy and move operations reject placing a folder inside itself, including when its parent is reached through a filesystem alias or Windows short path. Deletion requires an in-app confirmation that lists the affected paths. Drag and drop moves one or many selected entries with a lifted preview, a count badge, and clear folder or repository-root destination feedback.
- Copy file paths or contents and reveal entries in Windows File Explorer.
- Undo and redo supported file operations. Large or directory deletions fall back to system Trash when an in-app snapshot is not practical.
- Optionally include Git-ignored files in the tree.

### Quick open and repository search

- Open files by fuzzy path search with `Ctrl+P`, navigate the accessible result list with the arrow keys, and open the highlighted file with `Enter`.
- Search file contents across the repository with case-sensitive, whole-word, and regular-expression modes.
- Group matches by file, show line numbers, and open a result directly in the editor.
- Replace one match, every match in a file, or all displayed repository matches; replacements are conflict-checked and undoable as one Files operation.
- Skip Git-ignored files by default and search them only while the ignored-files toggle is on; results from them stay identified separately and folded.
- Keep broad queries responsive: tracked files are listed first, very large result sets are cut short and marked as truncated instead of failing, and "replace all" stays disabled while a result is truncated.

### History

- Browse commit history incrementally instead of loading the entire repository at once; refreshes preserve loaded pages without duplicating commits.
- Follow current-branch history through a compact Git graph: theme amber for local commits, OpenTig blue for published work and merge branches, and neutral gray for primary-line commits reachable from the locally known base branch. Lane positions and merge nodes preserve topology; the palette follows the light or dark theme. The base uses the upstream remote's symbolic default when available, then conventional main/master refs; missing information stays unknown. No background fetch is needed, and unmerged branches outside HEAD are not added to this view.
- Switch between compact (42 px) and comfortable (56 px) rows without changing the sidebar width or right-hand diff viewer. Selecting a commit or its expanded files keeps the row highlighted.
- Search subjects, authors, hashes, and references in loaded history. Matches are highlighted without removing graph rows; Enter or the next-match button scrolls to each result. Load more to search older commits.
- Group complete, exclusive, linear side branches under their merge commit. Partial pages, shared branches, and nested side merges stay expanded in the graph. The grouped count reveals the commits again; search temporarily reveals all grouped commits.
- Recognize GitHub-style merge messages and trailing `(#123)` references. These are message hints, not verified PR status or proof of squash/rebase. On GitHub repositories, the reference opens the existing PR viewer on the right; an issue number or unavailable PR is handled by that viewer. Squash/rebase histories remain linear because the graph always follows actual parents.
- Inspect commit subjects, full descriptions, authors, dates, refs, publication state, and changed files. Expanded history rows show the complete description; long descriptions in the commit viewer can be revealed without hiding the diff.
- Copy full commit hashes.
- Open complete commit diffs or the diff for one file, including renamed paths.
- Undo only the latest commit when OpenTig can prove it is still local and safe to undo.

### Branches and worktrees

- Search and switch between local and remote branches; selecting a remote branch creates or uses its local tracking branch. If local changes would be overwritten, OpenTig offers to move all tracked and untracked changes to the destination branch and leaves them unstaged. Conflicts open in the Changes view and retain a safety stash for recovery.
- Prevent switching to a branch already checked out in another worktree.
- **Manage branches** offers All, Local and Remote filters, grouping and filtering by configured remote, and branch search. Remote references reflect the last fetch; **Fetch** updates branches from all configured remotes and prunes obsolete remote references without removing local branches, worktrees or tags.
- Inspect local branch tips, upstreams, ahead/behind state, unique commits, and owning worktrees. Remote details show the fetched tip, local tracking branches, and associated GitHub PRs for `origin`, including merged status.
- Branch and worktree rows use the details panel instead of hover tooltips. References whose branches were already deleted on the server are marked as cached and offer **Fetch and clean up**; they do not offer creation or remote deletion.
- Create a local tracking branch from the remote’s Local branches details at a fetched tip with an editable name, without switching the current checkout or touching uncommitted changes.
- Delete an individual remote branch with a separate confirmation naming the remote and branch. OpenTig rechecks the remote tip and destination, uses an expected-commit lease, and refuses deletion of the remote’s default branch. Unknown default branches, ambiguous fetch mappings, and differing or multiple fetch/push destinations also block deletion. Git permissions and server branch protection still apply. Local branches and worktrees are retained; there is no bulk remote deletion.
- Delete local branches only through Git's non-forced, fully merged path.
- Inspect worktree path, branch, HEAD, lock/prunable state, and local changes. Worktree selection and removal recognize filesystem aliases, including Windows short paths, while preserving case-sensitive path distinctions on Linux.
- Open or remove eligible linked worktrees. Removing a worktree never deletes its branch, and the main worktree cannot be removed.

### GitHub pull requests

GitHub features use the authenticated GitHub CLI (`gh`):

- List open pull requests for the current GitHub repository.
- Navigate native GitHub stacks through a layer indicator (for example, **2/3**) in each PR row and the right-hand viewer. The menu lists layers with their state, title, branch, and base, including layers outside the current list filter. Details load only when opened; refresh failures keep previously loaded layers with a notice and retry. Branch relationships are not inferred, and stack navigation does not merge or rebase branches.
- Inspect pull-request metadata, Markdown description, and full diff.
- Switch the pull-request **Code** view between all cumulative changes and the diff introduced by an individual commit.
- The **By commit** diff selector uses the app’s styled, keyboard-accessible menu, with readable commit subjects and scrollable options that fit the viewport.
- Open a pull request in the browser.
- Create a pull request or draft pull request from a wider, viewport-fitted dialog that keeps the draft toggle beside the base branch, the editor visible without an outer card scrollbar, and AI generation in the footer with its provider and model.
- Edit and preview the GitHub Markdown description before publishing.
- Require the current branch to be published and up to date before PR creation.
- **Settings → GitHub** shows the last checked CLI installation/version, accounts saved for `github.com`, their authentication/storage state, and the global active account separately from the current repository identity. Opening Settings reads cached metadata without running `gh` or contacting GitHub. **Check access** refreshes the inventory and verifies the repository account; use it after external login, logout or account changes. Failed checks keep the previous inventory marked unverified. GitHub operations validate credentials as needed, with successful identity and SSH checks reused for up to one minute; manual refresh bypasses those checks' caches.
- The repository access card groups the account picker, **External** / **OpenTig** Git authentication choices, access checks and push destination. Connection details and saved CLI accounts expand on demand; the effective author of the next Git commit has a separate card. **Edit authorship** reads the current Git identity, accepts a name and commit email, and requires a before/after review before atomically updating repository-local `user.name` and `user.email`. Future commits from OpenTig and other Git tools use those settings; existing history, global Git settings, remotes, credentials, SSH and signing settings are preserved. The local identity is shared across worktrees. Environment overrides, custom `author.*`/`committer.*`, worktree-specific identities, command configuration and linked config files are shown and must be managed outside this editor. Stale reviews and existing Git config locks prevent saving. GitHub account selection never changes authorship automatically; reusable account profiles and automatic linking are outside this initial editor.
- Choose an explicit saved account for all PR lists, branch links, details, diffs, native stacks and creation. The choice persists by the Git common directory and is shared across worktrees, including after restart. Moving a registered repository carries the choice; forgetting it removes the choice. Selection changes clear the affected repository’s GitHub results in connected clients without refreshing Git data. Independent clones can choose different accounts.
- Existing unpinned configurations remain available until an account is chosen. Legacy Automatic SSH uses a noninteractive handshake with an already trusted `github.com` host to identify the actual user, then obtains that user's saved `gh` token. Repository owners, organisation names and SSH alias names never determine the login. Missing saved accounts, deploy keys, failed handshakes and custom SSH commands require an explicit choice or corrected authentication; there is no fallback to another user. HTTPS Automatic uses the active `gh` credentials and honours `GH_TOKEN`/`GITHUB_TOKEN` on the backend. Explicit and verified SSH selections use their own stored credentials instead of those environment overrides. This initial scope supports `github.com`, not GitHub Enterprise hosts.
- The PR list and creation dialog show the effective account. Creation stops if the selected account or verified identity changed since review. Git commits still use Git's independent author configuration. Selecting **OpenTig** under **Git authentication** explicitly enables per-operation credentials from the pinned account for GitHub HTTPS reads and writes, without altering global helpers, remotes, SSH keys or the active CLI account. Existing repositories remain external until opt-in; **External** reverses the choice. Other providers and SSH remain external. The publication context resolves push remotes and rewritten push URLs separately from the PR destination; multiple URLs and unsupported push configurations require review. A changed account, branch, tip or destination invalidates prepared publication. Settings separates account identity, PR API access, reading the push destination and API-declared write permission; branch rules may still reject a push. Sanitized Git errors retain the actual rejection and never trigger a force push. Managed operations do not fetch or push submodules recursively; open each submodule as a repository or use external authentication. The temporary helper requires curl, uses a private loopback broker with host/path restrictions, and disables redirects. GitHub tokens are neither written to files nor passed in Git arguments or environments; cleanup also runs on failures and cancellation. This is not a sandbox against hostile same-user processes. GitHub errors distinguish missing accounts, rejected credentials, repository/token/organisation permissions, and unavailable CLI installations.
- **Add account** guides you through the [official GitHub CLI login](https://cli.github.com/manual/gh_auth_login) in a terminal on the backend host: `gh auth login --hostname github.com --web --skip-ssh-key`. Keep the existing Git protocol and decline Git credential setup. Existing accounts are retained, but `gh` makes the added account globally active; the dialog explains this and can copy a voluntary command to restore the previously checked global account. Return to **Check accounts** after login. OpenTig only copies instructions and never executes login, logout, refresh or account switching. The CLI must support multi-account `auth token --user` and `auth status --json hosts`; an unsupported JSON check asks you to update it.
- Optionally generate an editable title and description from the branch diff with the selected local AI CLI. PR generation uses the same generous, fairly distributed diff budget as commit generation so large branches keep coverage across all changed files.

### Optional AI assistance

OpenTig supports locally installed Codex, Claude Code, and OpenCode CLIs. Only OpenCode 2.x is supported. OpenTig checks the installed version of `opencode` and the alternate `opencode2` binary, preferring a compatible v2 installation. OpenCode 1 and legacy beta builds are shown as incompatible and cannot generate content. Models retain provider/model identifiers and optional `#variant` suffixes. It can:

- generate an editable commit message from staged changes;
- propose multiple focused commits, including their messages, reasons, and complete-file groups, when a split is clearly beneficial;
- generate an editable pull-request title and description from the current branch diff;
- detect installed providers, authentication state, and available models;
- identify Codex, Claude Code, OpenCode, and Grok Build with their provider marks in AI settings and show the selected provider and model together in the commit composer;
- keep large commit and pull-request analyses running for up to ten minutes without a generic transport timeout discarding a valid result;
- normalize harmless trailing periods in generated commit subjects instead of discarding an otherwise valid result;
- cancel an in-progress generation request, including when its client disconnects or its bounded execution window expires.

The official Grok Build (`grok`) CLI also supports these workflows. It requires version 1.0.46 or later in the 1.x series and the headless JSON and tool-control flags. Authenticate with `grok login`, or supply `XAI_API_KEY` to the host process. Its built-in model catalog is discovered dynamically; custom CLI models and configuration are not loaded. OpenTig keeps its own model selection without changing the CLI default.

AI never creates a commit or pull request automatically. You review and edit the generated text before any Git or GitHub action occurs.

### Preferences

- Organize **Settings → General** into compact Appearance, Files & viewer, and Repository sync groups, with controls beside their labels on desktop and stacked on phones. Font menus show their own typefaces; an optional text preview reflects the active interface and code fonts. Changes apply immediately.
- Move smoothly between Settings sections with a short reduced-motion-aware transition while the navigation and dialog controls stay fixed.
- System, light, and dark themes.
- Interface and code fonts from **Settings → General**, each with its own dropdown. Interface: Geist, Plus Jakarta Sans, or Space Grotesk. Code: Geist Mono, JetBrains Mono, Inconsolata, Departure Mono, or Space Grotesk. Defaults are Plus Jakarta Sans for the interface and JetBrains Mono for code. Saved font selections are preserved.
- Adjustable interface scale.
- Tree or list layout for changes.
- Optional line wrapping in viewers.
- Optional display of Git-ignored files.
- Per-provider AI model selection.
- Rebind most keyboard shortcuts from **Settings → Shortcuts**, with per-shortcut conflict detection and one-click reset to defaults; the shortcuts marked fixed below follow platform or file-manager conventions and cannot be changed.
- Turn off the double-tap-Control shortcut that brings OpenTig to the front from any application, also from **Settings → Shortcuts**.
- Phone browsers use a single workspace pane with bottom Changes, Files, History, PRs, and Search navigation and a compact repository header. Repository context opens branch, worktree, sync, and Settings controls; an open-files sheet replaces the desktop tab strip. Open a row to review its content, use Back to return to the list, and open Commit to write a message without covering staging controls. Files browse one folder at a time with breadcrumbs, a folder filter, visible action menus, selection mode, creation controls, and **Move to…** destination selection. Touch and pen gestures scroll instead of dragging; mouse drag and drop remain available on desktop. History uses larger mobile rows, short landscape phones keep the single pane, and bottom navigation hides for the software keyboard; repository, branch, worktree, settings, and diagnostics controls remain available on touch screens. Dialogs and forms fit the keyboard and safe areas, and AI history details open with a tap. Browser repository opening uses a visual server folder picker. Phone diffs start unified with a session-only layout choice, preserving the saved desktop layout.
- Confirmations and secondary windows opened from Settings (revoking a browser, enabling LAN access, renaming a device, or viewing AI history) overlay the app at their own size, instead of inheriting the Settings window's width.
- Persisted sidebar width, viewer preferences, shortcut customizations, recent repositories, projects, expanded file-tree paths, and each worktree's open file tabs.

## Keyboard shortcuts

The shortcuts below are defaults; rebind most of them from **Settings → Shortcuts**. Shortcuts marked *fixed* follow platform or file-manager conventions and always stay as shown.

| Shortcut | Action |
| --- | --- |
| `Ctrl` `Ctrl` (double-tap, fixed) | Bring OpenTig to the front from any application |
| `Ctrl+O` | Open a repository |
| `Ctrl+P` | Quick-open a file |
| `Ctrl+R` | Refresh repository state |
| `Ctrl+1` … `Ctrl+5` (fixed) | Open Changes, Files, History, PRs, or Search |
| `Ctrl+S` | Save the open editable file |
| `Ctrl+W` | Close the active file tab |
| `Ctrl+Tab`, `Ctrl+Shift+Tab` | Move to the next or previous file tab |
| `Ctrl+Shift+PageUp`, `Ctrl+Shift+PageDown` | Move the active file tab left or right |
| `Enter`, `Delete` (fixed) | Activate or close the focused file tab |
| `Ctrl+F` | Open the integrated panel with both Find and Replace fields in the open editable file |
| `Ctrl+Alt+F` (fixed) | Alternative shortcut that always opens Find and Replace, alongside the rebindable one above |
| `Ctrl+Enter` | Create a commit while the commit composer is focused |
| `Ctrl+Shift+Enter` | Create a commit and push when available |
| `Ctrl+C`, `Ctrl+X`, `Ctrl+V` (fixed) | Copy, cut, or paste selected Files entries |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo or redo a supported Files operation |
| `F2` (fixed) | Rename the selected Files entry |
| `Delete` (fixed) | Delete selected Files entries |
| `Q`, then a number | Open the repository switcher, then the repository at that saved position |
| `+`, `-`, `0`, `F` (fixed) | Zoom in, zoom out, reset, or fit an image preview |
