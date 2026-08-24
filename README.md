# OpenTig

OpenTig is a focused, local-first Git client available as a Windows desktop application and as a headless Node.js CLI with a browser interface. It is designed for the everyday repository loop: understand what changed, edit or inspect files, stage the right work, create a commit, synchronise it, and review pull requests without turning Git into a project-management suite.

The application works directly with repositories already on your machine. Git remains the source of truth, repository contents stay local, and optional integrations use command-line tools that you install and authenticate yourself.

> [!NOTE]
> OpenTig is pre-release software. Back up important work and review destructive Git or filesystem operations before confirming them.

## Why OpenTig?

OpenTig aims to keep common Git work visible and understandable:

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
- Use the same authenticated WebSocket backend from the desktop app or a paired browser. On desktop the backend runs in a supervised utility process, so a renderer reload or crash does not stop repository watchers or in-flight server state while the desktop process remains open; an unexpected backend exit is restarted with bounded backoff. Repository switches and filesystem/Git events propagate to every connected tab, and reconnecting clients bootstrap fresh state without replaying interrupted mutations. Browser clients enter paths on the server directly, while native folder selection and Explorer reveal remain desktop-only.
- Run that exact server/runtime/client bundle through `npx --yes @opentig/cli@<version>` or plain `bunx @opentig/cli@<version>`. The default/start command opens a five-minute one-use pairing link, while `serve` stays headless and prints the link plus a terminal QR code. `opentig pair` safely mints a fresh link for a server already using the same private home directory.
- Keep that backend loopback-only by default, or enable **Settings → Network access** to restart the same utility listener on trusted LAN interfaces. The desktop pane shows server state, actual port, local and network endpoints, and connected owner sessions; it creates five-minute one-use pairing links with a QR code and can revoke every existing owner session without exposing a permanent token. Browsers without a valid owner session show fresh-pairing instructions instead of leaving the application loading indefinitely. Healthy connections stay unobtrusive; reconnecting and failed states remain visible.
- Relocate a recent repository when its folder moved, preserving its project assignment, open tabs, and expanded folders.
- Group related repositories into named OpenTig projects without moving anything on disk.
- Pull or push an individual repository from its row in the repository picker. Only pending operations are shown, each with its ahead/behind commit count; multiple repositories can sync concurrently, and their separate Sileo progress and outcome cards remain visible together. Opening the picker fetches each listed repository so those counts match the remote, not a stale local cache.
- Fetch remotes in the background so toolbar ahead/behind counts stay current. The default interval is 30 seconds and can be raised, lowered, or turned off in **Settings → General**.
- Create, rename, delete, and reassign project groups.
- Switch quickly between repositories, branches, and available worktrees.
- Display current branch, ahead/behind state, and worktree insertion/deletion totals in the main toolbar.
- Carry the OpenTig logo through the main toolbar, packaged Windows application, installer, and taskbar.

### Changes, diffs, and commits

- Separate conflicted, staged, and unstaged changes.
- Display changes as a flat list or recursive tree.
- Treat each visually highlighted change or folder row as one continuous click target, with a pointer cursor across the active surface, while preserving its dedicated diff, open, stage, unstage, and discard controls.
- Stage or unstage individual files, folders, selections, or everything at once.
- Discard selected unstaged changes through an in-app confirmation; untracked files are sent to system Trash (the Recycle Bin on Windows).
- Review syntax-aware diffs in unified or split mode, with optional line wrapping, colored with the same One Light/One Dark Pro token palette as the Files editor and Markdown code blocks; added, deleted, and modified lines keep their own diff colors.
- Open changed Markdown files directly in their staged or unstaged diff, while keeping **Open file** available for the rendered preview. Changed HTML, SVG, and image files retain their direct rich preview and separate diff action.
- Resolve merge conflicts in the built-in conflict editor, syntax-highlighted with the same palette as diffs and the Files editor, and mark resolved files for staging.
- Create commits from staged files, or create and push in one action when an upstream exists.
- Let the selected AI CLI suggest a reviewed multi-commit plan when staged files represent independent responsibilities, then prepare one complete-file group at a time without creating commits automatically.
- Work through that plan at your own pace: groups keep their original numbering as you commit them, show how many are done, open any listed file's diff for review, and each group is independently rechecked against its files so a plan cannot be applied after those files changed.
- When a split cannot be offered, OpenTig says why instead of staying silent, for example because a file is only partially staged or was renamed.
- Every generation is recorded locally for diagnostics: harness, model, outcome, duration, the tokens and cost the harness reported, and why a proposed split was refused. Only this metadata is stored; prompts and file contents never leave the repository.
- Review that history from **Settings → AI commit messages → View history**, in a sortable table (click a column header to sort) that scrolls within the dialog, with totals for runs, failures, tokens, and reported cost, and clear it whenever you want.
- Undo the latest unpublished commit while keeping its changes staged. OpenTig verifies the expected commit and upstream state before rewriting history.

