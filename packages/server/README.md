# OpenTig CLI

**A focused workspace for reviewing code changes, in your browser.**

Browse files, inspect diffs, edit, stage, and commit on your computer or a remote server. The CLI serves the same UI as the OpenTig desktop app, without Electron.

[Source](https://github.com/jorgefl8/opentig) · [Documentation](https://github.com/jorgefl8/opentig/blob/main/docs/README.md) · [Report a bug](https://github.com/jorgefl8/opentig/issues)

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
| **Review changes** | Split or unified diffs, staged and unstaged files, and merge-conflict resolution. [Details](https://github.com/jorgefl8/opentig/blob/main/docs/features.md#changes-diffs-and-commits) |
| **Browse and edit** | File tree, tabs, quick edits, find and replace, repository search, and Markdown, image, HTML, and SVG previews. [Details](https://github.com/jorgefl8/opentig/blob/main/docs/features.md#files-and-editing) |
| **Work with Git** | Stage files, commit, pull and push, inspect history, and switch branches and worktrees. [Details](https://github.com/jorgefl8/opentig/blob/main/docs/features.md#safe-pull-and-push) |
| **Organize repositories** | Recent repositories, project groups, and manual relocation without moving files. [Details](https://github.com/jorgefl8/opentig/blob/main/docs/features.md#repositories-and-projects) |
| **Review GitHub PRs** | Browse pull requests, inspect changes, and prepare new PRs through your authenticated `gh` CLI. [Details](https://github.com/jorgefl8/opentig/blob/main/docs/features.md#github-pull-requests) |
| **Use a remote server** | Pair a browser on your laptop or phone and work with repositories on the server. [Details](https://github.com/jorgefl8/opentig/blob/main/docs/web-access.md) |

**AI is optional.** Normal Git work needs no AI account or OpenTig account. If you choose to use AI assistance, a supported CLI installed and authenticated on the host can draft commit messages and pull-request descriptions for you to review. The selected CLI may send the supplied context to its provider. OpenTig does not run an autonomous coding agent or create commits on its own. See the [feature guide](https://github.com/jorgefl8/opentig/blob/main/docs/features.md) and [privacy details](https://github.com/jorgefl8/opentig/blob/main/docs/security-and-privacy.md).

## Run on a remote server

Start without opening a browser:

```bash
npx --yes @opentig/cli@latest serve
```

The default listener stays on `127.0.0.1:6767`. Reach it through an SSH tunnel or an HTTPS reverse proxy, then pair your browser with the one-use code printed on the server. The visual folder picker selects **folders on the server**, not on your laptop or phone.

After a global installation, run `opentig pair` as the same OS user to generate a fresh five-minute pairing code for the running instance. If you use a custom data directory, pass the same `--home` value.

Paired browsers have the host user's filesystem, Git, and configured CLI authority. Keep access private and do not expose the raw HTTP port publicly. See [remote access and pairing](https://github.com/jorgefl8/opentig/blob/main/docs/web-access.md) for SSH and reverse-proxy examples.

## Keep a Linux server running

After installing globally, Linux users with systemd can opt into a background service:

```bash
opentig service install --host 127.0.0.1 --port 6767
opentig service status
```

The service uses a persistent runtime outside the temporary package cache and starts independently of any repository. Running `npx` or `bunx` alone never installs a background service. Use `opentig service uninstall` to remove it. Service installation for macOS and Windows is not included yet.

Managed Linux services can **download updates and restart from the browser UI**. Those updates replace the service's runtime, without changing the global npm package. For foreground instances, stop the process and start the desired package version. Pin an exact version instead of `latest` for repeatable deployments. See [installation, services, and updates](https://github.com/jorgefl8/opentig/blob/main/docs/getting-started.md).

## Configuration and scope

Run `opentig --help` for commands and options. Configure `--host`, `--port`, and `--home`, or their `OPENTIG_HOST`, `OPENTIG_PORT`, and `OPENTIG_HOME` environment equivalents. Data is stored under `~/.opentig` by default. An occupied port fails clearly instead of silently changing the address.

OpenTig opens existing repositories. Cloning and initial remote setup remain Git CLI tasks. Built-in TLS, multi-user roles, and automatic SSH or tunnel setup are not included.

The separate [desktop installer](https://github.com/jorgefl8/opentig/releases/latest) is currently available for Windows x64 only. **macOS and Linux users can use this CLI and the browser UI today.**

## License

[MIT](https://github.com/jorgefl8/opentig/blob/main/LICENSE). Bundled third-party assets retain their own licences; see [third-party notices](https://github.com/jorgefl8/opentig/blob/main/THIRD_PARTY_NOTICES.md).
