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

- An unpaired browser offers **Pair this browser** with the appropriate CLI command. Both the authentication notice and pairing form include **Copy command** (`npm run pair:web:dev` for Dev, `opentig pair` for production), fit narrow screens, and scroll when necessary. Opening `/pair` checks the existing browser session first and returns authenticated browsers directly to the app; a failed connection offers a retry instead of asking for a new code. Paired sessions survive server restarts with the same data directory; a new pairing is needed if the browser loses its session cookie or access is revoked.
- Run **OpenTig Dev** alongside production with separate preferences, recent repositories, window state, logs, browser sessions, and network-access settings. Desktop source runs and packaged Dev builds share one persistent desktop Dev profile; only one desktop Dev instance runs at a time. The browser-only source runner uses its own Dev data directory. A fresh Dev profile starts with Network access and the global double-Control shortcut off.
- Installed, signed Windows releases check GitHub for stable updates at startup and every six hours. **Settings → Updates** also offers a manual check, download progress, release notes, and **Restart and install**; a notice appears when a release is available or ready. Downloading never installs on ordinary exit. Restart waits for edited files to allow closing and for the local server/settings to shut down. Dev, unsigned candidates, unpacked/copied applications, and browser clients do not check for or install desktop updates.
- Open existing local repositories and return to recently used repositories. The mobile welcome screen centers its content and scrolls when recent repositories exceed the available height.
- Use the same authenticated WebSocket backend from the desktop app or a paired browser. On desktop the backend runs in a supervised utility process, so a renderer reload or crash does not stop repository watchers or in-flight server state while the desktop process remains open; an unexpected backend exit is restarted with bounded backoff. Repository switches and filesystem/Git events propagate to every connected tab, and reconnecting clients bootstrap fresh state without replaying interrupted mutations. Browser clients choose server folders in a visual picker with Home, Up, and an editable path; native folder selection and Explorer reveal remain desktop-only, and their header uses the full browser width instead of reserving space for desktop window controls. The first payload is the workspace shell; Settings, History, PR creation, Files, Search, and the PRs list load the first time you open them.
- Run that exact server/runtime/client bundle through `npx --yes @opentig/cli@<version>` or plain `bunx @opentig/cli@<version>`. The default/start command opens a five-minute one-use pairing link, while `serve` stays headless and prints its portable code, link, and terminal QR. `opentig pair` safely mints a fresh code for a server already using the same private home directory. The CLI keeps its configured port stable—`6767` by default—and reports a conflict instead of silently moving a tunnel target.
- Keep that backend loopback-only by default, or enable **Settings → Web access → LAN access** to restart the same utility listener on trusted LAN interfaces. Every browser still requires a one-use pairing code. A same-machine Cloudflare Tunnel or HTTPS reverse proxy can point straight to `http://127.0.0.1:<port>` without registering the public URL in OpenTig: open `/pair` on that domain and paste the generated code. OpenTig validates each HTTP/WebSocket origin against the authority used for that request, trusts forwarded authority/client-IP metadata only from loopback, and issues a `Secure` cookie for HTTPS. The same pane gives paired devices editable names, shows browser/OS, proxy/IP and connection activity, and revokes them individually or together; stale desktop sessions are replaced rather than accumulated. Browsers can manage sessions but cannot change the native listener.
- Relocate a recent repository when its folder moved, preserving its project assignment, open tabs, and expanded folders.
- Group related repositories into named OpenTig projects without moving anything on disk.
- Pull or push an individual repository from its row in the repository picker. Each row shows the repository name plus the branch that pull or push will use, and the worktree folder when that checkout is a linked worktree (the filesystem path is on the hover tooltip). When the repository has a favicon or app icon on disk (`favicon.svg`/`favicon.ico` at the root or under `public/`, `app/`, and similar locations, or a `<link rel="icon">` in `index.html`), that icon appears beside the name in the toolbar picker and in each row. Only pending operations are shown, each with its ahead/behind commit count; multiple repositories can sync concurrently, and their separate Sileo progress and outcome cards remain visible together. Opening the picker fetches each listed repository so those counts and checkouts match the remote, not a stale local cache.
- Fetch remotes in the background so toolbar ahead/behind counts stay current. The default interval is 30 seconds and can be raised, lowered, or turned off in **Settings → General**.
- Create, rename, delete, and reassign project groups.
- Switch quickly between repositories, branches, and available worktrees.
- Display current branch, ahead/behind state, and worktree insertion/deletion totals in the main toolbar.
- Coalesce overlapping watcher and manual refreshes, and keep the current diff mounted when a refresh changes only status or refs.
- Carry the OpenTig logo through the main toolbar, browser favicon, packaged Windows application, installer, and taskbar. In the toolbar the ring follows the theme text colour so it stays visible in light and dark, while the T stays brand blue. The favicon and Windows application icon place that mark on a dark rounded badge. The first painted frame is already that splash, inlined in `index.html`, so the window never opens on an empty sidebar. Desktop OpenTig reopens at the same position and size it had when last closed, including maximized; the splash fills that restored window instead of forcing a maximized first paint. Desktop and browser then keep the same splash until the workspace is restored.

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
- Every generation is recorded locally for diagnostics: harness, model, outcome, duration, the tokens and cost the harness reported, why a proposed split was refused, and, when a run fails, the error the harness returned. Only this metadata is stored; prompts and file contents never leave the repository.
- Review that history from **Settings → AI assistance → View history**, in a sortable table (click a column header to sort) that scrolls within the dialog, with totals for runs, failures, tokens, and reported cost, and clear it whenever you want.
- Record failed Git, file, and network operations locally for diagnostics: operation, error code, and a redacted message. Prompts and file contents are never stored. Review that history from **Settings → Diagnostics → View problems**, and clear it whenever you want.
- Undo the latest unpublished commit while keeping its changes staged. OpenTig verifies the expected commit and upstream state before rewriting history.

