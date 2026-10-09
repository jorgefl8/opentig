# Installation and CLI

[← Documentation](README.md)

The packaged desktop installer is Windows x64 only. The Node.js CLI runs on Linux, macOS, and Windows and serves the same browser UI. All three CLI platforms support background installation and browser-driven updates using their native user service manager.

## Requirements

- Windows 10 or later for the desktop application.
- Node.js 24 or later and Git on `PATH` for the headless CLI. Plain `bunx` installs and launches the Node shebang; a Bun-only runtime is not supported.
- Node.js 24.15 or later and npm 11 or later when building from source.

Optional integrations require their own installed and authenticated CLI:

```powershell
gh auth login
codex login
claude auth login
opencode auth login
```

OpenCode requires version 2.x; install the current CLI following the [OpenCode v2 instructions](https://opencode.ai/v2/docs/cli). If your compatible installation uses `opencode2`, run `opencode2 auth login` instead.

Only install the tools you intend to use. GitHub functionality requires `gh`; AI features require at least one supported AI CLI.

For optional Grok assistance, install the [official Grok Build CLI](https://docs.x.ai/build/cli), run `grok login` (or set `XAI_API_KEY` for the host process), and select **Grok Build** in **Settings → AI assistance**. OpenTig requires Grok Build 1.0.46 or later in the 1.x series, discovers its built-in models, and uses an isolated profile without custom CLI configuration.

## Windows desktop

Download the Windows x64 installer from the [latest release](https://github.com/jorgefl8/opentig/releases/latest). Git must be installed on the host. The installer is currently unsigned, so Windows may show an unknown-publisher or SmartScreen warning. Linux and macOS desktop installers are not published yet.

Installed stable Windows releases check for updates at startup, every five minutes, and when the window regains focus if the last attempt was at least five minutes ago. **Settings → Updates** offers a manual check, progress, release notes for the installed stable version and any offered update, and **Restart and install**.

The update icon beside Settings (or on the welcome screen) shows a notification dot when a download is available, a progress ring while downloading, and a check badge when ready. Click it to download or restart; hover or focus it for the version, status, and up to eight release-note entries with a link to the rest on GitHub. Update availability uses the icon and Settings without toasts. Downloading never installs on ordinary exit; restart first lets you handle edited files and shuts down the backend and settings safely.

Dev, local candidates, unpacked or copied applications, and browser clients do not install desktop updates. **OpenTig Dev** shows the base package version and explains how to rebuild/restart a source checkout or replace a Dev ZIP. Browser Dev instances give server rebuild/restart instructions. See [development profiles](development.md).

If the desktop backend cannot start, the offline screen offers **Restart OpenTig** and **Open server log**. The rotating log at `%APPDATA%\OpenTig\logs\server.log` records startup stages, version, port, elapsed time, error codes, and stack traces with credentials redacted.

## Run the headless CLI

Try the latest published version (replace `latest` with an exact version for repeatable deployments):

```powershell
npx --yes @opentig/cli@latest
npx --yes @opentig/cli@latest serve
bunx @opentig/cli@latest serve
```

For a global installation:

```bash
npm install -g @opentig/cli@latest
opentig serve
```

`opentig` and `opentig start` start the server and open its one-time pairing link. `opentig serve` stays headless and prints its code, one-use link, and terminal QR without opening a browser. The CLI starts one project-independent OpenTig instance: repositories are added, opened, and switched exclusively from the web UI using paths on the server. After a global installation, a new device can request a fresh link from the same OS account with:

```powershell
opentig pair --home C:\path\to\opentig-home
```

`opentig help` and `opentig --help` show the complete command reference, examples, pairing/tunnel instructions, fixed-port behavior, and explicit service commands.

Options are `--host`, `--port`, `--home`, and `--no-browser`, with `OPENTIG_HOST`, `OPENTIG_PORT`, and `OPENTIG_HOME` environment equivalents. Defaults are `127.0.0.1`, port `6767`, and `~/.opentig`. An occupied port fails clearly so reverse-proxy configuration remains predictable. The home contains private settings, hash-only sessions, a local-admin credential, credential-free runtime state, AI history, and rotating logs. SIGINT or SIGTERM closes WebSockets, the HTTP listener, watchers, Git/AI children, settings, and logs; a second signal forces exit.

## Background services

Running through `npx` or `bunx` never installs startup persistence. On Linux, macOS, or Windows, opt in explicitly after installing the CLI globally or invoking its executable:

```bash
opentig service install --host 127.0.0.1 --port 6767
opentig service status
opentig service restart
opentig service uninstall
```

Installation stages the exact CLI/client version under the selected OpenTig home, uses that private home as its stable service working directory (including paths containing spaces, quotes, or percent signs), registers with the platform service manager, and uses loopback unless `--host` or saved Settings → Web access configuration selects another address. Paired browsers can change the listener, port and browser access; see [access configuration and recovery](web-access.md#configure-access-from-a-browser). The service captures the installing terminal’s `PATH` so locally installed tools such as Codex, Claude Code, OpenCode, and Git remain discoverable. Browser updates preserve the running service’s effective `PATH`, including systemd overrides. Run `opentig service install` again from your terminal after changing your tool locations. It never binds the service to a repository. The CLI service is separate from the server owned by the desktop app. It keeps the installing user's repository access and CLI credentials; no credentials are copied and the server is not run as root or LocalSystem.

| Platform | Supervisor | Startup and permissions |
| --- | --- | --- |
| Linux | systemd user service | Starts at boot and survives logout using lingering. If enabling it is denied, ask an administrator to run `sudo loginctl enable-linger <your-user>`, then retry the installation as your normal user. |
| macOS | `~/Library/LaunchAgents/com.opentig.cli.plist` | Starts at login and stops at logout. Installation needs an active GUI login session for that user. No administrator access or Apple signing is needed for the Node.js CLI. |
| Windows | Task Scheduler, `OpenTig CLI <user SID>` | Starts at login and stops at logout. Runs under the current user without a stored password or elevated privileges. Requires Windows PowerShell and access to Task Scheduler. Organization policies can restrict task registration. |

Closing the terminal does not stop these services. Logging out on macOS/Windows does; locking the screen is not a logout. Sleep suspends access, so keep the host awake. macOS may require privacy permissions for Node to access protected folders. Check Login Items if its background agent is disabled.

One CLI service is registered per OS user. Commands with a different `--home` refuse to replace or remove that service. Use the installation's home for `status`, `restart`, and `uninstall`. A separate instance, including desktop, needs a different port if it already uses `6767`.

Installation and updates are serialized; removing the service preserves settings and paired browsers. Service installation captures the current absolute Node executable: reinstall from your terminal if a Node version manager removes that executable.

A background service here means the startup behavior in the table above. System-wide LaunchDaemons and Windows services that run before login are not installed.

## Updates for background services

Foreground instances are upgraded by stopping the process and running a different pinned immutable version. Dev and temporary `npx` instances require terminal updates. Use `latest` only for evaluation; pin an exact version for repeatable deployments.

Managed CLI services on Linux, macOS, and Windows offer the update icon and **Settings → Updates** in paired browsers. The server checks every five minutes and offers a stable GitHub release once its matching CLI version is available on npm. Downloading verifies the npm package's SHA-512 integrity and prepares dependencies while the current server keeps running. **Restart and install** switches the managed runtime through a separate supervisor job, preserving the address and private home; a failed readiness check restores the previous version.

Running commands delay installation. Browsers with unsaved edits or active operations do not reload automatically; other connected browsers reconnect and load the matching interface. See [connection behavior](web-access.md#connection-behavior) if an open browser needs to reload after a server upgrade.

Browser updates do not modify the global npm package. A global launcher that supports managed updates delegates commands to the newer service CLI and reports both versions with `opentig --version`; an older launcher cannot reinstall an earlier service version. Keep the previous runtime for recovery. Installations predating managed updates need one terminal upgrade and `opentig service install` before this flow becomes available.

## Local tarball evaluation

For local tarball testing on Windows:

```powershell
npx --yes --package C:\absolute\path\opentig-cli-<version>.tgz opentig --help
bunx --package C:\absolute\path\opentig-cli-<version>.tgz opentig --help
```

OpenTig does not ship Docker, built-in TLS, Tailscale/SSH automation, or multi-user roles. See [remote access and pairing](web-access.md) for connection setup and [development and packaging](development.md) for building from source.
