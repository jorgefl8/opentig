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
- Stage or unstage individual files, folders, selections, or everything at once.
- Discard selected unstaged changes with confirmation; untracked files are sent to the Windows Recycle Bin.
- Review syntax-aware diffs in unified or split mode, with optional line wrapping.
- Resolve merge conflicts in the built-in conflict editor and mark resolved files for staging.
- Create commits from staged files, or create and push in one action when an upstream exists.
- Undo the latest unpublished commit while keeping its changes staged. JustGit verifies the expected commit and upstream state before rewriting history.

### Safe pull and push

- Pull only by fast-forward after fetching; JustGit does not create an implicit merge commit.
- Preserve local changes through a temporary safety stash when pulling, including untracked files.
- Keep and report the recovery stash if changes cannot be restored cleanly.
- Refuse unsafe pull or push states such as unresolved conflicts, an active Git operation, missing upstream configuration, or diverged history.
- Surface remote rejection, branch-protection, authentication, and configuration failures as actionable messages.

### Files and editing

- Browse the repository as a virtualised tree with sticky parent folders and persisted expansion state.
- Open text files in the built-in syntax-aware editor and save with external-change protection.
- Preview and edit Markdown, HTML, and SVG files through compact Preview/Code controls.
- Render GitHub-flavoured Markdown with syntax-highlighted code, copy buttons, alerts, footnotes, KaTeX, and Mermaid diagrams.
- Preview raster images with fit, 1:1, keyboard/wheel zoom, dimensions, and file-size information.
- Select multiple files and folders, then copy, cut, paste, move by drag and drop, rename, create, or delete them.
- Copy file paths or contents and reveal entries in Windows File Explorer.
- Undo and redo supported file operations. Large or directory deletions fall back to the Windows Recycle Bin when an in-app snapshot is not practical.
- Optionally include Git-ignored files in the tree.

### Quick open and repository search

- Open files by fuzzy path search with `Ctrl+P`.
- Search file contents across the repository with case-sensitive, whole-word, and regular-expression modes.
- Group matches by file, show line numbers, and open a result directly in the editor.
- Identify results from Git-ignored files separately.

### History

- Browse commit history incrementally instead of loading the entire repository at once.
- Inspect commit subjects, authors, dates, refs, publication state, and changed files.
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
- Open a pull request in the browser.
- Create a pull request or draft pull request with a selected remote base branch.
- Edit and preview the GitHub Markdown description before publishing.
- Require the current branch to be published and up to date before PR creation.
- Optionally generate an editable title and description from the branch diff with the selected local AI CLI.

### Optional AI assistance

JustGit supports locally installed Codex, Claude Code, and OpenCode CLIs. It can:

- generate an editable commit message from staged changes;
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
- Persisted sidebar width, viewer preferences, recent repositories, projects, and expanded file-tree paths.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open a repository |
| `Ctrl+P` | Quick-open a file |
| `Ctrl+R` | Refresh repository state |
| `Ctrl+1` … `Ctrl+5` | Open Changes, Files, History, PRs, or Search |
| `Ctrl+S` | Save the open editable file |
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

For commit-message generation, JustGit sends the selected local AI CLI only a bounded staged diff, its summary, the branch name, and up to ten recent commit subjects. It does not include unstaged content or untracked files.

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