### Safe pull and push

- Pull by fast-forward when the branch has no local commits, or rebase those local commits onto the updated remote when the histories have diverged and there are no conflicts. The unpublished commits stay on top, ready to push. OpenTig does not create an implicit merge commit.
- If a rebase would conflict, abort it and leave the branch unchanged instead of stranding the repository mid-rebase.
- Preserve local changes through a temporary safety stash when pulling, including untracked files.
- Keep and report the recovery stash if changes cannot be restored cleanly.
- Refuse unsafe pull or push states such as unresolved conflicts, an active Git operation, or missing upstream configuration.
- Surface remote rejection, branch-protection, authentication, configuration, pending conflicts, and other one-shot operation failures as Sileo toasts rather than a persistent top banner. Pull and conflict updates for each repository share one finite-lived toast, deduplicated across refreshes and dismissed as soon as the conflicts are resolved, while the Changes view remains the persistent source of truth. Read-only Git operations still use an in-app banner.
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

- Search and switch between local and remote branches; selecting a remote branch creates or uses its local tracking branch. If local changes would be overwritten, OpenTig offers to move all tracked and untracked changes to the destination branch and leaves them unstaged. Conflicts open in the Changes view and retain a safety stash for recovery.
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
- Create a pull request or draft pull request from a wider, viewport-fitted dialog that keeps the draft toggle beside the base branch, the editor visible without an outer card scrollbar, and AI generation in the footer with its provider and model.
- Edit and preview the GitHub Markdown description before publishing.
- Require the current branch to be published and up to date before PR creation.
- Optionally generate an editable title and description from the branch diff with the selected local AI CLI. PR generation uses the same generous, fairly distributed diff budget as commit generation so large branches keep coverage across all changed files.

### Optional AI assistance

OpenTig supports locally installed Codex, Claude Code, and OpenCode CLIs. OpenCode 1 installs as `opencode` (`opencode-ai`); OpenCode 2 installs as `opencode2` (`@opencode-ai/cli`). OpenTig detects either binary and prefers OpenCode 1 when both are on `PATH`. It can:

