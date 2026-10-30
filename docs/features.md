# Feature guide

[← Documentation](README.md) · [Project overview](../README.md)

Use OpenTig to review changes, edit files, and prepare commits in an existing Git repository. OpenTig is early-stage software; this guide covers the current interface and its limits.

## Main workflow

1. Open an existing local Git repository with `Ctrl+O`, choose a recent repository, or clone one from a URL.
2. In **Changes**, review unstaged, staged, and conflicted files.
3. Open a diff, stage the files you want to include, and write or generate an editable commit message.
4. Commit locally, or commit and push, then inspect the result in **History**.
5. If the repository uses GitHub, open **PRs** to review or create a pull request.

## Features

- **Organize your work:** [repositories and projects](#repositories-and-projects), [branches and worktrees](#branches-and-worktrees).
- **Prepare and share changes:** [diffs and commits](#changes-diffs-and-commits), [pull and push](#safe-pull-and-push), [GitHub pull requests](#github-pull-requests).
- **Explore the repository:** [files and editing](#files-and-editing), [search](#quick-open-and-repository-search), [history](#history).
- **Set up your workflow:** [AI assistance](#optional-ai-assistance), [preferences](#preferences), [keyboard shortcuts](#keyboard-shortcuts).

### Repositories and projects

OpenTig opens repositories on the machine running its backend. The Windows app runs that backend itself; a paired browser selects folders on its host. See [installation](getting-started.md) and [remote access and pairing](web-access.md) for setup.

**First launch and cloning**

The start screen offers **Open a folder**, **Clone from URL**, and **Find on this computer** (or **on the server**), with Git, GitHub CLI, and AI assistant status on one line. Only a missing Git blocks; it is replaced by install commands for the detected system and **Check again**. See [first launch](getting-started.md#first-launch).

**Clone from URL** is also available from the Open dialog. It accepts HTTPS, HTTP, or SSH URLs, including SCP-style addresses, shows the detected host, and suggests the folder name and the parent folder last used. Private repositories at a plain `https://github.com/owner/repository` URL authenticate with the default GitHub account; if it can't read the repository, another connected account that can is used and kept as the new repository's account. Other URLs, and setups without a default account, use the host's existing Git credentials; embedded credentials and local or custom transports are rejected, and the destination must not exist. The clone runs on the server: closing the dialog, reloading, or losing the connection keeps it going, and a notification offers to open it when it finishes. Cancelling keeps the form; partial files are never deleted. Submodules are not initialized.

**Find** lists repositories in the home folder and common checkout folders such as `~/code` and `~/projects`, one level deep, skipping those already added.

**Open a repository**

Press `Ctrl+O`, browse to an existing repository, select it, and open it. The dialog includes recent checkouts, location shortcuts, breadcrumbs, a folder filter, hidden-folder controls, and an editable path. Desktop also offers a native folder picker.

| In the repository dialog | Action |
| --- | --- |
| `Ctrl+L` | Edit the path |
| Arrow keys | Select a folder |
| Right arrow | Browse into a folder |
| `Enter` | Open the selected repository |

Added repositories stay available until you remove them. Opening one preserves its position; new repositories append to their group, keeping numbered shortcuts stable. Switch between repositories, branches, and available worktrees from the selector. The toolbar shows the current branch, ahead/behind counts, and worktree insertion/deletion totals.

**Switching repositories** shows the chosen repository in the selector with a spinner straight away. If opening takes more than a moment, a thin progress line appears under the toolbar and the previous repository dims until the new one replaces it. **Changes** shows **Loading changes…** rather than an empty list until the new repository's status arrives, and a notice appears if opening takes more than five seconds. Choosing several repositories in quick succession opens the last choice. Errors keep the current repository and report the problem.

**Organize, relocate, or remove repositories**

In **Manage projects**, create, rename, delete, or reassign project groups without moving files on disk. Reorder projects and repositories within each group, including **No project**. Desktop offers drag handles, keyboard dragging, and up/down buttons; mobile uses larger up/down buttons. Repository numbers match the selector.

- **Relocate repository:** select an existing folder to update its saved path, even before opening fails. Desktop uses a native picker; browsers use the server folder picker. Project assignment, tabs, and expanded folders are preserved; files are not moved.
- **Remove from OpenTig:** confirm to forget the repository, its worktrees, recent entries, and project assignment. Folders and Git data stay on disk and can be opened again. Removing the active repository returns you to the welcome screen.

**Save or close unsaved editor tabs before relocating or removing a repository.**

**Sync from the repository picker**

Pull or push from an individual repository's row. Opening the picker fetches each listed repository to refresh its checkout and ahead/behind counts. Only pending operations appear, with their commit counts; multiple repositories can sync concurrently with separate progress and result notifications.

Choose periodic remote checks, or turn them off, in **Settings → General**. Manual Refresh still fetches when periodic checks are off. See [remote checks and refresh](interface.md#remote-checks-and-refresh).

<details>
<summary>Repository labels, icons, and mobile behavior</summary>

The folder dialog shows branches for repositories and linked worktrees, including unborn branches and detached HEAD. Pending or failed navigation clears the previous selection. Mobile keeps the current folder and confirmation visible; the welcome screen scrolls when repositories exceed the available height.

Picker rows show the repository name and the branch used for pull/push. Linked worktrees also show their checkout folder; a styled hover tooltip shows the filesystem path. A repository favicon or app icon appears in the toolbar picker and welcome screen when available, with a folder fallback. Supported sources include `favicon.svg`/`favicon.ico` at the root or under `public/`, `app/`, and similar locations, or a `<link rel="icon">` in `index.html`.

The repository dropdown can use up to 80% of the viewport height while keeping search and management visible; other dropdowns stay compact. Mobile reordering preserves scroll and focus and briefly highlights the moved row. Reduced-motion preferences disable that highlight.

</details>

<details>
<summary>Connected clients, refreshes, and backend recovery</summary>

Desktop and paired browsers share an authenticated WebSocket backend. Repository switches and filesystem/Git events propagate to every connected tab. Reconnecting clients load fresh state without replaying interrupted mutations.

On desktop, a supervised utility process keeps repository watchers and in-flight server state alive through a renderer reload or crash while the desktop process remains open. Unexpected backend exits restart with bounded backoff. Native folder selection and Explorer reveal are desktop-only; browser headers use the full width without reserving desktop window-control space.

The workspace shell loads first. Settings, History, PR creation, Files, Search, and the PRs list load when first opened. Overlapping watcher and manual refreshes are combined; status-only or reference-only updates keep the current diff mounted.

[Development profiles](development.md) separate Dev application data from production. Repositories and authenticated host CLIs remain real resources in either profile.

</details>

### Changes, diffs, and commits

**Review and stage changes**

1. Open **Changes** to see conflicted, staged, and unstaged files separately, as a flat list or recursive tree.
2. Open a diff in unified or split mode, with optional line wrapping.
3. Stage or unstage individual files, folders, a selection, or everything at once.

Changed Markdown files open their staged or unstaged diff; use **Open file** for the rendered preview. HTML, SVG, and image files open a rich preview and have a separate diff action.

To discard selected unstaged changes, review the affected paths in the confirmation dialog. Untracked files go to system Trash (the Recycle Bin on Windows).

**Resolve conflicts**

Use the built-in conflict editor to accept the current, incoming, or both sides, then mark resolved files for staging. Syntax highlighting matches the diff and Files editor. Accepted changes remain visible while background refreshes reconcile the saved file.

**Create or undo a commit**

Commit the staged files with an editable message. When an upstream exists, you can commit and push in one action. For a branch without an upstream, see [publishing a branch](#safe-pull-and-push).

You can undo the latest unpublished commit and keep its changes staged. OpenTig checks the expected commit and upstream state before rewriting history.

**Split independent changes into commits**

With a [supported AI CLI](ai-assistance.md), request a multi-commit plan for staged files that represent separate responsibilities. Review the plan, then prepare one complete-file group at a time. Applying a group does not create a commit automatically.

Groups retain their original numbers as you commit them and show progress. Open any listed file's diff before applying its group. Each group is rechecked against its files, so it cannot be applied after those files change. Partially staged or renamed files can prevent splitting; OpenTig explains why a plan cannot be offered.

Settings includes AI run metadata and failed-operation diagnostics, and lets you clear either history. These histories do not store prompts or file contents. See [usage history and problems](ai-assistance.md#usage-history-and-problems) and [AI privacy](security-and-privacy.md#ai-privacy).

<details>
<summary>Diff colors, file headers, and change-list controls</summary>

Diffs use the same One Light/One Dark Pro token palette as the Files editor and Markdown code blocks. Added, deleted, and modified lines retain their diff colors. Language grammars load for the file being viewed rather than at startup.

File headers show the full filename with its folder path underneath. Sticky headers remain opaque on hover so scrolled code does not show through. Dialogs, including Settings and confirmations, stay above diff content and sticky headers.

Change and folder rows stay aligned as files load, sections empty or refill, conflicts appear, and folders expand or collapse on desktop and phones. Each highlighted row is one continuous click target with a pointer cursor; dedicated diff, open, stage, unstage, and discard controls remain available.

</details>

<details>
<summary>Large diffs and highlighting limits</summary>

Large diffs show **Preparing diff…** while a background worker parses their file models. Switching or closing the diff cancels that work; only complete results for the current revision appear. Background patch refreshes preserve collapsed files and the mounted scroll container while hiding the previous revision.

Without workers, parsing yields between indexing batches and files, but a single large file can still pause the interface. Each mounted diff has a small byte-budgeted parse cache. Oversized entries still display; closing or changing the document releases the cache.

The highlighting pool is bypassed above 10,000 diff lines or 500,000 conflict characters. Tokenization is also limited on very long lines.

</details>

### Safe pull and push

**Pull requires an upstream.** Pull and push refuse unsafe states such as unresolved conflicts or an active Git operation. OpenTig never force-pushes existing remote history.

| When you pull | What OpenTig does |
| --- | --- |
| The branch has no local commits | Fast-forwards to the remote |
| Local and remote histories have diverged, without conflicts | Rebases local commits onto the updated remote, ready to push; no implicit merge commit |
| The rebase would conflict | Aborts it and leaves the branch unchanged |
| You have local changes, including untracked files | Preserves them in a temporary safety stash |
| Local changes cannot be restored cleanly | Keeps and reports the recovery stash |

**Publish a branch without an upstream**

Publish from the toolbar, History, repository selector, **Commit & Push**, or pull-request dialog. A checked-out branch with at least one commit and a configured remote is required; you can publish even when there are no new commits.

OpenTig uses the configured push remote or the only available remote. If several exist without a preference, choose one. Publishing sets upstream tracking and leaves uncommitted files untouched.

**Read progress and errors**

Each pull or push has its own progress and result notification. Remote rejections, branch protection, authentication, configuration errors, pending conflicts, and other one-shot failures appear there. **Changes** remains the place to inspect unresolved work.

<details>
<summary>Notification behavior</summary>

Operation notifications use Sileo toasts rather than a persistent top banner. Conflict notices are deduplicated per repository across refreshes and dismissed when conflicts are resolved, without closing an in-progress pull. Read-only Git operations still use an in-app banner.

App-authored notification text uses sentence case, preserving product names, acronyms, and user-provided text.

</details>

### Files and editing

**Open and keep files in tabs**

Browse the **Files** tree, then click a file to preview it. The next preview replaces that tab. To keep a file open, edit it, double-click it, or `Ctrl`-click it.

| Action | Result |
| --- | --- |
| Open from the Files context menu | Open a replaceable preview |
| **Open to the Side** or `Ctrl`-click | Pin the file beside the current one |
| Drag a file from the tree onto the header tab strip | Pin it at the drop position |
| Drag a tab | Reorder it |
| Middle-click a tab | Close it |

Only working-tree files become tabs. Diffs, conflicts, commits, and pull requests remain transient. Each worktree keeps up to 50 tabs; opening another closes the least recently used clean tab.

**Edit and save**

Open text files in the syntax-aware editor. When the file has unsaved changes, a labeled **Save** button with its shortcut appears at the top right. Saving checks for external changes and keeps the saved text, caret, undo history, and scroll position; you can keep typing while it saves. A tab without unsaved edits shows changes made to the file outside OpenTig. Press `Ctrl+F` for the integrated find-and-replace panel, including single or global replacement, case, whole-word, regular-expression, and undo support.

Unsaved edits stay in memory while the app runs. Closing a modified tab offers **Save**, **Discard**, or **Cancel**. Open tab paths, order, and the active file are restored per worktree between sessions; **unsaved text is never written to disk automatically**.

If a file moves or is renamed, its tab follows the new path. If it disappears, a dirty tab stays open and is marked unavailable so you can recover the text; a clean tab closes.

**Preview documents and images**

Markdown, HTML, SVG, image, and PDF viewers share a fixed header above the document, level with the sidebar tabs, so their controls never cover it. **Preview**/**Code**, or PDF page navigation, and the viewer's own controls, such as Markdown content width, image sizing, and zoom, are centered; **Save** appears at the right end while there are unsaved edits. Controls that do not apply to the current view are hidden, and image details are hidden when the pane is narrow.

- **Markdown, HTML, and SVG:** switch between **Preview** and **Code** with mouse or keyboard. **Code** shows a dot while the file has unsaved edits. HTML runs its own scripts in a sandbox that cannot access OpenTig.
- **HTML:** `.html`, `.htm`, and `.xhtml` open in **Preview** by default. OpenTig does not inject styles into the document: its colors, background, color scheme, and scrollbars remain independent of the app theme, with viewer controls above the page. Repository-relative stylesheets, scripts, images, and CSS fonts are embedded in the isolated preview, including CSS imports and `url(...)` resources. Local resources are limited to 8 MB total and 128 references; files outside the worktree are excluded. Relative document links open the destination in Files, including other HTML pages and PDFs; leading `/` means the repository root. HTML fragments such as `requirements.html#section` scroll to that section after loading, and `#section` links stay within the current page. External web and mail links open outside the preview. Query strings do not change the file being opened. This previews static documents, not a development server: local JavaScript module imports, `fetch` calls, script-driven page navigation, and repository-relative responsive `srcset` assets are not resolved. External resources still require network access.
- **PDF:** open `.pdf` files directly in a read-only PDF.js viewer at 100%, which shows the whole page in the pane; zoom percentages are relative to that view. All pages scroll continuously; the page field follows the scroll position and jumps to a typed page. Text is selectable, and zoom keeps your place; select the percentage to return to 100% or **Fit width** to fill the pane. Pages render as they approach the viewport and release their memory once far away. Processing stays in the app, with locally bundled fonts and decoders. Preview is limited to 32 MB; password-protected documents, forms, annotations, and PDF scripts are not supported.
- **Markdown:** render GitHub-flavoured Markdown, syntax-highlighted code with copy buttons, alerts, footnotes, KaTeX formulas, Mermaid diagrams, and repository-relative images, including PNG and SVG.
- **Raster images:** use fit, 1:1, keyboard or wheel zoom, and view dimensions and file size.

Preview/Code switches restore roughly the same scroll position in the destination tab. That position is held while diagrams, formulas, and highlighting finish loading, until you scroll yourself.

<details>
<summary>Links in Markdown previews</summary>

External links (`http(s)://` and protocol-relative URLs) open in the system browser; `mailto:` opens the mail client. Relative repository links open the file in a new tab, and `#anchor` links scroll within the preview.

Hovering a link shows a styled tooltip with its destination, truncated when long, and the action: open in browser, open in mail app, or open file.

</details>

**Manage files and folders**

Select one or more entries to copy, cut, paste, rename, create, or delete. Dragging moves selected entries to a folder or repository root, with a lifted preview, count badge, and destination feedback. Copy paths or contents, and reveal entries in Windows File Explorer on desktop. Turn on ignored-file visibility to include Git-ignored files.

Desktop Paste imports file paths copied in a native file manager or saves a clipboard image as PNG, only when you press `Ctrl+V` or choose **Paste**. Runtimes without native file-clipboard support hide that action.

Deletion requires confirmation listing the affected paths. Supported file operations can be undone and redone. Large or directory deletions fall back to system Trash when an in-app snapshot is impractical; a backend inside WSL uses Linux Trash.

<details>
<summary>File-operation safeguards and Trash dependency</summary>

Copy and move reject placing a folder inside itself, including through filesystem aliases or Windows short paths. File removal uses literal paths with system Trash.

The Trash dependency is temporarily pinned to 9.0.0 pending a patched transitive dependency. See [third-party notices](../THIRD_PARTY_NOTICES.md#trash).

</details>

<details>
<summary>Tree, tab, and editor behavior</summary>

The virtualised file tree remembers expanded folders. While a file is open, ancestor folders stick to the top as opaque overlays, including on hover. Clicking one scrolls it into view without selecting or collapsing it.

Tabs use a compact header strip, a lifted drag preview, and animated placement. Files with the same name show their parent folder; styled tooltips expose the full path and tab state. An unsaved dot marks dirty tabs, so the floating Save button needs no redundant label.

Only the active file keeps an editor loaded. Large files use virtualised rendering. Appending repeated blank lines to ordinary files preserves focus without flashing a render error.

Code, diffs, and conflicts share language detection for nested Dockerfiles and Makefiles, uppercase extensions, XML project files, JSON with comments, environment files, Git configuration, and installer scripts. The editor uses the One Light/One Dark Pro palette also used by Markdown code blocks. Markdown highlighting, KaTeX, and Mermaid load only when a preview needs them, not when opening a source file.

</details>

### Quick open and repository search

**Find a file by path**

Press `Ctrl+P`, type part of a path, use the arrow keys to navigate the accessible result list, and press `Enter` to open the highlighted file.

**Find or replace text across the repository**

1. Open **Search** and enter a query. Enable case-sensitive, whole-word, or regular-expression matching as needed.
2. Review matches grouped by file with line numbers. Open a result to jump into the editor.
3. Replace one match, all matches in a file, or all displayed matches. Replacements check for conflicts and can be undone as one Files operation.

Git-ignored files are excluded unless the ignored-files toggle is on. Their results remain separately identified and folded. Broad searches list tracked files first; very large result sets are marked **truncated**, and **Replace all** stays disabled until results are complete.

<details>
<summary>Quick Open in large repositories</summary>

Search data is prepared when Quick Open opens and reused until the file list changes. Initial preparation can briefly pause very large repositories. While results are calculated, large repositories show **Searching files…**. Only results for the current query can be selected.

</details>

### History

**Inspect a commit**

Open **History** and click a commit subject for its full message, author, date, references, publication state, and changed files. Open the complete diff or one file's diff, including renamed paths, and copy the full hash when needed. Merge and empty commits also open with complete metadata.

History loads incrementally. Search subjects, authors, hashes, and references in the **loaded history**; load more to search older commits. Matches are highlighted without removing graph rows. Press `Enter` or use the next-match button to jump between them.

Only the latest commit can be undone, and only when OpenTig can prove it is still local and safe to undo.

**Read the graph**

The graph follows current-branch history and actual parent relationships. It does not fetch in the background or include unmerged branches outside HEAD. Colors adapt to the theme:

| Color | Meaning |
| --- | --- |
| Amber | Local commits |
| OpenTig blue | Published work and merge branches |
| Neutral gray | Primary-line commits reachable from the locally known base branch |

GitHub-style merge messages and trailing `(#123)` references are hints, not verified PR status or proof of squash/rebase. On GitHub repositories, the reference opens the PR viewer on the right; that viewer handles issue numbers or unavailable PRs. Squash/rebase histories remain linear.

<details>
<summary>Merge grouping and comparisons</summary>

Complete, exclusive, linear side branches can be grouped under their merge commit. Click the grouped count to reveal them; search temporarily reveals all grouped commits. Partial pages, shared branches, and nested side merges stay expanded.

Merge commits list only their own file changes relative to every parent. The viewer shows these as a unified diff against the first parent and labels the comparison. Commits without file changes still show metadata and the full message, followed by an empty-diff message.

Graph lanes and merge nodes preserve topology. The base comes from the upstream remote's symbolic default when available, then conventional main/master refs. Missing information stays unknown.

</details>

<details>
<summary>History layout, caching, and message links</summary>

Choose compact (42 px) or comfortable (56 px) rows without changing the sidebar width or diff viewer. Selecting a commit or its expanded files keeps the row highlighted. Expanded rows show a three-line description preview with an ellipsis when needed; click the subject for the full message, with no subject hover tooltip. Row spacing is preserved when search or merge grouping changes.

Refreshes retain loaded pages without duplicating commits. Expanded file lists use a memory-bounded cache. Very large lists remain fully available in the open row, but are fetched again after leaving and revisiting it once the row unmounts. Switching repositories clears the cache.

Web links in commit subjects, messages, expanded descriptions, and the PR commit timeline show their destination and **Open in new tab** on hover or keyboard focus. They open a browser tab, or the system browser on desktop; email links open the mail client. Other commit-message text keeps its plain-text formatting.

</details>

### Branches and worktrees

**Switch branches**

Search local and remote branches, then select one. Selecting a remote branch creates or uses its local tracking branch. You cannot switch to a branch already checked out in another worktree.

If switching would overwrite local changes, OpenTig offers to move all tracked and untracked changes to the destination and leave them unstaged. Conflicts open in **Changes**, with a safety stash kept for recovery.

**Inspect and refresh branches**

Open **Manage branches** to search, choose **All**, **Local**, or **Remote**, and group or filter by configured remote. Select a branch or worktree for details rather than a hover tooltip.

Remote references reflect the last fetch. **Fetch** updates all configured remotes and prunes obsolete remote references without removing local branches, worktrees, or tags. Already-deleted server branches are marked as cached and offer **Fetch and clean up**, not creation or remote deletion.

| Selection | Details available |
| --- | --- |
| Local branch | Tip, upstream, ahead/behind state, unique commits, owning worktrees |
| Remote branch | Fetched tip, local tracking branches, associated GitHub PRs for `origin`, including merged status |
| Worktree | Path, branch, HEAD, lock/prunable state, local changes |

From a remote's **Local branches** details, create a tracking branch at the fetched tip with an editable name. This does not switch the current checkout or touch uncommitted changes.

**Delete branches or remove worktrees**

- **Local branch:** deletion uses Git's non-forced, fully merged path. When Git can't confirm the merge, such as after a squash or rebase merge, force deletion remains available and the branch's GitHub PR is shown as evidence: a merged PR whose head is exactly the branch tip means every commit reached GitHub, while a different tip warns that the branch may have commits that were never merged.
- **Remote branch:** confirm the named remote and branch individually. OpenTig rechecks the remote tip and destination with an expected-commit lease. Default branches cannot be deleted; unknown defaults, ambiguous fetch mappings, or differing/multiple fetch/push destinations also block deletion. Git permissions and server branch protection still apply. Local branches and worktrees remain; bulk remote deletion is unavailable.
- **Linked worktree:** open or remove an eligible worktree. Removing it does not delete its branch. The main worktree cannot be removed.

Worktree selection and removal recognize filesystem aliases, including Windows short paths, while preserving Linux case-sensitive path distinctions.

### GitHub pull requests

With an authenticated GitHub CLI, use **PRs** to review metadata, descriptions, cumulative or per-commit diffs, individual checks, comments and reviews, and native stacks. An open PR shows its current status and refreshes while you view it, and you can merge it, update its branch, use auto-merge and merge queues, comment and review, edit or close it, or revert it once merged, from the viewer. Open PRs in OpenTig or GitHub, or create an editable draft before publishing. The same section lists releases, where you can create, edit, and delete drafts for existing tags.

Repository accounts, the default account, and commit authorship are separate controls. See [GitHub accounts and pull requests](github.md) for setup, scopes, access checks, direct push behavior across clients, and credential boundaries.

### Optional AI assistance

Locally installed Codex, Claude Code, OpenCode 2, or Grok Build can draft commit messages, propose complete-file commit groups, and write PR descriptions. **You review and confirm every commit or PR.**

See [AI assistance](ai-assistance.md) for supported versions, CLI detection, model selection, coverage reports, optional repository instructions, and usage history. [AI privacy](security-and-privacy.md#ai-privacy) explains provider isolation and supplied context.

### Preferences

Open **Settings** to choose themes, fonts, interface scale, change-list layout, viewer wrapping, ignored-file visibility, remote-check intervals, and shortcuts.

OpenTig remembers viewer and workspace preferences, project ordering, expanded folders, and worktree tabs. See [interface, preferences, and mobile use](interface.md) for controls, phone navigation, and saved state.

## Keyboard shortcuts

These are the defaults. Rebind most shortcuts in **Settings → Shortcuts**. Shortcuts marked *fixed* follow platform or file-manager conventions and cannot be changed. In a paired browser, combinations the browser keeps for itself, such as `Ctrl+W` and `Ctrl+Tab`, do not reach OpenTig; see [shortcuts in a browser](interface.md#shortcuts).

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
