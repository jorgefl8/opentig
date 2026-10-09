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

Use the Windows desktop app or run the CLI on another machine and reach the same UI from a browser, including on your phone. Repositories and commands stay on the machine running OpenTig, using its Git installation.

## What you can do

| Workflow | Features |
| --- | --- |
| [Review changes](docs/features.md#changes-diffs-and-commits) | Syntax-highlighted split or unified diffs, staging, commits, and merge-conflict resolution. |
| [Browse and edit](docs/features.md#files-and-editing) | File tabs, find and replace, repository search, and Markdown, image, HTML, and SVG previews. |
| [Work with Git](docs/features.md#safe-pull-and-push) | Safe pull and push, branch publication, commit graphs, branches, and worktrees. |
| [Keep repositories together](docs/features.md#repositories-and-projects) | Saved repositories, project groups, and relocation without moving files. |
| [Review GitHub PRs](docs/github.md) | PR details and diffs, native stacks, account selection, and new PRs through the GitHub CLI. |
| [Use a remote server](docs/web-access.md) | Browser pairing, trusted remote access, and a touch-friendly phone interface. |

**AI is optional.** Reviewing, editing, and committing need no AI account. Locally installed Codex, Claude Code, OpenCode 2, or Grok Build can draft commit messages, propose commit splits, and write PR descriptions. You review and confirm every commit or PR. See [AI assistance](docs/ai-assistance.md) and [AI privacy](docs/security-and-privacy.md#ai-privacy).

## Choose how to run it

| Option | Available today |
| --- | --- |
| **Desktop app** | Windows x64 installer, with in-app updates. Linux and macOS desktop installers are not published yet. |
| **CLI + browser** | Linux, macOS, and Windows with Node.js 24+ and Git. |
| **Background server** | Linux (systemd), macOS (launchd), and Windows (Task Scheduler), with browser-based updates. |

### Windows desktop

Download the `OpenTig-…-win32-x64-Setup.exe` installer from the [latest release](https://github.com/jorgefl8/opentig/releases/latest). Git must be available on your machine.

> [!WARNING]
> The Windows installer is currently **unsigned**, so Windows may show an unknown-publisher or SmartScreen warning.

### Run in your browser

With **Node.js 24+** and **Git** installed:

```bash
npx --yes @opentig/cli@latest
```

This starts OpenTig locally and opens a one-use browser pairing link. Choose an existing repository in the UI.

For a server without a desktop:

```bash
npm install -g @opentig/cli@latest
opentig serve
```

The server listens on `127.0.0.1:6767` by default. Pair with the code printed on the server; the folder picker selects folders **on that server**. Use a private network, SSH tunnel, or HTTPS proxy such as Cloudflare Tunnel for remote access. Paired browsers have the host user's authority: keep access private and do not expose the raw port publicly.

Use `opentig service install` to keep the CLI running after closing the terminal. In the desktop app, enable browser pairing separately in **Settings → Web access**. See [installation, services, and updates](docs/getting-started.md) and [remote access and pairing](docs/web-access.md).

## Documentation and contributing

OpenTig opens existing repositories; cloning and initial remote setup remain Git CLI tasks. GitHub features require `gh` on the host. Normal Git work needs no OpenTig account or hosted backend; optional AI can send the supplied context to its provider.

- [Feature guide](docs/features.md): daily workflows, history, branches, editing, and shortcuts.
- [Interface and mobile use](docs/interface.md): themes, settings, touch controls, and navigation.
- [Security and privacy](docs/security-and-privacy.md): permissions, browser authority, and AI context.
- [Development and packaging](docs/development.md): source setup, isolated Dev profiles, and validation.
- [Contributing](CONTRIBUTING.md) and [documentation index](docs/README.md).

Feedback, bug reports, and focused contributions are welcome. Building from source requires Node.js 24.15 or newer.

## License

[MIT](LICENSE). Bundled third-party assets retain their own licences; see [third-party notices](THIRD_PARTY_NOTICES.md).