- generate an editable commit message from staged changes;
- propose multiple focused commits, including their messages, reasons, and complete-file groups, when a split is clearly beneficial;
- generate an editable pull-request title and description from the current branch diff;
- detect installed providers, authentication state, and available models;
- identify Codex, Claude Code, and OpenCode with their provider marks in AI settings and show the selected provider and model together in the commit composer;
- keep large commit and pull-request analyses running for up to ten minutes without a generic transport timeout discarding a valid result;
- normalize harmless trailing periods in generated commit subjects instead of discarding an otherwise valid result;
- cancel an in-progress generation request, including when its client disconnects or its bounded execution window expires.

AI never creates a commit or pull request automatically. You review and edit the generated text before any Git or GitHub action occurs.

### Preferences

- Move smoothly between Settings sections with a short reduced-motion-aware transition while the navigation and dialog controls stay fixed.
- System, light, and dark themes.
- Interface and code fonts from **Settings → General**, each with its own dropdown. Interface: Geist, Plus Jakarta Sans, or Space Grotesk. Code: Geist Mono, JetBrains Mono, Inconsolata, Departure Mono, or Space Grotesk. Defaults are Geist and Inconsolata.
- Adjustable interface scale.
- Tree or list layout for changes.
- Optional line wrapping in viewers.
- Optional display of Git-ignored files.
- Per-provider AI model selection.
- Rebind most keyboard shortcuts from **Settings → Shortcuts**, with per-shortcut conflict detection and one-click reset to defaults; the shortcuts marked fixed below follow platform or file-manager conventions and cannot be changed.
- Turn off the double-tap-Control shortcut that brings OpenTig to the front from any application, also from **Settings → Shortcuts**.
- Phone browsers use a single workspace pane with persistent Changes, Files, History, PRs, and Search navigation. Open a row to review its content, use Back to return to the list, and open Commit to write a message without covering staging controls. Files have visible action menus, selection mode, filename search, and creation controls; repository, branch, worktree, settings, and diagnostics controls remain available on touch screens. Dialogs and forms fit the keyboard and safe areas, and AI history details open with a tap. Browser repository opening uses a server-path form. Phone diffs start unified with a session-only layout choice, preserving the saved desktop layout.
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
opencode2 auth login
```

Only install the tools you intend to use. GitHub functionality requires `gh`; AI features require at least one supported AI CLI.

## Run the headless CLI

Pin an exact version for repeatable or production use:

```powershell
npx --yes @opentig/cli@0.1.0
npx --yes @opentig/cli@0.1.0 serve
bunx @opentig/cli@0.1.0 serve
```

`opentig` and `opentig start` start the server and open its one-time pairing link. `opentig serve` does not open a browser. The CLI starts one project-independent OpenTig instance: repositories are added, opened, and switched exclusively from the web UI using paths on the server. After a global installation, a new device can request a fresh link from the same OS account with:

```powershell
opentig pair --home C:\path\to\opentig-home
```

`opentig help` and `opentig --help` show the complete command reference, examples, pairing/tunnel instructions, fixed-port behavior, and explicit Linux service commands.

Options are `--host`, `--port`, `--home`, and `--no-browser`, with `OPENTIG_HOST`, `OPENTIG_PORT`, and `OPENTIG_HOME` environment equivalents. Defaults are `127.0.0.1`, port `6767`, and `~/.opentig`. An occupied port fails clearly so reverse-proxy configuration remains predictable. The home contains private settings, hash-only sessions, a local-admin credential, credential-free runtime state, AI history, and rotating logs. SIGINT or SIGTERM closes WebSockets, the HTTP listener, watchers, Git/AI children, settings, and logs; a second signal forces exit.

Running through `npx` or `bunx` never installs startup persistence. On a Linux server with systemd, opt in explicitly after installing the CLI globally or invoking its executable:

```bash
opentig service install --host 127.0.0.1 --port 6767
opentig service status
opentig service uninstall
```

Installation stages the exact CLI/client version under the selected OpenTig home, uses that private home as its stable service working directory, enables a user service and user lingering, and keeps the listener on loopback unless `--host` says otherwise. It never binds the service to a repository. Windows and macOS service installers are not included yet.

For local tarball testing on Windows:

```powershell
npx --yes --package C:\absolute\path\opentig-cli-0.1.0.tgz opentig --help
bunx --package C:\absolute\path\opentig-cli-0.1.0.tgz opentig --help
```

Use `latest` only for evaluation after a public release. To upgrade or roll back production, stop the process and run a different pinned immutable version. OpenTig does not ship Docker, built-in TLS, Tailscale/SSH automation, multi-user roles, or server self-update.

## Run from source

```powershell
npx --yes npm@11.6.2 ci
npm start
```

`npm start` builds the shared server/client and Electron main/preload with Vite, then launches **OpenTig Dev**. Restart the command after source changes; this launcher does not provide live reload. Its data lives in the OS application-data directory under `OpenTig Dev` (normally `~/.config/OpenTig Dev` on Linux or `%APPDATA%/OpenTig Dev` on Windows), without copying or falling back to production data. The profile is selected before Electron takes its instance lock or opens a session. Development can run on Linux; Windows installers and Windows-specific behavior must still be verified on Windows.

For browser development on a Linux machine without a desktop session, run:

```bash
npm run start:web:dev
```

This builds the current server and web client, then starts **OpenTig Dev** without Electron at the fixed address `http://127.0.0.1:6867`. It prints a five-minute pairing code/link. Its persistent data is `~/.opentig-dev`, separate from both production CLI data (`~/.opentig`) and Electron Dev data, so the two runtimes never share writable settings. Production `OPENTIG_HOME`, `OPENTIG_HOST`, and `OPENTIG_PORT` values do not redirect this command; custom launch options are rejected. An occupied port fails instead of selecting another port. Stop it with `Ctrl+C`; after code changes, run the command again to rebuild (there is no live reload).

