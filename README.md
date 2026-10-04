<div align="center">

<h1><img src="public/opentig.svg" alt="" width="36" height="36" align="absmiddle"> OpenTig</h1>

**A focused workspace for reviewing code changes.**

Browse files, inspect diffs, edit, stage, and commit on your computer or a remote server.

[Download for Windows](https://github.com/jorgefl8/opentig/releases/latest) · [Run in your browser](#run-in-your-browser) · [Documentation](docs/README.md) · [Report a bug](https://github.com/jorgefl8/opentig/issues)

</div>

![OpenTig reviewing a TypeScript split diff in a demo repository](docs/images/workspace.png)

*The browser UI in the Dev build, reviewing a small demo repository.*

> [!IMPORTANT]
> **Early development.** I'm building OpenTig for my own daily workflow and sharing it as it takes shape. Expect bugs, rough edges, and changes. Keep important work backed up and review Git and file operations before confirming them.

## A small workspace for the Git loop

Open a repository, understand what changed, make a quick edit, and commit the work you meant to commit. OpenTig brings the file browser, editor, diffs, and Git controls together in one compact interface.

It works with existing repositories using the Git installation on the host. You can use the Windows desktop app or run the CLI on another machine and reach the same UI from a browser, including on your phone. Repositories and commands stay on the machine running OpenTig.

On phones, a compact repository header and bottom navigation leave more room for files and code. Tap the repository context to change branch or worktree, sync, or open Settings; use the open-files button to switch or close tabs. Mobile Pull and Push show pending commit counts and stay disabled when up to date; unpublished branches can still be published. Notifications leave the bottom navigation and open sheets accessible. Files open one folder at a time with breadcrumbs, a folder filter, visible action menus, and multiple selection. Background refreshes keep the current folder visible and preserve its scroll position. Use **Move to…** to choose a destination without dragging: touch and pen gestures scroll, while mouse dragging stays available on desktop. The commit form opens separately from staging, and mobile history uses larger rows. Short landscape phone screens retain the mobile layout; the navigation steps aside when the software keyboard is open.

**AI is optional.** Reviewing, editing, and committing do not require an AI account. If you choose to use it, your installed CLI can draft commit messages and pull-request descriptions for you to review. OpenTig does not run an autonomous coding agent or create commits on its own. The official Grok Build CLI also supports commit messages, split proposals, and pull-request drafts, with model selection, cancellation, and usage history. It requires Grok Build 1.0.46 or later in the 1.x series and `grok login` or `XAI_API_KEY`. Grok uses an isolated temporary profile with its built-in models; custom CLI configuration is excluded. See [AI privacy](docs/security-and-privacy.md#ai-privacy) for execution controls and cleanup.

Settings → AI assistance → **Check again** discovers CLIs installed after OpenTig starts, including native user locations such as `~/.opencode/bin`, `~/.grok/bin` and `~/.local/bin`, common package-manager launchers, and refreshed user PATH entries. Discovery and execution share the same environment; an older or broken installation does not hide a later compatible one. Each harness reports missing, unusable, incompatible and authentication states independently. The AI settings dialog uses a wider desktop layout with a responsive provider grid. Its **Advanced CLI detection** accordion shows the selected path and its source, lets you save an absolute executable path per harness or reset it to Automatic. User-environment refresh is automatic. If it fails or exceeds its five-second timeout, detection continues with the inherited environment and known installation locations. On Linux and macOS, refresh runs Bash, Zsh or Fish startup files; on Windows it reads the saved user and machine environment. Custom paths belong to the backend host, including when using a browser. Existing services do not need reinstalling. Windows does not automatically use CLIs installed inside WSL; run the backend inside WSL to use that environment.

File removal uses system Trash with literal paths. The Trash dependency is temporarily pinned to 9.0.0 to avoid an unpatched transitive vulnerability; when the backend runs inside WSL, it uses Linux Trash. See [third-party notices](THIRD_PARTY_NOTICES.md#trash) for the dependency details.

## What you can do

| | |
| --- | --- |
| **Review changes** | Syntax-highlighted split or unified diffs, staged and unstaged files, and merge-conflict resolution. [Details](docs/features.md#changes-diffs-and-commits) |
| **Browse and edit** | File tree, tabs, quick edits, find and replace, repository search, and Markdown, image, HTML, and SVG previews. Markdown images load relative to the document within the repository, including PNG and SVG files. Code, diffs, and merge conflicts share syntax detection for nested Dockerfiles and Makefiles, uppercase extensions, XML project files, JSON with comments, environment files, Git configuration, and installer scripts. [Details](docs/features.md#files-and-editing) |
| **Work with Git** | Stage files, commit, pull and push, publish branches with or without new commits, inspect compact commit graphs with publication colors and PR references, and switch branches and worktrees. Pull and push keep their own progress and result notifications, independently of AI messages. Resolving conflicts dismisses the repository’s conflict notice without closing an in-progress pull. Publishing sets the upstream and lets you choose a remote when needed. [Details](docs/features.md#safe-pull-and-push) |
| **Keep repositories together** | Recent repositories, project groups, and manual relocation without moving files. The repository dialog has a plain heading and offers location shortcuts, recent checkouts, breadcrumbs, folder filtering, hidden-folder controls, and Git detection with branch labels. Select a repository before opening it, or use the pencil button or Ctrl+L to edit its path, then browse with Enter or the arrow button; desktop users can also use the native folder picker. [Details](docs/features.md#repositories-and-projects) |
| **Review GitHub PRs** | Open the repository on GitHub from the toolbar between Refresh and Settings, and see and open the current branch’s open PR (including drafts) beside the branch selector. The repository link works without `gh`; PR detection uses your authenticated `gh` CLI and refreshes every minute or on manual refresh. Browse pull requests, inspect their changes, and prepare new PRs. [Details](docs/features.md#github-pull-requests) |
| **Use a remote server** | Run without Electron, pair your browser, and work with repositories on the server. Browsers without a valid session see pairing instructions without a startup error notification. A single persistent notification tracks connection problems and disappears when you reconnect. [Details](docs/web-access.md) |

The interface defaults to **Plus Jakarta Sans**, with **JetBrains Mono** for code. Dates throughout the interface use **DD/MM/YYYY**, including history, commits, branches, worktrees, pull requests, logs, updates, and browser sessions. Timestamps retain the local time in 24-hour format; pairing expiry dates in the CLI use the same format. Settings → General groups appearance, files and repository sync into compact rows, with separate font selectors and a text preview; changes apply immediately and existing selections are preserved. Remote checks offer common intervals or a custom value from 5 to 300 seconds, in steps of 5, plus Off for manual checks. The toolbar Refresh button and Ctrl+R fetch remote Git changes even when automatic checks are off, then refresh the local workspace. They also check for app updates immediately, without waiting for the five-minute update interval. Diffs and file editors keep the active interface background while sharing syntax colors with Markdown previews, regardless of which view opens first. Repository, worktree, branch, AI model, project assignment, and pull-request base dropdowns share a compact, searchable layout that follows the active light or dark theme. A small gap between options keeps selected and hovered rows visually distinct. Repositories and worktrees retain a second line for their checkout; other options use a single line, with larger touch targets on phones. Toolbar dropdowns keep a fixed management action, while models can be searched by name or identifier and grouped by provider. Default (CLI) and No project remain available when filtering. Repository number shortcuts remain available until you focus the search field.

The [full feature guide](docs/features.md) covers these workflows, optional AI assistance, preferences, and keyboard shortcuts.

History keeps the existing sidebar sections and opens commits, files, and GitHub PR references in the right-hand viewer. Switch row density, search loaded commits without losing graph context, or group complete merge branches. Theme colors distinguish local commits (amber), published work and merge branches (OpenTig blue), and the locally known base branch (neutral gray); squash histories stay linear. [History details](docs/features.md#history)

GitHub PRs show native stack positions such as **2/3**. Open the indicator in the list or right-hand viewer to navigate between layers and see their states and base branch. Stack details load on demand; a failed refresh keeps previously loaded layers available with a notice. Stack navigation is read-only.

## Choose how to run it

| | Available today |
| --- | --- |
| **Desktop app** | Windows x64 installer, with in-app updates. Linux and macOS desktop installers are not published yet. |
| **CLI + browser** | Linux, macOS, and Windows with Node.js 24+ and Git. |
| **Background server** | Linux (systemd), macOS (launchd), and Windows (Task Scheduler), with browser-based updates. |

### Windows desktop

Download the `OpenTig-…-win32-x64-Setup.exe` installer from the [latest release](https://github.com/jorgefl8/opentig/releases/latest). Git must be available on your machine.

Settings → Updates links to the installed stable version’s release notes on GitHub, even when no update is available. When a new release is offered, its notes have a separate link labeled with the update version.

> [!WARNING]
> The Windows installer is currently **unsigned**, so Windows may show an unknown-publisher or SmartScreen warning.

### Run in your browser

With **Node.js 24+** and **Git** installed:

```bash
npx --yes @opentig/cli@latest
```

This starts OpenTig locally and opens a one-use browser pairing link. Then choose an existing repository in the UI.

For a server without a desktop:

```bash
npm install -g @opentig/cli@latest
opentig serve
```

Server mode is designed for personal access through **Cloudflare Tunnel**, a **private network such as Tailscale**, or an SSH tunnel. The server listens on `127.0.0.1:6767` by default. A tunnel or HTTPS reverse proxy on the same machine can reach this address without enabling LAN access. For direct access over a private network, bind to its interface with `--host`; alternatively, keep loopback and use a private HTTPS proxy such as Tailscale Serve. OpenTig does not configure these services for you. See [remote access](docs/web-access.md) for setup details.

Pair your browser using the code printed on the server. The folder picker selects **folders on that server**, not on your laptop or phone.

To keep the CLI running after closing the terminal, use `opentig service install`. Linux starts it at boot with lingering; macOS and Windows start it at login and stop it at logout. This CLI service is independent of the desktop app.

See [installation and CLI](docs/getting-started.md) for pinned versions, background service setup, and updates, or [remote access](docs/web-access.md) for connection examples. Paired browsers have the host user's authority: keep access private and do not expose the raw port publicly.

## Where things stand

OpenTig is a young Git client with a built-in editor, not a VS Code fork or a full IDE. It opens existing repositories; cloning and initial remote setup are still Git CLI tasks. GitHub features require `gh`. Optional AI features use Codex, Claude Code, or OpenCode 2 installed and authenticated on the host.

Normal Git work needs no OpenTig account or hosted backend. If you request AI assistance, the selected CLI may send the supplied context to its provider. Read the [security and privacy guide](docs/security-and-privacy.md) for the details.

Feedback, bug reports, and contributions are welcome. Development supports running tests related to changed source files; CI skips heavy jobs for prose-only documentation changes and cancels superseded PR runs. See [CONTRIBUTING.md](CONTRIBUTING.md), [development setup](docs/development.md), and the [documentation index](docs/README.md).

## License

[MIT](LICENSE). Bundled third-party assets retain their own licences; see [third-party notices](THIRD_PARTY_NOTICES.md).
