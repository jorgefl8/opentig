# Security and AI privacy

[← Documentation](README.md) · [Report a vulnerability](../SECURITY.md)

OpenTig reads and writes repositories on the machine running its backend. Browser access and optional AI assistance have different trust boundaries:

| Question | What to expect |
| --- | --- |
| **Where are my files?** | Repository contents stay at their existing paths on the host; OpenTig reads and writes those files |
| **What can a paired browser do?** | Use file, Git, GitHub, and AI CLI operations with the permissions of the server's OS account |
| **What does an AI provider receive?** | The context supplied for the requested generation, plus repository writing conventions if enabled |

Only pair devices and people you trust with owner access. A local AI CLI may send context to its provider; running the CLI on your machine does not make generation offline. See [AI privacy](#ai-privacy) below before enabling it.

## Local-first and security model

### Files and application boundaries

Repository contents are read from and written to their existing local paths. The renderer has no direct Node.js, filesystem, or process access.

Desktop and browser clients use the same typed, validated WebSocket command boundary for Git, filesystem, persistence, AI, and GitHub operations. Interrupted operations are rejected rather than replayed after reconnect.

**HTML previews can make network requests.** Their scripts run in a sandbox with an opaque origin and cannot read OpenTig cookies, storage, or the parent page. External resources remain available; forms, popups, and top-level navigation are blocked. Rendered Markdown is sanitised before display.

<details>
<summary>Command validation, desktop bridge, and external links</summary>

Requests have correlation IDs, cancellation, and timeouts. Git commands use argument arrays with `shell: false`, bounded output, timeouts, path validation, and per-repository write serialisation.

The narrow preload bridge provides only desktop capabilities such as folder selection/relocation, file clipboard import, Explorer reveal, title-bar theming, and zoom. Text clipboard access uses the renderer's browser API.

External links are allowlisted to `http(s)://` and `mailto:` before Electron's window-navigation interception opens them in the system browser.

</details>

### Browser permissions and network exposure

**A paired browser receives owner-level authority as the OS user running OpenTig**, including file, Git, GitHub, and AI CLI operations. There are no read-only roles or per-repository scopes. Use a trusted LAN/VPN, HTTPS reverse proxy, or SSH tunnel; never expose the raw HTTP port publicly.

The transport binds to loopback by default. Commands and image bytes require an owner session. Exact mutation/WebSocket origins are validated, and static-file traversal and symlink escape are blocked.

**Settings → Web access** separates browser authorization from the listener:

| Control | Effect |
| --- | --- |
| **Web access** | Allows or pauses browser authorization. Off by default on desktop; CLI servers start browser-enabled |
| **LAN access** | Rebinds the existing listener to `0.0.0.0`, or back to `127.0.0.1` when disabled. It reconnects clients without replacing the runtime |
| **Saved public URL** | Constructs pairing links and QR codes; it is not an authentication allowlist |

These server settings are shared with connected clients, including paired browsers. OpenTig does not start a second Web Access server. Follow [web access and pairing](web-access.md) for setup, listener configuration, and local recovery.

**Pausing Web access disconnects browsers but keeps their saved credentials.** While paused, only authenticated desktop sessions can use backend operations. Browser pairing, renewal, HTTP data access, and WebSocket commands/events are blocked, even through a same-PC tunnel. Pending pairing codes are invalidated; the desktop session is not restarted.

Enabling access again lets browsers reconnect if their credentials have not expired or been revoked. Static assets and health endpoints may still be served while browser backend access is disabled. Closing the QR display does not revoke a copied code.

### Pairing, renewal, and revocation

New browsers pair through a **five-minute, one-use URL fragment**, displayed as a link and local QR code. The fragment is cleared before exchange. Pairing secrets stay in memory and appear only in deliberate one-time terminal output or the URL fragment, never in arguments, environment variables, routine logs, query strings, or persisted state.

Browser cookies and server sessions last **30 days**. Renewal runs when the app connects, resumes in the foreground, and hourly while visible. It extends both lifetimes without another code or interrupting connected tabs; temporary network failures retry.

Closing the browser or restarting the server preserves access. After 30 days without successful renewal, the server rejects the expired credential and disconnects expired browser connections. **Expiry, cleared site cookies, or revocation require a new code.** Renewal cannot restore expired or revoked access.

Use **Revoke browsers** in Web access settings to remove saved browser sessions and disconnect them. This control leaves the private desktop session intact. See [revoking access](web-access.md#revoke-access).

<details>
<summary>Session cookies, hashes, and local administrative credentials</summary>

Steady-state credentials use host-only `HttpOnly`, `SameSite=Strict` cookies; only credential hashes are persisted. Desktop bootstrap cookies remain session-only. The server also has a full-session reset operation that disconnects sessions and replaces the private desktop session; this differs from the browser-only revocation control in Settings.

Headless `pair` uses a same-host-only administrative route and a separate private file under `~/.opentig/server`. The `runtime.json` file contains PID/address/version identity, not a credential.

</details>

<details>
<summary>Desktop startup, Dev profiles, and bootstrap isolation</summary>

Electron starts the backend after readiness, preferring port `6767`. If that implicit port is occupied, production scans `6767`–`6776`; Dev scans `6867`–`6876`. LAN changes retain the selected port. If a profile's range is full, startup fails rather than using the other profile's range.

Distinct session-cookie names let both profiles stay paired in the same browser on the same host. Revocation affects only its own profile.

The one-use desktop bootstrap secret crosses the private parent/utility message port exactly once. It is absent from process arguments, environment variables, renderer JavaScript, and redacted rotating logs. An unexpected exit restarts one utility process on the same selected port.

</details>

### GitHub credentials

Connected CLIs manage their own authentication. For each GitHub operation, OpenTig obtains the selected account's token from `gh` and verifies the user's identity. Only backend child commands receive the token in their environment.

Tokens never travel to renderers/browsers, command arguments, settings, status files, or logs. Credential-command output is discarded, and operation errors redact the token. OpenTig does not read or persist AI API tokens.

The guided account flow copies official commands for you to run. It does not execute authentication or change Git/SSH configuration. See [GitHub accounts and credentials](github.md).

<details>
<summary>Account overrides, cached metadata, and SSH checks</summary>

Explicit and verified SSH accounts override backend token variables without changing the global `gh` account. In-memory identity caches retain only a one-way fingerprint and login.

`github-status.json` contains allowlisted installation/account metadata, never raw CLI output, credential paths, or tokens. SSH checks require existing trusted host keys, use batch mode, and do not create keys or update known hosts.

</details>

## AI privacy

### Context supplied for generation

| Task | Supplied context |
| --- | --- |
| **Commit message** | A bounded staged diff, summary, staged paths, branch name, and up to ten recent commit subjects |
| **Split proposal** | Staged changes with a complete path list and summary; individual diffs may be trimmed within a fairly distributed patch budget |
| **Pull-request draft** | A bounded comparison between the current branch and selected base; the interface reports truncated context for careful review |

Commit generation excludes unstaged content. Untracked files are included only after staging. Enabled [repository writing conventions](#repository-writing-conventions) are supplied with the diff.

**Generated content stays editable and pending.** No commit is created or PR published until you review and confirm the action. Preparing a split group changes only the Git index.

<details>
<summary>Validation of multi-commit proposals</summary>

A proposal must partition every staged path exactly once. A trimmed individual diff can still be grouped from the complete path list and summary, with the available patch budget distributed fairly.

Partially staged files, staged renames, or other unreliable file inventories block proposals. OpenTig verifies that the staged snapshot has not changed before preparing the first group. Every commit requires explicit review and confirmation.

</details>

### Provider isolation and requirements

Commit and PR generation runs in a temporary working directory outside the repository. Provider-specific controls limit what each CLI can load or execute. For setup and supported versions, see [AI assistance](ai-assistance.md#supported-clis).

**Codex**

Generation uses a disposable home and disables project instruction discovery, shell execution, web search, bundled skills, apps, and subagents.

Codex requires accessible file-based credentials and permission to create a private profile in its authentication directory. **Keyring-only authentication and custom provider configuration are not supported** by this generation profile.

<details>
<summary>Codex credential access and temporary directories</summary>

The profile accesses only the CLI-owned `auth.json` through a temporary hard link, without reading or copying credentials. The working directory stays in system temporary storage. A separate private profile is created beside the resolved credential file, keeping its hard link on the same filesystem even if temporary storage is on another volume.

Both temporary directories are removed on completion, error, and cancellation.

</details>

**Claude Code**

Generation uses safe mode with no built-in or MCP tools, no user/project setting sources, disabled hooks, and no session persistence. Native authentication remains available. **Administrator-managed Claude policy still applies.**

**OpenCode**

Generation uses private home, configuration, and cache roots while retaining the CLI-owned authentication database. Databases with registered remote configuration, or unverifiable configuration metadata, are refused so remote plugins and rules cannot enter through authentication.

Custom CLI configuration and custom model/provider definitions are excluded. Select an available built-in provider/model explicitly when needed. Private OpenCode sessions are deleted after generation.

**Grok Build**

Generation uses a private temporary directory and isolated profile, retaining the existing CLI authentication path or API-key environment without reading or copying credentials. Tools, subagents, web search, and memory are disabled.

OpenTig first checks `grok inspect --json` and refuses profiles with hooks, plugins, MCP servers, or project instructions. Custom CLI models and user configuration are excluded.

Prompt files and temporary sessions are removed after generation, errors, and cancellation. **Grok may make an auxiliary session-title request** in addition to the requested generation.

### Repository writing conventions

Repository instructions are **off by default**. Enable them in **Settings → AI assistance → This repository** to supply writing conventions. The preference is saved per Git common directory and shared by worktrees and clients.

| Setting | What happens |
| --- | --- |
| **Off** | Instruction files are not separately read or loaded as instructions. Changes to them may still appear in a staged or branch diff as untrusted data |
| **On** | Root `AGENTS.md`, `CLAUDE.md`, and `GROK.md` regular UTF-8 files are sent to the selected provider with the diff, up to 32 KiB combined |

Parent/global/nested instructions, symlinks, imports, referenced URLs, and CLI configuration are not loaded. Conventions can refine terminology, writing style, and structure, but cannot override English, Conventional Commits, the required output schema, length limits, factual accuracy, privacy, or staged-file coverage.

Text generation cannot make instructions executable. If the setting or file contents change during generation, OpenTig rejects the stale result. Optional instruction contents are never saved in settings or diagnostic history.
