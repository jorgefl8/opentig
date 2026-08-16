# JustGit

JustGit is a focused, local-first Git desktop client for Windows. It is designed for the everyday repository loop: understand what changed, edit or inspect files, stage the right work, create a commit, synchronise it, and review pull requests without turning Git into a project-management suite.

The application works directly with repositories already on your machine. Git remains the source of truth, repository contents stay local, and optional integrations use command-line tools that you install and authenticate yourself.

> [!NOTE]
> JustGit is pre-release software. Back up important work and review destructive Git or filesystem operations before confirming them.

## Why JustGit?

JustGit aims to keep common Git work visible and understandable:

- changes, files, history, pull requests, and repository search share one compact workspace;
- potentially destructive actions have explicit safeguards and useful recovery paths;
- worktrees and local branches are first-class instead of hidden behind advanced menus;
- AI assistance is optional, bounded, and always produces editable text rather than acting automatically;
- repository files and credentials are not copied into an application-managed cloud service.

It is intentionally not an IDE, hosting service, or replacement for the Git CLI. Use it as a fast visual layer over local Git repositories.

## Main workflow

1. Open an existing local Git repository with `Ctrl+O`, or choose one from the recent-repository picker.
2. Review unstaged, staged, and conflicted files in **Changes**.
3. Open a syntax-aware diff, stage only the intended files, and write or generate an editable commit message.
4. Commit locally, optionally commit and push, then inspect the result in **History**.
5. Use **PRs** to review or create a GitHub pull request when the repository is connected to GitHub.

## Features

### Repositories and projects

- Open existing local repositories and return to recently used repositories.
- Group related repositories into named JustGit projects without moving anything on disk.
- Create, rename, delete, and reassign project groups.
- Switch quickly between repositories, branches, and available worktrees.
- Display current branch, ahead/behind state, and worktree insertion/deletion totals in the main toolbar.

### Changes, diffs, and commits

- Separate conflicted, staged, and unstaged changes.
- Display changes as a flat list or recursive tree.
- Treat each visually highlighted change or folder row as one continuous click target, with a pointer cursor across the active surface, while preserving its dedicated diff, open, stage, unstage, and discard controls.
- Stage or unstage individual files, folders, selections, or everything at once.
- Discard selected unstaged changes with confirmation; untracked files are sent to the Windows Recycle Bin.
- Review syntax-aware diffs in unified or split mode, with optional line wrapping.
- Open rich previews for changed Markdown, HTML, SVG, and image files directly from **Changes**, with a separate action to inspect their diff.
- Resolve merge conflicts in the built-in conflict editor and mark resolved files for staging.
- Create commits from staged files, or create and push in one action when an upstream exists.
- Let the selected AI CLI suggest a reviewed multi-commit plan when staged files represent independent responsibilities, then prepare one complete-file group at a time without creating commits automatically.
- Work through that plan at your own pace: groups keep their original numbering as you commit them, show how many are done, open any listed file's diff for review, and each group is independently rechecked against its files so a plan cannot be applied after those files changed.
- When a split cannot be offered, JustGit says why instead of staying silent, for example because a file is only partially staged or was renamed.
- Every generation is recorded locally for diagnostics: harness, model, outcome, duration, the tokens and cost the harness reported, and why a proposed split was refused. Only this metadata is stored; prompts and file contents never leave the repository.
- Review that history from **Settings → AI commit messages → View history**, with totals for runs, failures, tokens, and reported cost, and clear it whenever you want.
- Undo the latest unpublished commit while keeping its changes staged. JustGit verifies the expected commit and upstream state before rewriting history.

### Safe pull and push

- Pull only by fast-forward after fetching; JustGit does not create an implicit merge commit.
- Preserve local changes through a temporary safety stash when pulling, including untracked files.
- Keep and report the recovery stash if changes cannot be restored cleanly.
- Refuse unsafe pull or push states such as unresolved conflicts, an active Git operation, missing upstream configuration, or diverged history.
- Surface remote rejection, branch-protection, authentication, and configuration failures as actionable messages.

### Files and editing