While it is running, generate a fresh code from another terminal:

```bash
npm run pair:web:dev
```

A Cloudflare Tunnel running on the same machine can route `dev.opentig.example.com` to `http://127.0.0.1:6867` and a separate production hostname to `http://127.0.0.1:6767`. Open `/pair` on the chosen HTTPS hostname and paste that instance's code; keep the listener on loopback and restrict the hostnames to your users with Cloudflare Access. This command does not install or configure Cloudflare or a background service. Browser checks cover the shared UI and server; native desktop integration and Windows installers still need separate validation.

For a persistent Linux tunnel endpoint, run the built Dev server as a **systemd user service**, so it stays running independently of a terminal or coding session. Create `~/.config/systemd/user/opentig-dev.service`, adjusting the checkout, Node executable, and CLI search paths for your machine:

```ini
[Unit]
Description=OpenTig Dev web server
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
WorkingDirectory=%h/jws/opentig
ExecStart=/usr/bin/node %h/jws/opentig/packages/server/dist/dev.mjs serve
Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=3
TimeoutStopSec=15
UMask=0077
StandardOutput=null
StandardError=journal

[Install]
WantedBy=default.target
```

After building with `npm run build:server`, run `systemctl --user daemon-reload` and `systemctl --user enable --now opentig-dev.service`. Enable user lingering with `loginctl enable-linger "$USER"` if the service should start at boot and survive logout. Startup pairing output is discarded; use `npm run pair:web:dev` whenever you need a new code. Inspect the service with `systemctl --user status opentig-dev.service` and `journalctl --user -u opentig-dev.service`. After rebuilding, use `systemctl --user restart opentig-dev.service`; it keeps the same `~/.opentig-dev` data and browser sessions. Do not run `start:web:dev` alongside the service on the same port. A healthy Cloudflare connector still returns a gateway error if this application service is stopped.

Run all quality gates:

```powershell
npm run check
```

Build a separate Dev application to evaluate local changes or a checked-out PR:

```bash
npm run package:dev
npm run verify:packaged-desktop -- --dev
npm run verify:packaged-server -- --dev
```

On Linux x64 the executable is `out/OpenTig Dev-linux-x64/OpenTig Dev`; on Windows x64 it is `out/OpenTig Dev-win32-x64/OpenTig Dev.exe`. The Dev identity is baked into the build, so moving the executable does not change its profile. All local Dev builds share the same Dev data; use a separate worktree for a PR's source and test repository changes in a disposable clone. Dev isolates application data, not your actual repositories or authenticated Git/GitHub/AI CLIs.