### Safe pull and push

- Pull by fast-forward when the branch has no local commits, or rebase those local commits onto the updated remote when the histories have diverged and there are no conflicts. The unpublished commits stay on top, ready to push. OpenTig does not create an implicit merge commit.
- If a rebase would conflict, abort it and leave the branch unchanged instead of stranding the repository mid-rebase.
- Preserve local changes through a temporary safety stash when pulling, including untracked files.
- Keep and report the recovery stash if changes cannot be restored cleanly.
- Refuse unsafe pull or push states such as unresolved conflicts, an active Git operation, or missing upstream configuration.
- Surface remote rejection, branch-protection, authentication, and configuration failures as actionable messages.

### Files and editing

- Browse the repository as a virtualised tree with sticky parent folders and persisted expansion state.
- Keep open files in a compact tab strip in the header: a single click previews a file and the next preview replaces it, while editing, double-clicking, or `Ctrl`-clicking pins the tab so it opens alongside the preview instead of replacing it. Tabs can be reordered through a lifted drag preview with animated live placement, closed with the middle mouse button, show the parent folder when two files share a name, and expose their full path and state in a styled tooltip.
- Open a file from its **Files** context menu as a replaceable preview or choose **Open to the Side** (`Ctrl`-click) to pin it beside the current file. Dragging a file from the tree onto the header tab strip performs the same pinned open with explicit drop feedback.
- Open text files in the built-in syntax-aware editor, using the same One Light/One Dark Pro palette as Markdown code blocks, and save with external-change protection. A floating Save button appears over the editor while a file is dirty - the tab's own dot already marks it unsaved, so the button carries no redundant label - and saving keeps your scroll position instead of jumping to the top. Markdown, HTML, and SVG previews share accessible Preview/Code tabs with mouse and keyboard navigation.
- Move freely between open files without losing work: unsaved changes stay in memory for the running application, closing a modified tab offers Save, Discard, or Cancel, and only the active file keeps an editor loaded.
- Restore each worktree's open tabs, their order, and the file that was active when you return to it. Tab paths are remembered between sessions; unsaved text is never written to disk.
- Keep a tab whose file was renamed or moved pointing at its new path. A tab with unsaved changes whose file disappears stays open and is marked unavailable so its text can still be recovered, while clean tabs simply close.
- Only working-tree files become tabs; diffs, conflicts, commits, and pull requests stay transient. Up to 50 tabs are kept per worktree, and opening past that closes the clean tab you used least recently.
- Press `Ctrl+F` in any editable file to open one integrated find-and-replace panel, with single or global replacement, case, whole-word, regular-expression, and undo support.
- Preview and edit Markdown, HTML, and SVG files through compact Preview/Code controls; switching between them restores roughly the same scroll position in the tab you land on, holding it while diagrams, formulas, and syntax highlighting finish laying out, and releasing it the moment you scroll yourself.
- Render GitHub-flavoured Markdown with syntax-highlighted code, copy buttons, alerts, footnotes, KaTeX, and Mermaid diagrams. External links (`http(s)://`, protocol-relative, and `mailto:`) open in your system browser or mail client instead of navigating inside OpenTig; relative links to repository files open that file in a new tab, and `#anchor` links scroll within the preview. Hovering any link shows a tooltip with its destination (truncated when long) and what clicking it will do (open in browser, open in mail app, or open file).
- Preview raster images with fit, 1:1, keyboard/wheel zoom, dimensions, and file-size information.
- Select multiple files and folders, then copy, cut, paste, rename, create, or delete them. Desktop paste imports explicit file paths (or a clipboard image) only when you press `Ctrl+V` or choose Paste; runtimes without native file-clipboard support hide that action. Deletion requires an in-app confirmation that lists the affected paths. Drag and drop moves one or many selected entries with a lifted preview, a count badge, and clear folder or repository-root destination feedback.
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
- Follow current-branch history through a compact Git graph with colored lanes for merges and parent relationships.
- Inspect commit subjects, full descriptions, authors, dates, refs, publication state, and changed files. Expanded history rows show the complete description; long descriptions in the commit viewer can be revealed without hiding the diff.
- Copy full commit hashes.
- Open complete commit diffs or the diff for one file, including renamed paths.
- Undo only the latest commit when OpenTig can prove it is still local and safe to undo.

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

