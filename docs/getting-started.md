# Installation and CLI

[← Documentation](README.md)

The packaged desktop installer is Windows x64 only. The Node.js CLI runs on Linux, macOS, and Windows and serves the same browser UI. All three CLI platforms support background installation and browser-driven updates using their native user service manager.

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

Try the latest published version (replace `latest` with an exact version for repeatable deployments):

```powershell
npx --yes @opentig/cli@latest
npx --yes @opentig/cli@latest serve
bunx @opentig/cli@latest serve
```

`opentig` and `opentig start` start the server and open its one-time pairing link. `opentig serve` does not open a browser. The CLI starts one project-independent OpenTig instance: repositories are added, opened, and switched exclusively from the web UI using paths on the server. After a global installation, a new device can request a fresh link from the same OS account with:

```powershell
opentig pair --home C:\path\to\opentig-home
```

`opentig help` and `opentig --help` show the complete command reference, examples, pairing/tunnel instructions, fixed-port behavior, and explicit service commands.

Options are `--host`, `--port`, `--home`, and `--no-browser`, with `OPENTIG_HOST`, `OPENTIG_PORT`, and `OPENTIG_HOME` environment equivalents. Defaults are `127.0.0.1`, port `6767`, and `~/.opentig`. An occupied port fails clearly so reverse-proxy configuration remains predictable. The home contains private settings, hash-only sessions, a local-admin credential, credential-free runtime state, AI history, and rotating logs. SIGINT or SIGTERM closes WebSockets, the HTTP listener, watchers, Git/AI children, settings, and logs; a second signal forces exit.

Running through `npx` or `bunx` never installs startup persistence. On Linux, macOS, or Windows, opt in explicitly after installing the CLI globally or invoking its executable:

```bash
opentig service install --host 127.0.0.1 --port 6767
opentig service status
opentig service restart
opentig service uninstall
```

Installation stages the exact CLI/client version under the selected OpenTig home, uses that private home as its stable service working directory (including paths containing spaces, quotes, or percent signs), registers with the platform service manager, and keeps the listener on loopback unless `--host` says otherwise. The service captures the installing terminal’s `PATH` so locally installed tools such as Codex, Claude Code, OpenCode, and Git remain discoverable. Browser updates preserve the running service’s effective `PATH`, including systemd overrides. Run `opentig service install` again from your terminal after changing your tool locations. It never binds the service to a repository. The CLI service is separate from the server owned by the desktop app. It keeps the installing user's repository access and CLI credentials; no credentials are copied and the server is not run as root or LocalSystem.

| Platform | Supervisor | Startup and permissions |
| --- | --- | --- |
| Linux | systemd user service | Starts at boot and survives logout using lingering. If enabling it is denied, ask an administrator to run `sudo loginctl enable-linger <your-user>`, then retry the installation as your normal user. |
| macOS | `~/Library/LaunchAgents/com.opentig.cli.plist` | Starts at login and stops at logout. Installation needs an active GUI login session for that user. No administrator access or Apple signing is needed for the Node.js CLI. |
| Windows | Task Scheduler, `OpenTig CLI <user SID>` | Starts at login and stops at logout. Runs under the current user without a stored password or elevated privileges. Requires Windows PowerShell and access to Task Scheduler. Organization policies can restrict task registration. |

Closing the terminal does not stop these services. Logging out on macOS/Windows does; locking the screen is not a logout. Sleep suspends access, so keep the host awake. macOS may require privacy permissions for Node to access protected folders. Check Login Items if its background agent is disabled.

One CLI service is registered per OS user. Commands with a different `--home` refuse to replace or remove that service. Use the installation's home for `status`, `restart`, and `uninstall`. A separate instance, including desktop, needs a different port if it already uses `6767`.

Updates run in a separate supervisor job, verify the downloaded npm package's SHA-512 integrity, switch the managed runtime, and restart the service. If readiness fails, the previous definition and version are restored. Installation and updates are serialized; removing the service preserves settings and paired browsers. Service installation captures the current absolute Node executable: reinstall from your terminal if a Node version manager removes that executable.

A background service here means the startup behavior in the table above. System-wide LaunchDaemons and Windows services that run before login are not installed.

For local tarball testing on Windows:

```powershell
npx --yes --package C:\absolute\path\opentig-cli-<version>.tgz opentig --help
bunx --package C:\absolute\path\opentig-cli-<version>.tgz opentig --help
```

Use `latest` only for evaluation after a public release. Foreground instances are upgraded by stopping the process and running a different pinned immutable version. Managed CLI services on all three platforms can update from their browser interface. The service owns its versioned runtime copies; browser updates do not modify the global npm package. A global launcher that supports managed updates delegates to the newer service CLI for commands and reports both versions with `opentig --version`; an older launcher cannot reinstall an earlier service version. Keep the previous runtime for recovery. Existing installations predating managed updates need one terminal upgrade and `opentig service install` before this flow becomes available. OpenTig does not ship Docker, built-in TLS, Tailscale/SSH automation, or multi-user roles.

For global installation:

```bash
npm install -g @opentig/cli@latest
opentig serve
```

See [remote access and pairing](web-access.md) for SSH tunnels, HTTPS proxies, and browser access.