Desktop packages use **electron-builder**; Vite remains the compiler. The web client is built once and served by the included server in both Electron and browser sessions. Only the Electron runtime dependencies are shipped, with native N-API binaries and platform Trash executables unpacked from ASAR.

`npm run make:dev` creates a **portable Dev ZIP** for the current OS. Extract the complete ZIP before launching; it needs no installer, but still stores settings in the separate OS Dev data directory. It has no updater or stable update feed. Artifacts are written under `out/make/dev/<platform>-<arch>/`.

Build the stable Windows x64 application and **NSIS installer** on Windows:

```powershell
npm run package
npm run make
npm run verify:packaged-desktop
npm run verify:packaged-server
npm run verify:packaged-utility
npm run verify:packaged-trash
```

The executable is `out/OpenTig-win32-x64/OpenTig.exe`; the installer is `out/make/production/win32-x64/OpenTig-<version>-win32-x64-Setup.exe`. The one-click installer installs for the current user, creates desktop/Start menu shortcuts, and preserves application data on uninstall. Stable keeps the `OpenTig` identity and existing production data location. An existing Squirrel installation is not automatically migrated or removed; installer migration and Windows behavior must be checked on Windows before release.

To cross-build Windows targets from Linux, pass `-- --platform=win32 --arch=x64` to `package`, `make`, `package:dev`, or `make:dev`. Building NSIS on Linux also requires a working Wine installation and its runtime libraries, such as the environment in the electron-builder `electronuserland/builder:wine` container. ZIP builds do not need Wine. Use the same target flags with `verify:packaged-desktop` to inspect an artifact without executing it. The utility/Trash checks must run on the target OS with a graphical Electron environment; add `-- --dev` for Dev packages. `package` alone creates an unpacked application for the current OS; stable `make` is deliberately limited to the planned Windows x64 installer.

With dependencies already installed in the Linux checkout, the NSIS build can run in that container without installing Wine on the host:

```bash
docker run --rm --init --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/opentig-builder-home \
  -v "$PWD:$PWD" -w "$PWD" \
  electronuserland/builder:wine \
  bash -c 'mkdir -p "$HOME" && npm run make -- --platform=win32 --arch=x64'
```

Each package includes `opentig-build.json` with its profile, target and distribution (`directory`, `zip`, or `installer`), plus signed-release provenance and the update repository. The updater also checks the NSIS per-user installation registration against the current executable directory. Local commands never publish artifacts. Unsigned local installers are candidates without an update feed; only `make -- --release` enables the release feed and requires code signing.

## Desktop builds and releases on GitHub

**Next release draft** runs on every push to `main`, including direct commits and merged PRs. It creates one unpublished release draft on the first change after a stable release and refreshes its notes on subsequent pushes. Notes cover first-parent history since the highest published stable version, grouped into features, fixes, and maintenance, with commit links and PR links for GitHub merge/squash messages. Merge commits represent their PR once; rebased changes remain individual commits. Prereleases do not reset the stable changelog. Before the first release, the draft uses the package version and includes the existing history.

The next version defaults to a patch increment (`0.1.0` → `0.1.1`). A higher version in `package.json`, or a higher version chosen on the managed draft, takes precedence without creating another draft. This proposal does not change package files or create a Git tag. You can edit the release title and add prose outside the `opentig:release-notes` comment markers; automatic refreshes preserve those edits and replace only the generated block. Drafting is independent of CI success and does not build installers or notify installed clients. It runs only on upstream `main`, uses the built-in Actions token, and needs no additional secret.

To prepare a release, align the root and server package versions and lockfile with the draft version, merge/push that commit, then create and push the matching `vX.Y.Z` tag. Installer build/signing automation is configured separately and can attach binaries to that same draft while preserving its notes. Once a tag exists or assets are attached, automatic note updates freeze until that release is published, so later commits cannot change the notes for a built installer. Review notes, validate Windows, and publish deliberately; the next push to `main` starts the next draft and includes all changes since the published tag. **Next release draft** can also be rerun manually on `main` to reconcile changes already there. Draft creation alone does not produce an installable release; publish only after the release assets and validation are complete.

