# OpenTig CLI

**A focused workspace for your Git repositories.**

Browse files, review diffs, make edits, and commit changes. Work with branches, worktrees, and GitHub pull requests from the same interface. The CLI runs the OpenTig server on the machine with your repositories and serves its UI to a paired browser, without Electron.

[Website](https://opentig.com/) · [Installation](https://opentig.com/docs/getting-started/#run-the-headless-cli) · [Documentation](https://opentig.com/docs/) · [Source](https://github.com/jorgefl8/opentig) · [Report a bug](https://github.com/jorgefl8/opentig/issues)

![OpenTig reviewing a TypeScript split diff in a demo repository](https://raw.githubusercontent.com/jorgefl8/opentig/main/docs/images/workspace.png)

*The browser UI in the Dev build, reviewing a small demo repository.*

> **Early development.** I'm building OpenTig for my own daily workflow and sharing it as it takes shape. Expect bugs, rough edges, and changes. Keep important work backed up and review Git and file operations before confirming them.

## Start locally

Works on **macOS, Linux, and Windows** with **Node.js 24+** and **Git** installed.

```bash
npx --yes @opentig/cli@latest
```

This starts OpenTig at `127.0.0.1:6767` and opens a one-use browser pairing link. Choose an existing repository in the visual folder picker and start reviewing. Repositories are managed in the UI; you do not need to start a separate server for each one.

Prefer Bun's package runner?

```bash
bunx @opentig/cli@latest
```

Plain `bunx` launches the Node-shebang executable. **Node.js 24+ is still required**; running OpenTig under the Bun runtime itself is not supported.

Or install globally:

```bash
npm install -g @opentig/cli@latest
opentig
```

## What you can do

| | |
| --- | --- |
| **Review changes** | Split or unified diffs, staged and unstaged files, and merge-conflict resolution. [Details](https://opentig.com/docs/features/#changes-diffs-and-commits) |
| **Browse and edit** | File tree, tabs, quick edits, find and replace, repository search, and Markdown, image, HTML, and SVG previews. [Details](https://opentig.com/docs/features/#files-and-editing) |
| **Work with Git** | Stage files, commit, pull and push, inspect history, and switch branches and worktrees. [Details](https://opentig.com/docs/features/#safe-pull-and-push) |
| **Organize repositories** | Recent repositories, project groups, and manual relocation without moving files. [Details](https://opentig.com/docs/features/#repositories-and-projects) |
| **Review GitHub PRs** | Browse pull requests, inspect changes, and prepare new PRs through your authenticated `gh` CLI. [Details](https://opentig.com/docs/features/#github-pull-requests) |
| **Use a remote server** | Pair a browser on your laptop or phone and work with repositories on the server. [Details](https://opentig.com/docs/web-access/) |

**AI is optional.** Normal Git work needs no AI account or OpenTig account. If you choose to use AI assistance, a supported CLI installed and authenticated on the host can draft commit messages and pull-request descriptions for you to review. The selected CLI may send the supplied context to its provider. OpenTig does not run an autonomous coding agent or create commits on its own. See the [feature guide](https://opentig.com/docs/features/) and [privacy details](https://opentig.com/docs/security-and-privacy/).

## Run on a remote server

Start without opening a browser:

```bash
npx --yes @opentig/cli@latest serve
```

Server mode is designed for personal access through **Cloudflare Tunnel**, a **private network such as Tailscale**, or an SSH tunnel. The default listener stays on `127.0.0.1:6767`, which a tunnel or HTTPS reverse proxy on the same machine can reach. For direct private-network access, bind to its interface with `--host`; alternatively, keep loopback and use a private HTTPS proxy such as Tailscale Serve. Tunnel and VPN setup are managed separately from OpenTig.

Pair your browser with the one-use code printed on the server. The visual folder picker selects **folders on the server**, not on your laptop or phone.

After a global installation, run `opentig pair` as the same OS user to generate a fresh five-minute pairing code for the running instance. If you use a custom data directory, pass the same `--home` value.

Paired browsers have the host user's filesystem, Git, and configured CLI authority. Keep access private and do not expose the raw HTTP port publicly. See [remote access and pairing](https://opentig.com/docs/web-access/) for SSH and reverse-proxy examples.

## Keep a background server running

After installing globally, opt into a background service on Linux, macOS, or Windows:

```bash
opentig service install --host 127.0.0.1 --port 6767
opentig service status
opentig service restart
```

The service uses a persistent runtime outside the temporary package cache and starts independently of any repository. Running `npx` or `bunx` alone never installs a background service. Use `opentig service uninstall` to remove it. Linux uses systemd with lingering and starts at boot. macOS uses a user LaunchAgent and Windows uses a Task Scheduler task for the current user; these start at login and stop at logout. Keep the machine awake for remote access. This service is independent of the desktop app. `service install` starts it immediately and, in an interactive terminal, asks whether to pair a device now; do not run `serve` as a second step for the same home. Installation checks for an occupied effective listener before registering the service and reports how to resolve conflicts. See [command errors and recovery](https://github.com/jorgefl8/opentig/blob/main/docs/getting-started.md#command-errors-and-recovery).

Managed services on all three platforms can **download updates and restart from the browser UI**. Those updates replace the service's runtime, without changing the global npm package. For foreground instances, stop the process and start the desired package version. Pin an exact version instead of `latest` for repeatable deployments. See [installation, services, and updates](https://opentig.com/docs/getting-started/).

## Configuration and scope

Run `opentig --help` for commands and options. Configure `--host`, `--port`, and `--home`, or their `OPENTIG_HOST`, `OPENTIG_PORT`, and `OPENTIG_HOME` environment equivalents. Data is stored under `~/.opentig` by default. An occupied port fails clearly instead of silently changing the address.

OpenTig opens existing repositories. Cloning and initial remote setup remain Git CLI tasks. Built-in TLS, multi-user roles, and automatic SSH or tunnel setup are not included.

The separate [desktop installer](https://github.com/jorgefl8/opentig/releases/latest) is currently available for Windows x64 only. **macOS and Linux users can use this CLI and the browser UI today.**

## License

[MIT](https://github.com/jorgefl8/opentig/blob/main/LICENSE). Bundled third-party assets retain their own licences; see [third-party notices](https://opentig.com/docs/third-party-notices/).