OpenTig supports locally installed Codex, Claude Code, and OpenCode CLIs. It can:

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
- Rebind most keyboard shortcuts from **Settings → Shortcuts**, with per-shortcut conflict detection and one-click reset to defaults; the shortcuts marked fixed below follow platform or file-manager conventions and cannot be changed.
- Turn off the double-tap-Control shortcut that brings OpenTig to the front from any application, also from **Settings → Shortcuts**.
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
| `Q`, then a number | Open the repository switcher, then the numbered recent repository |
| `+`, `-`, `0`, `F` (fixed) | Zoom in, zoom out, reset, or fit an image preview |

## Requirements

- Windows 10 or later for the desktop application.
- Node.js 24 or later and Git on `PATH` for the headless CLI. Plain `bunx` installs and launches the Node shebang; a Bun-only runtime is not supported.
- Node.js 24 or later and npm 11 or later when building from source.

Optional integrations require their own installed and authenticated CLI:

```powershell
gh auth login
codex login
claude auth login
opencode auth login
```

Only install the tools you intend to use. GitHub functionality requires `gh`; AI features require at least one supported AI CLI.

## Run the headless CLI

Pin an exact version for repeatable or production use:

```powershell
npx --yes @opentig/cli@0.1.0 C:\repos\project
npx --yes @opentig/cli@0.1.0 serve C:\repos\project
bunx @opentig/cli@0.1.0 serve C:\repos\project
```

`opentig [cwd]` and `opentig start [cwd]` start the server and open its one-time pairing link. `opentig serve [cwd]` does not open a browser. An invalid or missing working directory is not created; the server remains available without opening it. After a global installation, a new device can request a fresh link from the same OS account with:

```powershell
opentig pair --home C:\path\to\opentig-home
```

Options are `--host`, `--port`, `--home`, and `--no-browser`, with `OPENTIG_HOST`, `OPENTIG_PORT`, and `OPENTIG_HOME` environment equivalents. Defaults are `127.0.0.1`, preferred port `6767`, and `~/.opentig`. An explicit occupied port fails; an omitted port scans a bounded range upward. The home contains private settings, hash-only sessions, a local-admin credential, credential-free runtime state, AI history, and rotating logs. SIGINT or SIGTERM closes WebSockets, the HTTP listener, watchers, Git/AI children, settings, and logs; a second signal forces exit.

For local tarball testing on Windows:

```powershell
npx --yes --package C:\absolute\path\opentig-cli-0.1.0.tgz opentig --help
bunx --package C:\absolute\path\opentig-cli-0.1.0.tgz opentig --help
```

Use `latest` only for evaluation after a public release. To upgrade or roll back production, stop the process and run a different pinned immutable version. OpenTig does not ship Docker, a systemd installer, built-in TLS, Tailscale/SSH automation, multi-user roles, or server self-update.

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

The unpacked executable is written to `out/OpenTig-win32-x64/OpenTig.exe`.

## Local-first and security model

