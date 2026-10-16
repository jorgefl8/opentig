# Installation and CLI

[← Documentation](README.md)

Choose where OpenTig will run. Your repositories stay on that machine, whether you use the desktop app or connect through a browser.

- **Windows desktop:** [install the Windows app](#windows-desktop).
- **Linux, macOS, or Windows CLI:** [start the server](#run-the-headless-cli) and use the same interface in a paired browser.
- **Keep the CLI running after closing your terminal:** [install a background service](#background-services).

## Requirements

- **Desktop:** Windows 10 or later, x64, and Git installed on the host.
- **CLI:** Linux, macOS, or Windows, with Node.js 24 or later and Git on `PATH`.
- **Build from source:** Node.js 24.15 or later and npm 11 or later. See [development and packaging](development.md).

Linux and macOS desktop installers are not published yet. The CLI supports background services and browser updates on all three platforms.

GitHub and AI tools are optional. Install only the integrations you want to use; [their setup is below](#optional-integrations).

## Windows desktop

1. Install Git if it is not already available on your machine.
2. Download and run the Windows x64 installer from the [latest release](https://github.com/jorgefl8/opentig/releases/latest).
3. Open OpenTig and choose a repository on that machine.

### Windows SmartScreen warning

**The installer is currently unsigned.** Microsoft Defender SmartScreen may show **Windows protected your PC** because the download has not established sufficient reputation. Windows may also identify the publisher as unknown. A reputation warning alone does not mean malware was detected, and it is not a guarantee that the file is safe.

Download OpenTig from [opentig.com](https://opentig.com) or the [official GitHub releases](https://github.com/jorgefl8/opentig/releases). If Windows reports a specific threat, treat that separately from a reputation warning. Smart App Control or your organization's policies may block unsigned apps entirely.

See [Microsoft's explanation of SmartScreen and app reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

### Update the desktop app

Open **Settings → Updates** to check for a new stable version, see download progress, and read release notes. The update icon beside Settings, or on the welcome screen, also lets you download an update and choose **Restart and install**.

Downloading an update does not install it when you close the app normally. **Restart and install** first lets you handle edited files, then shuts down the backend and settings safely.

<details>
<summary>Automatic checks, update icons, and release notes</summary>

Installed stable Windows releases check at startup, every five minutes, and when the window regains focus if the last attempt was at least five minutes ago.

The update icon shows:

- A notification dot when a download is available.
- A progress ring while downloading.
- A check badge when the update is ready to install.

Hover or focus the icon to see the version, status, and up to eight release-note entries, with a link to the rest on GitHub. **Settings → Updates** includes notes for both the installed stable version and any offered update. Update availability appears in the icon and Settings, without toast notifications.

</details>

Desktop updates apply only to installed stable Windows releases. Dev builds, local candidates, unpacked or copied apps, and browser clients do not install them.

<details>
<summary>Updating a development build</summary>

**OpenTig Dev** shows the base package version and instructions to rebuild/restart a source checkout or replace a Dev ZIP. Browser Dev instances show server rebuild/restart instructions. See [development profiles](development.md).

</details>

### If the desktop app cannot start

The offline screen offers **Restart OpenTig** and **Open server log** when the backend cannot start.

<details>
<summary>Where to find startup diagnostics</summary>

The rotating log is at `%APPDATA%\OpenTig\logs\server.log`. It records startup stages, version, port, elapsed time, error codes, and stack traces, with credentials redacted.

</details>

## Run the headless CLI

Run these commands on the machine that holds your repositories. Keep the process running while using OpenTig in a browser.

### Try it without a global installation

To start OpenTig and open a one-time browser pairing link:

```bash
npx --yes @opentig/cli@latest
```

On a server, or when you want to open the browser yourself, use `serve`:

```bash
npx --yes @opentig/cli@latest serve
```

This prints a pairing code, one-use link, and terminal QR without opening a browser. Use the link or code to pair your browser. For another device, follow [remote access and pairing](web-access.md).

**Use `latest` for evaluation.** Replace it with an exact version for repeatable deployments. Running through `npx` or `bunx` does not install a background service or make OpenTig start automatically.

<details>
<summary>Using bunx</summary>

```bash
bunx @opentig/cli@latest serve
```

Node.js is still required: plain `bunx` installs the package and launches its Node shebang. A Bun-only runtime is not supported.

</details>

### Install the CLI globally

```bash
npm install -g @opentig/cli@latest
opentig serve
```

Use `opentig` or `opentig start` to open the browser automatically; `opentig serve` prints the pairing details instead. `opentig help` or `opentig --help` lists all commands, examples, pairing/tunnel instructions, fixed-port behavior, and service commands.

Add, open, and switch repositories in the web UI using paths on the server. The CLI starts one project-independent instance; it does not select repositories through command-line arguments.

### Pair another browser

After a global installation, request a fresh pairing link from the **same OS account** that runs OpenTig:

```bash
opentig pair
```

If the instance uses a custom home, pass that same directory. For example, on Windows:

```powershell
opentig pair --home C:\path\to\opentig-home
```

By default, OpenTig listens on `127.0.0.1:6767` (this machine only) and stores data in `~/.opentig`. An occupied port causes an error instead of selecting another port, keeping reverse-proxy configuration predictable.

OpenTig does not include Docker packaging, built-in TLS, Tailscale/SSH automation, or multi-user roles. See [remote access and pairing](web-access.md) before connecting from another device.

<details>
<summary>Change the address or data directory</summary>

| Option | Environment variable | Default |
| --- | --- | --- |
| `--host` | `OPENTIG_HOST` | `127.0.0.1` |
| `--port` | `OPENTIG_PORT` | `6767` |
| `--home` | `OPENTIG_HOME` | `~/.opentig` |
| `--no-browser` | Not applicable | Use with `start` to prevent opening a browser. |

</details>

<details>
<summary>Stored data and process shutdown</summary>

The private home contains settings, hash-only sessions, a local-admin credential, credential-free runtime state, AI history, and rotating logs.

SIGINT or SIGTERM closes WebSockets, the HTTP listener, watchers, Git/AI child processes, settings, and logs. A second signal forces exit.

</details>

## Background services

A background service keeps OpenTig running after you close the terminal. Install the CLI globally first, or invoke its executable directly, then opt in:

```bash
opentig service install --host 127.0.0.1 --port 6767
```

The service uses your OS account's repository access and CLI credentials. It does not copy credentials or run as root or LocalSystem. It is independent of any repository and separate from the desktop app's server. If another instance already uses port `6767`, choose a different port.

### When the service runs

| Platform | Starts and stops | Requirements |
| --- | --- | --- |
| Linux | Starts at boot and survives logout through a systemd user service with lingering. | If enabling lingering is denied, ask an administrator to run `sudo loginctl enable-linger <your-user>`, then retry installation as your normal user. |
| macOS | Starts at login and stops at logout. | Installation needs an active GUI login session. No administrator access or Apple signing is needed for the Node.js CLI. |
| Windows | Starts at login and stops at logout. | Requires Windows PowerShell and Task Scheduler access. Runs as the current user without a stored password or elevated privileges; organization policies may restrict registration. |

**Keep the host awake.** Sleep suspends access. Closing the terminal does not stop the service, but logging out on macOS or Windows does. Locking the screen is not a logout.

On macOS, Node may need privacy permission to access protected folders. Check **Login Items** if the background agent is disabled.

<details>
<summary>Service registration and runtime files</summary>

- Linux uses a systemd user service.
- macOS registers `~/Library/LaunchAgents/com.opentig.cli.plist`.
- Windows registers the Task Scheduler task `OpenTig CLI <user SID>`.

Installation stages the exact CLI/client version under the selected OpenTig home and uses that private home as the stable service working directory. Paths containing spaces, quotes, or percent signs are supported.

OpenTig does not install system-wide LaunchDaemons or Windows services that run before login. The startup behavior is the one described in the table above.

</details>

### Manage the service

```bash
opentig service status
opentig service restart
opentig service uninstall
```

Only one CLI service is registered per OS user. If you installed it with a custom `--home`, use that same home for `status`, `restart`, and `uninstall`. Commands using a different home refuse to replace or remove the service.

Uninstalling the service preserves settings and paired browsers. Installation and updates are serialized so they cannot run concurrently.

### Change access or repair missing tools

The listener uses loopback unless `--host` or saved **Settings → Web access** configuration selects another address. Paired browsers can change the listener, port, and browser access; see [access configuration and recovery](web-access.md#configure-access-from-a-browser).

Reinstall the service from your terminal with `opentig service install` if:

- You move Git or an integration CLI. Installation captures the terminal's `PATH` so tools such as Git, Codex, Claude Code, and OpenCode remain discoverable. Browser updates preserve the running service's effective `PATH`, including systemd overrides.
- Your Node version manager removes the Node executable used at installation. The service captures its absolute path.

## Updates for background services

Managed CLI services on Linux, macOS, and Windows can be updated from a paired browser. If your installation predates managed updates, upgrade once from the terminal and run `opentig service install` first:

1. Use the update icon or open **Settings → Updates**.
2. Download the offered update. The current server keeps running during preparation.
3. Choose **Restart and install** when ready.

Running commands delay installation. Browsers with unsaved edits or active operations do not reload automatically; other connected browsers reconnect and load the matching interface. See [connection behavior](web-access.md#connection-behavior) if an open browser needs to reload after an upgrade.

<details>
<summary>Update checks, verification, and recovery</summary>

The server checks every five minutes and offers a stable GitHub release once the matching CLI version is available on npm.

Downloading verifies the npm package's SHA-512 integrity and prepares dependencies. **Restart and install** switches the managed runtime through a separate supervisor job, preserving the address and private home. If the new version fails its readiness check, the previous version is restored. Keep the previous runtime for recovery.

</details>

<details>
<summary>How browser updates affect the global CLI</summary>

Browser updates do not modify the global npm package. A global launcher that supports managed updates delegates commands to the newer service CLI; `opentig --version` reports both versions. An older launcher cannot reinstall an earlier service version.

</details>

**Foreground, temporary `npx`, and Dev instances require terminal updates.** Stop the foreground process and run the desired pinned, immutable version. Use `latest` for evaluation and an exact version for repeatable deployments.

## Optional integrations

Install and authenticate each tool **on the machine running OpenTig**. You only need the integrations you intend to use: GitHub features require `gh`; AI features require at least one supported AI CLI.

| Integration | Sign in after installing its CLI |
| --- | --- |
| GitHub | `gh auth login` |
| Codex | `codex login` |
| Claude Code | `claude auth login` |
| OpenCode 2.x | `opencode auth login` |
| Grok Build | `grok login`, or set `XAI_API_KEY` for the host process. |

For OpenCode, follow the [v2 installation instructions](https://opencode.ai/v2/docs/cli). If your compatible installation uses the `opencode2` executable, run `opencode2 auth login` instead.

For Grok, install the [official Grok Build CLI](https://docs.x.ai/build/cli), version **1.0.46 or later in the 1.x series**, and select **Grok Build** in **Settings → AI assistance**. OpenTig discovers its built-in models and uses an isolated profile without custom CLI configuration.

Read [GitHub and pull requests](github.md) or [AI assistance](ai-assistance.md) for the available features and their settings.

## Local tarball evaluation

<details>
<summary>Test a local CLI package on Windows</summary>

Use the tarball's absolute path:

```powershell
npx --yes --package C:\absolute\path\opentig-cli-<version>.tgz opentig --help
bunx --package C:\absolute\path\opentig-cli-<version>.tgz opentig --help
```

For building packages from source, see [development and packaging](development.md).

</details>