## Local-first and security model

- Repository contents are read from and written to their existing local paths.
- The renderer has no direct Node.js, filesystem, or process access.
- Git, filesystem, persistence, AI, and GitHub operations run through one typed, validated WebSocket command boundary in both desktop and browser clients. Requests have correlation IDs, cancellation and timeouts; interrupted operations are rejected rather than replayed after reconnect.
- The private server transport binds to loopback by default, requires an owner session for commands and image bytes, validates exact mutation/WebSocket origins, and blocks static-file traversal and symlink escape. Enabling **Settings → Network access** persists a desktop-only setting and restarts that same backend on `0.0.0.0`; disabling it returns to `127.0.0.1`. OpenTig never starts a second Web Access server.
- New browsers pair through a five-minute, one-use URL fragment displayed as a link and local QR code; the fragment is cleared before exchange. Paired browsers receive a cookie and server session lasting 30 days, renewed automatically when the app connects, resumes in the foreground, and hourly while visible. Renewal extends both the cookie and server session without another pairing code or interrupting connected tabs; temporary network failures retry. Closing the browser or restarting the server preserves access. After 30 days without a successful renewal, the server rejects the expired credential and disconnects expired browser connections. Expiry, clearing site cookies, or revoking access requires a new code; renewal cannot restore expired or revoked access. Desktop bootstrap cookies remain session-only. Steady-state credentials use host-only `HttpOnly`, `SameSite=Strict` cookies, only credential hashes are persisted, and revoking all sessions disconnects paired browsers while replacing the private desktop session. Network access grants owner-level file, Git, GitHub, and AI CLI authority as the OS user: use only a trusted LAN or VPN, an HTTPS reverse proxy, or an SSH tunnel, and never expose the raw port publicly.
- Headless `pair` authenticates over a same-host-only administrative route using a separate private file under `~/.opentig/server`; `runtime.json` contains PID/address/version identity but no credential. Pairing secrets remain memory-only and appear only in the deliberate one-time terminal output/URL fragment, never in arguments, environment variables, routine logs, query strings, or persisted state.
- Electron starts the backend after readiness on preferred port `6767`, scanning a bounded range upward only when that implicit port is occupied. Dev instead scans `6867`–`6876`, while production scans `6767`–`6776`; each keeps its selected port when Network access is toggled. Distinct session-cookie names let both profiles stay paired in the same browser on the same host, and revocation affects only that profile. If its range is full, startup fails rather than switching to the other profile. Its one-use desktop bootstrap secret crosses the private parent/utility message port exactly once; it is absent from process arguments, environment variables, renderer JavaScript, and redacted rotating logs. Unexpected exits restart one utility process on the same selected port.
- The narrow preload bridge contains only proven desktop capabilities such as folder selection/relocation, file clipboard import, Explorer reveal, title-bar theming, and zoom. Text clipboard access stays in the renderer's browser API.
- Git commands use argument arrays with `shell: false`, bounded output, timeouts, path validation, and per-repository write serialisation.
- External links are allowlisted to `http(s)://` and `mailto:` before Electron's window-navigation interception opens them in the system browser.
- HTML previews run in a sandbox; rendered Markdown is sanitised before display.
- OpenTig does not read or persist GitHub or AI API tokens. Connected CLIs manage their own authentication.

## AI privacy

For commit-message generation, OpenTig sends the selected local AI CLI only a bounded staged diff, its summary, staged paths, the branch name, and up to ten recent commit subjects. It does not include unstaged content; untracked files are included only after you stage them.

Multi-commit proposals are accepted only when they partition every staged path exactly once. OpenTig preserves its generous, fairly distributed patch budget for large staged changes; a trimmed individual diff can still be grouped from the complete path list and summary. Proposals remain blocked when the complete file set cannot be trusted, such as partially staged files or staged renames, and OpenTig verifies that the staged snapshot has not changed before preparing the first group. Preparing a group changes only the Git index; every commit still requires an explicit review and confirmation.

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