- Browse the repository as a virtualised tree with sticky parent folders and persisted expansion state.
- Keep open files in a compact tab strip in the header: a single click previews a file and the next preview replaces it, while editing, double-clicking, or `Ctrl`-clicking pins the tab so it opens alongside the preview instead of replacing it. Tabs can be reordered through a lifted drag preview with animated live placement, closed with the middle mouse button, show the parent folder when two files share a name, and expose their full path and state in a styled tooltip.
- Open text files in the built-in syntax-aware editor and save with external-change protection. Markdown, HTML, and SVG previews share accessible Preview/Code tabs with mouse and keyboard navigation.
- Move freely between open files without losing work: unsaved changes stay in memory for the running application, closing a modified tab offers Save, Discard, or Cancel, and only the active file keeps an editor loaded.
- Restore each worktree's open tabs, their order, and the file that was active when you return to it. Tab paths are remembered between sessions; unsaved text is never written to disk.
- Keep a tab whose file was renamed or moved pointing at its new path. A tab with unsaved changes whose file disappears stays open and is marked unavailable so its text can still be recovered, while clean tabs simply close.
- Only working-tree files become tabs; diffs, conflicts, commits, and pull requests stay transient. Up to 50 tabs are kept per worktree, and opening past that closes the clean tab you used least recently.
- Find and replace one or every occurrence in an editable file, with case, whole-word, regular-expression, and undo support.
- Preview and edit Markdown, HTML, and SVG files through compact Preview/Code controls.
- Render GitHub-flavoured Markdown with syntax-highlighted code, copy buttons, alerts, footnotes, KaTeX, and Mermaid diagrams.
- Preview raster images with fit, 1:1, keyboard/wheel zoom, dimensions, and file-size information.
- Select multiple files and folders, then copy, cut, paste, rename, create, or delete them. Drag and drop moves one or many selected entries with a lifted preview, a count badge, and clear folder or repository-root destination feedback.
- Copy file paths or contents and reveal entries in Windows File Explorer.
- Undo and redo supported file operations. Large or directory deletions fall back to the Windows Recycle Bin when an in-app snapshot is not practical.
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
- Inspect commit subjects, full descriptions, authors, dates, refs, publication state, and changed files. Expanded history rows show the complete description; long descriptions in the commit viewer can be revealed without hiding the diff.
- Copy full commit hashes.
- Open complete commit diffs or the diff for one file, including renamed paths.
- Undo only the latest commit when JustGit can prove it is still local and safe to undo.

### Branches and worktrees

- Search and switch between local and remote branches; selecting a remote branch creates or uses its local tracking branch.
- Prevent switching to a branch already checked out in another worktree.
- Inspect local branch tips, upstreams, ahead/behind state, unique commits, and owning worktrees.
- Delete local branches only through Git's non-forced, fully merged path.
- Inspect worktree path, branch, HEAD, lock/prunable state, and local changes.
- Open or remove eligible linked worktrees. Removing a worktree never deletes its branch, and the main worktree cannot be removed.

### GitHub pull requests

GitHub features use the authenticated GitHub CLI (`gh`):

- List open pull requests for the current GitHub repository.
- Inspect pull-request metadata, Markdown description, and full diff.
- Switch the pull-request **Code** view between all cumulative changes and the diff introduced by an individual commit.
- Open a pull request in the browser.
- Create a pull request or draft pull request with a selected remote base branch.
- Edit and preview the GitHub Markdown description before publishing.
- Require the current branch to be published and up to date before PR creation.
- Optionally generate an editable title and description from the branch diff with the selected local AI CLI.

### Optional AI assistance

JustGit supports locally installed Codex, Claude Code, and OpenCode CLIs. It can:

- generate an editable commit message from staged changes;
- propose multiple focused commits, including their messages, reasons, and complete-file groups, when a split is clearly beneficial;
- generate an editable pull-request title and description from the current branch diff;
- detect installed providers, authentication state, and available models;
- cancel an in-progress generation request.

AI never creates a commit or pull request automatically. You review and edit the generated text before any Git or GitHub action occurs.

### Preferences