- Repository contents are read from and written to their existing local paths.
- The renderer has no direct Node.js, filesystem, or process access.
- Git, filesystem, persistence, AI, and GitHub operations run through one typed, validated WebSocket command boundary in both desktop and browser clients. Requests have correlation IDs, cancellation and timeouts; interrupted operations are rejected rather than replayed after reconnect.
- The private server transport binds to loopback by default, requires an owner session for commands and image bytes, validates exact mutation/WebSocket origins, and blocks static-file traversal and symlink escape. Enabling **Settings → Network access** persists a desktop-only setting and restarts that same backend on `0.0.0.0`; disabling it returns to `127.0.0.1`. OpenTig never starts a second Web Access server.
- New browsers pair through a five-minute, one-use URL fragment displayed as a link and local QR code; the fragment is cleared before exchange. Steady-state credentials use host-only `HttpOnly`, `SameSite=Strict` cookies, only credential hashes are persisted, and revoking all sessions disconnects paired browsers while replacing the private desktop session. Network access grants owner-level file, Git, GitHub, and AI CLI authority as the OS user: use only a trusted LAN or VPN, an HTTPS reverse proxy, or an SSH tunnel, and never expose the raw port publicly.
- Headless `pair` authenticates over a same-host-only administrative route using a separate private file under `~/.opentig/server`; `runtime.json` contains PID/address/version identity but no credential. Pairing secrets remain memory-only and appear only in the deliberate one-time terminal output/URL fragment, never in arguments, environment variables, routine logs, query strings, or persisted state.
- Electron starts the backend after readiness on preferred port `6767`, scanning a bounded range upward only when that implicit port is occupied. Its one-use desktop bootstrap secret crosses the private parent/utility message port exactly once; it is absent from process arguments, environment variables, renderer JavaScript, and redacted rotating logs. Unexpected exits restart one utility process on the same selected port.
- The narrow preload bridge contains only proven desktop capabilities such as folder selection/relocation, file clipboard import, Explorer reveal, title-bar theming, and zoom. Text clipboard access stays in the renderer's browser API.
- Git commands use argument arrays with `shell: false`, bounded output, timeouts, path validation, and per-repository write serialisation.
- External links are allowlisted to `http(s)://` and `mailto:` before Electron's window-navigation interception opens them in the system browser.
- HTML previews run in a sandbox; rendered Markdown is sanitised before display.
- OpenTig does not read or persist GitHub or AI API tokens. Connected CLIs manage their own authentication.

## AI privacy

For commit-message generation, OpenTig sends the selected local AI CLI only a bounded staged diff, its summary, staged paths, the branch name, and up to ten recent commit subjects. It does not include unstaged content; untracked files are included only after you stage them.

Multi-commit proposals are accepted only when they partition every staged path exactly once. OpenTig suppresses them for truncated context, partially staged files, and staged renames, and verifies that the staged snapshot has not changed before preparing the first group. Preparing a group changes only the Git index; every commit still requires an explicit review and confirmation.

For pull-request drafting, it sends a bounded comparison between the current branch and the selected base branch. If the context is truncated, the interface tells you to review the result carefully.

Generated content remains editable and pending. No commit is created and no pull request is published until you explicitly confirm the corresponding action.

## Architecture

- `src/main/runtime`: Electron-free service graph and validated server-command registry for Git, filesystem, persistence, AI, GitHub, watchers, and shutdown.
- `src/main/ipc`: handlers for native-only desktop capabilities; no domain commands are registered here.
- `packages/server`: public `@opentig/cli`, Electron-free server build containing the reusable server factory, thin CLI and utility-process adapters, authenticated HTTP/WebSocket transport, and the exact production web client.
- `src/main/server`: Electron utility-process supervisor and desktop-only exposure state for port selection, loopback/LAN binding, readiness probing, pairing controls over the private parent port, redacted rotating logs, bounded restart, and graceful shutdown. Electron main owns only window/session/native integration; Git, filesystem, persistence, AI, GitHub, and watchers remain in the utility server.
- `src/preload.ts`: narrow, context-isolated typed bridge exposed to the renderer.
- `src/renderer`: React interface and feature modules.
- `src/shared`: server/desktop transport contracts, shared models, and validation helpers.

Detailed guides:

- [Server architecture](docs/architecture.md): process model, ownership boundaries, request/event flow, recovery, persistence, and source map.
- [Network access and browser pairing](docs/web-access.md): trusted-LAN operation, authentication, revocation, diagnostics, and security guidance.
- [Documentation index](docs/README.md): implemented scope and the remaining headless/release work.

## Current scope

- Windows x64 desktop application; the Node.js headless package is OS-neutral and tested independently through its generated tarball.
- Opens existing local repositories; cloning and initial remote setup remain Git CLI tasks.
- GitHub integration currently depends on `gh` and the repository's configured GitHub remote.
- OpenTig deliberately avoids force push, forced branch deletion, automatic merge commits, and automatic AI actions. Periodic fetch only updates remote-tracking refs; it never rebases or merges on its own.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues must follow [SECURITY.md](SECURITY.md).

## License

OpenTig source code is available under the [MIT License](LICENSE). Bundled third-party assets retain their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
