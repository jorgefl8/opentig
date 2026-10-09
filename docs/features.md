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

[Repositories](#repositories-and-projects) · [Changes](#changes-diffs-and-commits) · [Sync](#safe-pull-and-push) · [Files](#files-and-editing) · [Search](#quick-open-and-repository-search) · [History](#history) · [Branches](#branches-and-worktrees) · [GitHub](github.md) · [AI](ai-assistance.md) · [Preferences](interface.md)

### Repositories and projects

Use the desktop app or the same UI in a paired browser; browsers select folders on the backend host. [Installation and updates](getting-started.md), [remote access and pairing](web-access.md), and [development profiles](development.md) cover runtime setup. Dev keeps its application data separate from production, but repositories and authenticated host CLIs remain real resources.

- Open existing local repositories and keep added repositories available until you remove them. Opening a repository preserves its position and new repositories append to their group, so numbered shortcuts stay stable. The repository dialog offers location shortcuts, recent checkouts, clickable breadcrumbs, a folder filter, hidden-folder controls and an editable path. Git repositories and linked worktrees show their branch, including unborn branches and detached HEAD. Select a repository before opening it; a failed or pending navigation clears the previous selection. Ctrl+L edits the path, arrow keys select folders, Right browses into a folder, and Enter opens a repository. Desktop also offers its native folder picker. Mobile layouts keep the current folder and confirmation visible; the welcome screen scrolls when added repositories exceed the available height.
- Use the same authenticated WebSocket backend from the desktop app or a paired browser. On desktop the backend runs in a supervised utility process, so a renderer reload or crash does not stop repository watchers or in-flight server state while the desktop process remains open; an unexpected backend exit is restarted with bounded backoff. Repository switches and filesystem/Git events propagate to every connected tab, and reconnecting clients bootstrap fresh state without replaying interrupted mutations. Browser clients choose server folders in the repository dialog; native folder selection and Explorer reveal remain desktop-only, and their header uses the full browser width instead of reserving space for desktop window controls. The first payload is the workspace shell; Settings, History, PR creation, Files, Search, and the PRs list load the first time you open them.
- Use **Manage projects → Relocate repository** to select an existing folder manually, even before opening fails. Desktop uses a native folder picker; browsers use the visual server folder picker. Relocation updates the saved path without moving files, preserving the project assignment, open tabs, and expanded folders.
- **Remove from OpenTig** forgets a repository and its worktrees, clears their recent entries and project assignment, and returns to the welcome screen if the active repository was removed. A confirmation explains that folders and Git data stay on disk; you can open them again later. Save or close unsaved editor tabs before removing or relocating a repository.
- Group related repositories into named OpenTig projects without moving anything on disk. **Manage projects** saves project order and repository order within each group, including **No project**, with drag handles, keyboard dragging, and up/down buttons on desktop. Mobile uses larger up/down buttons without dragging, preserving scroll and focus after each move and briefly highlighting the moved row; reduced-motion preferences disable that highlight. Repository numbers match the selector. The repository dropdown grows to use up to 80% of the available viewport height, keeping search and management visible while its list scrolls; other dropdowns stay compact.
- Pull or push an individual repository from its row in the repository picker. Each row shows the repository name plus the branch that pull or push will use, and the worktree folder when that checkout is a linked worktree (the filesystem path is on the hover tooltip). When the repository has a favicon or app icon on disk (`favicon.svg`/`favicon.ico` at the root or under `public/`, `app/`, and similar locations, or a `<link rel="icon">` in `index.html`), that icon appears in the toolbar picker and on the welcome screen, with a folder fallback when no usable logo exists. Only pending operations are shown, each with its ahead/behind commit count; multiple repositories can sync concurrently, and their separate Sileo progress and outcome cards remain visible together. Opening the picker fetches each listed repository so those counts and checkouts match the remote, not a stale local cache.
- Fetch remotes periodically so ahead/behind counts stay current; choose the interval or turn periodic checks off in **Settings → General**. Manual Refresh fetches even when checks are off. See [remote checks and refresh](interface.md#remote-checks-and-refresh).
- Create, rename, delete, and reassign project groups.
- Switch quickly between repositories, branches, and available worktrees.
- Display current branch, ahead/behind state, and worktree insertion/deletion totals in the main toolbar.
- Coalesce overlapping watcher and manual refreshes, and keep the current diff mounted when a refresh changes only status or refs.

### Changes, diffs, and commits

- Separate conflicted, staged, and unstaged changes.
- Display changes as a flat list or recursive tree. Rows stay aligned as files load, sections empty or refill, conflicts appear, and folders expand or collapse, on desktop and phones.
- Treat each visually highlighted change or folder row as one continuous click target, with a pointer cursor across the active surface, while preserving its dedicated diff, open, stage, unstage, and discard controls.
- Stage or unstage individual files, folders, selections, or everything at once.
- Discard selected unstaged changes through an in-app confirmation that lists the affected paths; untracked files are sent to system Trash (the Recycle Bin on Windows).
- Review syntax-aware diffs in unified or split mode, with optional line wrapping, colored with the same One Light/One Dark Pro token palette as the Files editor and Markdown code blocks; added, deleted, and modified lines keep their own diff colors. Each file header shows the file name in full, with the folder path underneath. Sticky file headers keep an opaque background on hover so scrolled code does not show through. Language grammars load for the file being viewed rather than at startup.
- Open changed Markdown files directly in their staged or unstaged diff, while keeping **Open file** available for the rendered preview. Changed HTML, SVG, and image files retain their direct rich preview and separate diff action.
- Resolve merge conflicts in the built-in conflict editor, syntax-highlighted with the same palette as diffs and the Files editor, and mark resolved files for staging. Accepting the current, incoming, or both sides stays visible while background refreshes reconcile the saved file.
- Create commits from staged files, or create and push in one action when an upstream exists.
- Let the selected AI CLI suggest a reviewed multi-commit plan when staged files represent independent responsibilities, then prepare one complete-file group at a time without creating commits automatically.
- Work through that plan at your own pace: groups keep their original numbering as you commit them, show how many are done, open any listed file's diff for review, and each group is independently rechecked against its files so a plan cannot be applied after those files changed.
- When a split cannot be offered, OpenTig says why instead of staying silent, for example because a file is only partially staged or was renamed.
- Review AI run metadata and failed-operation diagnostics in Settings, and clear either history when wanted. Prompts and file contents are not stored in those histories; see [usage history and problems](ai-assistance.md#usage-history-and-problems) and [AI privacy](security-and-privacy.md#ai-privacy).
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
- Code, diffs, and conflicts share language detection for nested Dockerfiles and Makefiles, uppercase extensions, XML project files, JSON with comments, environment files, Git configuration, and installer scripts.
- Open text files in the built-in syntax-aware editor, using the same One Light/One Dark Pro palette as Markdown code blocks, and save with external-change protection. Repeated blank lines can be appended at the end of ordinary files without flashing an internal render error or losing editor focus, while large files retain virtualised rendering. A floating Save button appears over the editor while a file is dirty - the tab's own dot already marks it unsaved, so the button carries no redundant label - and saving keeps your scroll position instead of jumping to the top. Markdown, HTML, and SVG previews share accessible Preview/Code tabs with mouse and keyboard navigation.
- Move freely between open files without losing work: unsaved changes stay in memory for the running application, closing a modified tab offers Save, Discard, or Cancel, and only the active file keeps an editor loaded.
- Restore each worktree's open tabs, their order, and the file that was active when you return to it. Tab paths are remembered between sessions; unsaved text is never written to disk.
- Keep a tab whose file was renamed or moved pointing at its new path. A tab with unsaved changes whose file disappears stays open and is marked unavailable so its text can still be recovered, while clean tabs simply close.
- Only working-tree files become tabs; diffs, conflicts, commits, and pull requests stay transient. Up to 50 tabs are kept per worktree, and opening past that closes the clean tab you used least recently.
- Press `Ctrl+F` in any editable file to open one integrated find-and-replace panel, with single or global replacement, case, whole-word, regular-expression, and undo support.
- Preview and edit Markdown, HTML, and SVG files through compact Preview/Code controls; switching between them restores roughly the same scroll position in the tab you land on, holding it while diagrams, formulas, and syntax highlighting finish laying out, and releasing it the moment you scroll yourself. HTML previews run the file's own scripts in a sandbox that cannot access OpenTig.
- Load Markdown images relative to the document within the repository, including PNG and SVG files. Render GitHub-flavoured Markdown with syntax-highlighted code, copy buttons, alerts, footnotes, KaTeX, and Mermaid diagrams. Syntax highlighting, KaTeX, and Mermaid load when a Markdown preview actually needs them; opening a source file does not. External links (`http(s)://`, protocol-relative, and `mailto:`) open in your system browser or mail client instead of navigating inside OpenTig; relative links to repository files open that file in a new tab, and `#anchor` links scroll within the preview. Hovering any link shows a tooltip with its destination (truncated when long) and what clicking it will do (open in browser, open in mail app, or open file).
- Preview raster images with fit, 1:1, keyboard/wheel zoom, dimensions, and file-size information.
- Select multiple files and folders, then copy, cut, paste, rename, create, or delete them. Desktop paste imports copied file paths from native file managers or saves a clipboard image as PNG, only when you press `Ctrl+V` or choose Paste; runtimes without native file-clipboard support hide that action. Copy and move operations reject placing a folder inside itself, including when its parent is reached through a filesystem alias or Windows short path. Deletion requires an in-app confirmation that lists the affected paths. Drag and drop moves one or many selected entries with a lifted preview, a count badge, and clear folder or repository-root destination feedback.
- Copy file paths or contents and reveal entries in Windows File Explorer.
- Undo and redo supported file operations. Large or directory deletions fall back to system Trash when an in-app snapshot is not practical.
- Optionally include Git-ignored files in the tree.
- File removal uses system Trash with literal paths; a backend inside WSL uses Linux Trash. The Trash dependency is temporarily pinned to 9.0.0 pending a patched transitive dependency; see [third-party notices](../THIRD_PARTY_NOTICES.md#trash).

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
- Search subjects, authors, hashes, and references in loaded history. Matches are highlighted without removing graph rows; Enter or the next-match button scrolls to each result. Expanded rows keep their spacing when the search or merge grouping changes. Load more to search older commits.
- Group complete, exclusive, linear side branches under their merge commit. Partial pages, shared branches, and nested side merges stay expanded in the graph. The grouped count reveals the commits again; search temporarily reveals all grouped commits.
- Recognize GitHub-style merge messages and trailing `(#123)` references. These are message hints, not verified PR status or proof of squash/rebase. On GitHub repositories, the reference opens the existing PR viewer on the right; an issue number or unavailable PR is handled by that viewer. Squash/rebase histories remain linear because the graph always follows actual parents.
- Inspect commit subjects, full messages, authors, dates, refs, publication state, and changed files. Expanded sidebar rows show a three-line description preview with ellipsis when needed. Click the subject to open any commit, including merge and empty commits, with complete metadata and the full message available immediately. Commit subjects have no hover tooltip.
- Merge commits list only their own file changes relative to every parent; the viewer shows those changes as a unified diff against the first parent and labels that comparison. Commits without file changes still open their metadata and full message, with an empty-diff message below the header.
- Copy full commit hashes.
- Web links in the full commit subject, message, expanded description, and PR commit timeline show their destination and **Open in new tab** on hover or keyboard focus. They open in a new browser tab (the system browser on desktop); email links open the mail client. Commit messages otherwise retain their plain-text formatting.
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

Use the authenticated GitHub CLI to review PR metadata, descriptions, cumulative or per-commit diffs, and native stacks; open them in OpenTig or GitHub, or create an editable draft before publishing. Repository account selection, Git HTTPS authentication, and commit authorship are separate controls. See [GitHub accounts and pull requests](github.md) for setup, scopes, access checks, direct push behavior across clients, and credential boundaries.

### Optional AI assistance

Locally installed Codex, Claude Code, OpenCode 2, or Grok Build can draft commit messages, propose complete-file commit groups, and write PR descriptions. You review and confirm every commit or PR. See [AI assistance](ai-assistance.md) for supported versions, CLI detection, model selection, coverage reports, optional repository instructions, and usage history; [AI privacy](security-and-privacy.md#ai-privacy) covers provider isolation and supplied context.

### Preferences

Choose themes, fonts, interface scale, change-list layout, viewer wrapping, ignored-file visibility, remote-check intervals, and shortcuts from Settings. OpenTig remembers viewer and workspace preferences, project ordering, expanded folders, and worktree tabs. See [interface, preferences, and mobile use](interface.md) for the controls, phone navigation, and saved state.

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