- System, light, and dark themes.
- Adjustable interface scale.
- Tree or list layout for changes.
- Optional line wrapping in viewers.
- Optional display of Git-ignored files.
- Per-provider AI model selection.
- Persisted sidebar width, viewer preferences, recent repositories, projects, expanded file-tree paths, and each worktree's open file tabs.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open a repository |
| `Ctrl+P` | Quick-open a file |
| `Ctrl+R` | Refresh repository state |
| `Ctrl+1` … `Ctrl+5` | Open Changes, Files, History, PRs, or Search |
| `Ctrl+S` | Save the open editable file |
| `Ctrl+W` | Close the active file tab |
| `Ctrl+Tab`, `Ctrl+Shift+Tab` | Move to the next or previous file tab |
| `Ctrl+Shift+PageUp`, `Ctrl+Shift+PageDown` | Move the active file tab left or right |
| `Enter`, `Delete` | Activate or close the focused file tab |
| `Ctrl+F`, `Ctrl+Alt+F` | Find, or find and replace, in the open editable file |
| `Ctrl+Enter` | Create a commit while the commit composer is focused |
| `Ctrl+Shift+Enter` | Create a commit and push when available |
| `Ctrl+C`, `Ctrl+X`, `Ctrl+V` | Copy, cut, or paste selected Files entries |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo or redo a supported Files operation |
| `F2` | Rename the selected Files entry |
| `Delete` | Delete selected Files entries |
| `Q`, then a number | Open the numbered recent repository |
| `+`, `-`, `0`, `F` | Zoom in, zoom out, reset, or fit an image preview |

## Requirements

- Windows 10 or later
- Git available on `PATH`
- Node.js 24 or later and npm 11 or later when building from source

Optional integrations require their own installed and authenticated CLI:

```powershell
gh auth login
codex login
claude auth login
opencode auth login
```

Only install the tools you intend to use. GitHub functionality requires `gh`; AI features require at least one supported AI CLI.

## Run from source

```powershell
npm ci
npm start
```

Run all quality gates:

```powershell
npm run check
```

Build the unpacked application or distributable artifacts:

```powershell
npm run package
npm run make
```

The unpacked executable is written to `out/JustGit-win32-x64/JustGit.exe`.

## Local-first and security model

- Repository contents are read from and written to their existing local paths.
- The renderer has no direct Node.js, filesystem, or process access.
- Privileged work stays in the Electron main process behind a narrow, typed preload bridge.
- Git commands use argument arrays with `shell: false`, bounded output, timeouts, path validation, and per-repository write serialisation.
- External links are validated before opening in the system browser.
- HTML previews run in a sandbox; rendered Markdown is sanitised before display.
- JustGit does not read or persist GitHub or AI API tokens. Connected CLIs manage their own authentication.

## AI privacy

For commit-message generation, JustGit sends the selected local AI CLI only a bounded staged diff, its summary, staged paths, the branch name, and up to ten recent commit subjects. It does not include unstaged content; untracked files are included only after you stage them.

Multi-commit proposals are accepted only when they partition every staged path exactly once. JustGit suppresses them for truncated context, partially staged files, and staged renames, and verifies that the staged snapshot has not changed before preparing the first group. Preparing a group changes only the Git index; every commit still requires an explicit review and confirmation.

For pull-request drafting, it sends a bounded comparison between the current branch and the selected base branch. If the context is truncated, the interface tells you to review the result carefully.

Generated content remains editable and pending. No commit is created and no pull request is published until you explicitly confirm the corresponding action.

## Architecture

- `src/main`: Electron main process, Git execution, filesystem access, persistence, and external CLI integrations.
- `src/preload.ts`: narrow, typed bridge exposed to the renderer.
- `src/renderer`: React interface and feature modules.
- `src/shared`: IPC contracts, shared models, and validation helpers.

## Current scope

- Windows desktop only.
- Opens existing local repositories; cloning and initial remote setup remain Git CLI tasks.
- GitHub integration currently depends on `gh` and the repository's configured GitHub remote.
- JustGit deliberately avoids force push, forced branch deletion, automatic merge commits, and automatic AI actions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues must follow [SECURITY.md](SECURITY.md).

## License

JustGit source code is available under the [MIT License](LICENSE). Bundled third-party assets retain their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
