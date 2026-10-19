# Server architecture

OpenTig's desktop app and paired browsers use **the same server API**. The React renderer handles the interface; Git, filesystem, GitHub, and AI operations run on the machine hosting the server.

Electron starts that server in a utility process. The Node CLI starts it in its own process. A browser connects to a running instance; it does not run the backend or operate on repositories on the browsing device.

- [Runtime topology](#runtime-topology): what runs where.
- [Ownership boundaries](#ownership-boundaries): which layer owns a change.
- [Request and event flow](#request-and-event-flow): how clients call the server and recover after reconnect.
- [Source map](#source-map): where to find the implementation.

## Runtime topology

```text
Desktop UI       Browser UI
     \             /
   authenticated HTTP + WebSocket
                 |
          OpenTig server
                 |
       host Git / gh / AI CLIs
```

The desktop window loads the production React client from the local server origin. There is **one server runtime**, with no separate desktop renderer backend or duplicate Web Access runtime.

The shared server contains Git and filesystem services, settings and repository state, GitHub and optional AI CLI adapters, repository watchers, and runtime events. Its HTTP/WebSocket layer serves the production client and owns session authentication and persistent access/listener configuration.

<details>
<summary>What Electron and the Node CLI add</summary>

**Electron main** starts, probes, restarts, and stops the utility server. It installs the private desktop owner session, delegates access configuration to the shared server, and provides narrow native-only capabilities through preload.

**The Node CLI** parses host, port, home, and presentation options, then invokes the same `runOpenTigServer` factory in-process. Repository discovery and selection stay in the shared web UI. The CLI writes credential-free runtime identity for `opentig pair`, handles browser launch, and shuts down on SIGINT/SIGTERM.

The CLI can also install its exact build as a background service: a systemd user service on Linux, a launchd LaunchAgent on macOS, or a scheduled task on Windows. See [background services](getting-started.md#background-services) for requirements and commands.

</details>

## Ownership boundaries

| Layer | Owns | Does not own |
| --- | --- | --- |
| React renderer | UI state, queries, command calls, reconnect/bootstrap | Node.js, Git processes, filesystem access |
| WebSocket transport | correlation IDs, timeouts, cancellation, heartbeat, reconnect, runtime events | domain behavior or mutation replay |
| Server command registry | typed command-to-handler mapping, validation, per-session cancellation | Electron window or OS UI |
| Runtime | Git, files, settings, repositories, watchers, GitHub, AI adapters | HTTP, cookies, Electron lifecycle |
| HTTP/WebSocket server | static client, readiness, authentication, origin checks, sessions, transport limits | desktop-native capabilities |
| Electron main/preload | utility lifecycle, folder picker, Explorer reveal, file clipboard, title-bar integration | Git/filesystem domain commands |

This boundary keeps browser and desktop behavior aligned. A domain feature added
to the server API becomes available to both clients unless it explicitly needs a
native capability.

## Request and event flow

1. The client opens `/ws` on the same origin that served the React application.
2. The server authenticates the owner-session cookie and validates the exact
   WebSocket origin.
3. A request contains a correlation ID, command name, and typed tuple arguments.
4. The registry validates the command and arguments, then delegates to the
   shared runtime.
5. The server returns one typed result for that ID. Interrupted mutations are
   rejected; they are never silently replayed after reconnect.
6. Repository and filesystem changes are published as runtime events to every
   connected owner session.
7. After reconnect, each client bootstraps fresh authoritative state.

Large request classes have explicit byte budgets. The transport also applies
connection, request-rate, pending-request, result-size, timeout, and heartbeat
limits.

## Desktop server lifecycle

Electron starts `packages/server/dist/utility.mjs` with
`utilityProcess.fork`. The bootstrap configuration and one-use desktop secret
cross the private parent/utility message port; they are not placed in process
arguments or environment variables.

The supervisor:

- prefers port `6767` in production or `6867` in Dev, scanning a bounded range within that profile when the implicit port is busy;
- waits for `/readyz` before loading the application;
- writes redacted rotating server logs;
- restarts unexpected exits with bounded backoff;
- keeps one selected port and one utility process;
- shuts down the WebSocket server and runtime gracefully.

A renderer reload does not terminate the utility process. When the server
restarts, connected clients reject pending operations, reconnect, and reload
authoritative state.

## Data and persistence

Repository files stay at their existing paths on the host. Application settings and logs live separately: Electron uses its user-data directory; the headless CLI uses `~/.opentig` or the directory selected with `--home`.

`settings.json` stores repositories, preferences, and application state. If it cannot be parsed, OpenTig uses the last known-good `settings.json.bak`.

<details>
<summary>Desktop data files</summary>

Desktop paths are derived from Electron's user-data directory:

| Path | Purpose |
| --- | --- |
| `settings.json` | repositories, preferences, and application state |
| `settings.json.bak` | last known-good settings document, used if the primary file cannot be parsed |
| `ai-log.jsonl` | local AI-operation log |
| `github-status.json` | last checked GitHub CLI/account metadata; no tokens or credential paths |
| `problems.jsonl` | local Git, file, and network failure log |
| `desktop-server.json` | shared persisted desktop web access, domain, address and port |
| `server/` | hash-only owner-session authentication state |
| `logs/server.log` | redacted rotating utility-server log |

</details>

<details>
<summary>Headless CLI data files</summary>

The headless CLI derives equivalent paths from `~/.opentig` or `--home`:

| Path | Purpose |
| --- | --- |
| `settings.json` | repositories, preferences, and application state |
| `settings.json.bak` | last known-good settings document, used if the primary file cannot be parsed |
| `ai-log.jsonl` | local AI-operation history |
| `github-status.json` | last checked GitHub CLI/account metadata; no tokens or credential paths |
| `problems.jsonl` | local Git, file, and network failure log |
| `server/web-access.json` | saved CLI web access, domain, address and port |
| `server/` | hash-only sessions plus a private same-host admin credential |
| `runtime.json` | PID, bind address, version/protocol, and instance identity; no credential |
| `logs/server.log` | redacted rotating CLI server log |

</details>

### Sessions and device metadata

Pairing secrets are memory-only. Persistent session files contain credential
hashes rather than usable cookie values, plus editable device names and
non-secret browser, OS, device, proxy/IP, and last-connection metadata. The
private desktop session is replaced on a new desktop bootstrap instead of
accumulating duplicates. Live connection counts are derived from WebSockets and
are not persisted.

See [security and privacy](security-and-privacy.md) for permissions, credential handling, and AI context.

### GitHub account state

`GitHubAccountsService` resolves a repository's account once per GitHub operation
and supplies the same child-process authentication to its REST, GraphQL and `gh`
commands. Explicit choices live in `settings.json`, keyed by the canonical Git
common directory. Only allowlisted account metadata is cached on disk.

A `github.accounts-changed` runtime event cancels and resets GitHub queries across
connected clients; Git queries remain intact. PR creation includes the reviewed
login and authentication revision so a changed identity cannot silently publish.
The current protocol version is 4, declared in `src/shared/protocol-version.json`; it includes this event and the account-management commands.

## Native capability boundary

The preload bridge exposes desktop capabilities that a normal browser cannot reproduce safely:

- Selecting or relocating a directory through a native picker.
- Reading explicit file paths or an image from the desktop clipboard.
- Revealing a path in Explorer.
- Title-bar theming and zoom.

It also exposes desktop update controls and a desktop adapter for Web access controls. **Access and listener configuration belong to the shared server**: the desktop adapter delegates there, while paired browsers use authenticated HTTP routes.

Authenticated session inventory, renaming, and browser revocation remain ordinary server APIs, so the same management view works in desktop and browser.

Confirmation dialogs live in React. Cross-platform deletion moves content to the operating system Trash from the server runtime.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/shared/server-api.ts` | renderer-facing typed server API |
| `src/shared/protocol.ts` | command ownership, mutation flags, and request budgets |
| `src/main/runtime/` | Electron-free runtime and command registry |
| `packages/server/src/server.ts` | shared server construction boundary |
| `packages/server/src/http.ts` | HTTP, readiness, static client, and auth routes |
| `packages/server/src/websocket.ts` | authenticated command/event transport |
| `packages/server/src/auth*.ts` | pairing and persistent owner sessions |
| `packages/server/src/utility.ts` | thin Electron utility-process adapter |
| `packages/server/src/bin.ts` / `cli.ts` | Node shebang and thin headless lifecycle adapter |
| `src/main/server/` | Electron supervisor and exposure settings |
| `src/renderer/lib/websocket-transport.ts` | browser/Electron client transport |
| `src/main/ipc/` | native-only desktop handlers |

## Verification

Run from the repository root:

```powershell
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run package
```

Focused server coverage lives under `packages/server/src/*.test.ts`; runtime
boundary tests live under `src/main/runtime`; supervisor tests live under
`src/main/server`; renderer transport tests live under `src/renderer/lib`.

`pnpm run release:pack:headless` builds the web client and server once, then emits
one tarball plus JSON metadata containing its version, SHA-256, npm integrity,
and exact file list. `pnpm run release:inspect:headless` rejects version drift,
checkout paths, source/tests/state, Electron/native imports, and undeclared
artifacts. Release automation consumes that tested tarball rather than rebuilding it.

For Dev builds, platform requirements, and website/documentation checks, see [development and packaging](development.md).
